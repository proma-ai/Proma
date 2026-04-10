/**
 * 微信 Bridge 服务
 *
 * 基于微信 iLink Bot API（官方协议）实现：
 * - QR 码扫码登录
 * - HTTP 长轮询接收消息
 * - 发送消息/输入状态
 *
 * 消息路由到 Proma Agent，回复通过 iLink API 发送。
 */

import { BrowserWindow } from 'electron'
import type {
  WeChatBridgeState,
  WeChatCredentials,
  WeChatIncomingMessage,
  WeChatMessageItem,
} from '@proma/shared'
import { WECHAT_IPC_CHANNELS, WECHAT_ITEM_TYPE, WECHAT_MESSAGE_TYPE, WECHAT_MESSAGE_STATE } from '@proma/shared'
import { getDecryptedCredentials, saveWeChatCredentials, clearWeChatCredentials, getWeChatConfig, updateWeChatDefaultWorkspace } from './wechat-config'
import { getWeChatSyncPath } from './config-paths'
import { BridgeCommandHandler } from './bridge-command-handler'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import * as crypto from 'node:crypto'
import QRCode from 'qrcode'

// ===== iLink API 常量 =====

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
const QR_CODE_URL = `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`
const QR_STATUS_URL = `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=`
const LONG_POLL_TIMEOUT_MS = 40_000
const SEND_TIMEOUT_MS = 15_000
const MAX_CONSECUTIVE_FAILURES = 5
const INITIAL_BACKOFF_MS = 3_000
const MAX_BACKOFF_MS = 60_000
const SESSION_EXPIRED_CODE = -14

// ===== iLink API 响应类型 =====

interface QRCodeResponse {
  qrcode: string
  qrcode_img_content: string
}

interface QRStatusResponse {
  status: string
  bot_token: string
  ilink_bot_id: string
  baseurl: string
  ilink_user_id: string
}

interface GetUpdatesResponse {
  ret: number
  errcode?: number
  errmsg?: string
  msgs: WeChatIncomingMessage[]
  get_updates_buf: string
}

interface SendMessageResponse {
  ret: number
  errmsg?: string
}

interface GetConfigResponse {
  ret: number
  errmsg?: string
  typing_ticket?: string
}

// ===== 工具函数 =====

function generateWechatUIN(): string {
  const buf = crypto.randomBytes(4)
  const n = buf.readUInt32LE()
  return Buffer.from(String(n)).toString('base64')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ===== iLink HTTP 客户端 =====

class ILinkClient {
  private baseURL: string
  private botToken: string
  private botId: string
  private wechatUIN: string

  constructor(creds: WeChatCredentials) {
    this.baseURL = creds.baseUrl || DEFAULT_BASE_URL
    this.botToken = creds.botToken
    this.botId = creds.ilinkBotId
    this.wechatUIN = generateWechatUIN()
  }

  get botID(): string {
    return this.botId
  }

  /** 长轮询获取消息 */
  async getUpdates(buf: string, signal?: AbortSignal): Promise<GetUpdatesResponse> {
    return this.post<GetUpdatesResponse>('/ilink/bot/getupdates', {
      get_updates_buf: buf,
      base_info: { channel_version: '1.0.0' },
    }, LONG_POLL_TIMEOUT_MS + 5000, signal)
  }

  /** 发送消息 */
  async sendMessage(toUserId: string, items: WeChatMessageItem[], contextToken: string): Promise<SendMessageResponse> {
    return this.post<SendMessageResponse>('/ilink/bot/sendmessage', {
      msg: {
        from_user_id: this.botId,
        to_user_id: toUserId,
        client_id: `proma_${Date.now()}`,
        message_type: WECHAT_MESSAGE_TYPE.BOT,
        message_state: WECHAT_MESSAGE_STATE.FINISH,
        item_list: items,
        context_token: contextToken,
      },
      base_info: {},
    }, SEND_TIMEOUT_MS)
  }

  /** 发送文本消息（便捷方法） */
  async sendText(toUserId: string, text: string, contextToken: string): Promise<SendMessageResponse> {
    return this.sendMessage(toUserId, [{
      type: WECHAT_ITEM_TYPE.TEXT,
      text_item: { text },
    }], contextToken)
  }

  /** 获取配置（typing_ticket） */
  async getConfig(userId: string, contextToken: string): Promise<GetConfigResponse> {
    return this.post<GetConfigResponse>('/ilink/bot/getconfig', {
      ilink_user_id: userId,
      context_token: contextToken,
      base_info: {},
    }, 10_000)
  }

  /** 发送"正在输入"状态 */
  async sendTyping(userId: string, typingTicket: string, status: number): Promise<void> {
    await this.post('/ilink/bot/sendtyping', {
      ilink_user_id: userId,
      typing_ticket: typingTicket,
      status,
      base_info: {},
    }, 10_000)
  }

  private async post<T>(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    // 合并外部 signal，并确保清理监听器
    let onAbort: (() => void) | null = null
    if (signal && !signal.aborted) {
      onAbort = () => controller.abort()
      signal.addEventListener('abort', onAbort)
    } else if (signal?.aborted) {
      clearTimeout(timeout)
      throw new Error('Request aborted')
    }

    try {
      const resp = await fetch(this.baseURL + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'AuthorizationType': 'ilink_bot_token',
          'Authorization': `Bearer ${this.botToken}`,
          'X-WECHAT-UIN': this.wechatUIN,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`HTTP ${resp.status}: ${text}`)
      }

      return await resp.json() as T
    } finally {
      clearTimeout(timeout)
      if (onAbort && signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }
  }
}

// ===== 单例 Bridge =====

class WeChatBridge {
  private client: ILinkClient | null = null
  private state: WeChatBridgeState = { status: 'disconnected' }
  private pollAbortController: AbortController | null = null
  private loginAbortController: AbortController | null = null
  private getUpdatesBuf = ''
  private polling = false

  /** 通用命令处理器（命令路由 + Agent 消息路由 + EventBus 监听） */
  private commandHandler = new BridgeCommandHandler({
    platformName: '微信',
    adapter: {
      sendText: async (chatId: string, text: string, meta?: unknown) => {
        if (!this.client) return
        const ctx = meta as { contextToken?: string } | undefined
        const contextToken = ctx?.contextToken ?? ''
        // 微信单条消息有长度限制，超长分段
        const MAX_LEN = 4000
        const chunks = text.length <= MAX_LEN
          ? [text]
          : text.match(new RegExp(`.{1,${MAX_LEN}}`, 'gs')) ?? [text]
        for (const chunk of chunks) {
          await this.client.sendText(chatId, chunk, contextToken)
        }
      },
    },
    getDefaultWorkspaceId: () => getWeChatConfig().defaultWorkspaceId,
    onWorkspaceSwitched: (workspaceId) => updateWeChatDefaultWorkspace(workspaceId),
  })

  /** 获取当前状态 */
  getStatus(): WeChatBridgeState {
    return { ...this.state }
  }

  /** 开始扫码登录流程 */
  async startLogin(): Promise<void> {
    // 清理现有连接，但不推送 'disconnected' 状态，避免 UI 闪烁导致重复触发
    this.loginAbortController?.abort()
    this.pollAbortController?.abort()
    this.pollAbortController = null
    this.client = null
    this.polling = false

    this.loginAbortController = new AbortController()

    try {
      // 1. 获取二维码（立即设置 waiting_scan，不经过 disconnected）
      this.updateStatus({ status: 'waiting_scan' })
      const qrResp = await this.fetchQRCode()
      // qrcode_img_content 是扫码 URL，用 qrcode 库在 main 进程中生成二维码 data URL
      const scanUrl = qrResp.qrcode_img_content
      const qrDataUrl = await QRCode.toDataURL(scanUrl, { width: 280, margin: 2 })
      this.updateStatus({
        status: 'waiting_scan',
        qrCodeData: qrDataUrl,
      })
      console.log('[微信 Bridge] QR 码已获取，等待扫码...')

      // 2. 轮询扫码状态
      const creds = await this.pollQRStatus(qrResp.qrcode)

      // 3. 保存凭证
      saveWeChatCredentials(creds)
      console.log('[微信 Bridge] 登录成功，凭证已保存')

      // 4. 启动长轮询
      await this.startPolling(creds)
    } catch (error) {
      if (this.loginAbortController?.signal.aborted) return
      const msg = error instanceof Error ? error.message : String(error)
      this.updateStatus({ status: 'error', errorMessage: msg, qrCodeData: undefined })
      console.error('[微信 Bridge] 登录失败:', msg)
      throw error
    }
  }

  /** 用已有凭证启动长轮询 */
  async start(): Promise<void> {
    const creds = getDecryptedCredentials()
    if (!creds) {
      throw new Error('没有已保存的微信凭证，请先扫码登录')
    }
    await this.startPolling(creds)
  }

  /** 停止所有连接 */
  stop(): void {
    this.loginAbortController?.abort()
    this.loginAbortController = null
    this.pollAbortController?.abort()
    this.pollAbortController = null
    this.client = null
    this.polling = false
    this.commandHandler.unsubscribe()
    this.updateStatus({ status: 'disconnected', qrCodeData: undefined })
    console.log('[微信 Bridge] 已停止')
  }

  /** 登出（停止连接 + 清除凭证） */
  logout(): void {
    this.stop()
    clearWeChatCredentials()
    this.getUpdatesBuf = ''
    this.saveSyncBuf()
    console.log('[微信 Bridge] 已登出')
  }

  // ===== 内部方法 =====

  private async fetchQRCode(): Promise<QRCodeResponse> {
    const resp = await fetch(QR_CODE_URL)
    if (!resp.ok) throw new Error(`获取二维码失败: HTTP ${resp.status}`)
    return await resp.json() as QRCodeResponse
  }

  private async pollQRStatus(qrcode: string): Promise<WeChatCredentials> {
    const signal = this.loginAbortController!.signal

    while (!signal.aborted) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 40_000)
        const onAbort = (): void => controller.abort()
        signal.addEventListener('abort', onAbort)

        let resp: Response
        try {
          resp = await fetch(QR_STATUS_URL + qrcode, { signal: controller.signal })
        } finally {
          clearTimeout(timeout)
          signal.removeEventListener('abort', onAbort)
        }

        if (!resp.ok) {
          if (signal.aborted) break
          continue
        }

        const data = await resp.json() as QRStatusResponse

        switch (data.status) {
          case 'confirmed': {
            if (!data.bot_token || !data.ilink_bot_id) {
              throw new Error('扫码成功但未获取到有效凭证')
            }
            this.updateStatus({ status: 'connecting', qrCodeData: undefined })
            return {
              botToken: data.bot_token,
              ilinkBotId: data.ilink_bot_id,
              baseUrl: data.baseurl,
              ilinkUserId: data.ilink_user_id,
            }
          }
          case 'scaned':
            this.updateStatus({ status: 'scanned' })
            break
          case 'expired':
            throw new Error('二维码已过期，请重新获取')
          case 'wait':
          default:
            break
        }
      } catch (error) {
        if (signal.aborted) break
        // 超时是正常的，继续轮询
        if (error instanceof Error && error.name === 'AbortError') continue
        throw error
      }
    }

    throw new Error('登录已取消')
  }

  private async startPolling(creds: WeChatCredentials): Promise<void> {
    // 防止并发启动
    if (this.polling) {
      this.stop()
    }

    this.polling = true // 先设标志，防止并发
    this.client = new ILinkClient(creds)
    this.pollAbortController = new AbortController()
    this.loadSyncBuf()

    // 订阅 Agent EventBus 接收 Agent 回复
    this.commandHandler.subscribe()

    this.updateStatus({ status: 'connected', connectedAt: Date.now(), qrCodeData: undefined })
    console.log('[微信 Bridge] 长轮询已启动')

    // 后台运行长轮询循环
    this.pollLoop().catch((error) => {
      if (!this.pollAbortController?.signal.aborted) {
        const msg = error instanceof Error ? error.message : String(error)
        this.updateStatus({ status: 'error', errorMessage: msg })
        console.error('[微信 Bridge] 长轮询异常退出:', msg)
      }
    })
  }

  private async pollLoop(): Promise<void> {
    const signal = this.pollAbortController!.signal
    let failures = 0

    while (!signal.aborted) {
      try {
        const resp = await this.client!.getUpdates(this.getUpdatesBuf, signal)
        failures = 0

        // Session 过期
        if (resp.errcode === SESSION_EXPIRED_CODE) {
          if (this.getUpdatesBuf) {
            console.log('[微信 Bridge] session 过期，重置同步游标')
            this.getUpdatesBuf = ''
            this.saveSyncBuf()
          } else {
            // Bot token 本身过期，需要重新登录
            this.updateStatus({ status: 'error', errorMessage: '微信会话已过期，请重新扫码登录' })
            return
          }
          await sleep(5000)
          continue
        }

        // 其他服务端错误
        if (resp.ret !== 0 && resp.errcode) {
          console.warn('[微信 Bridge] 服务端错误:', resp.ret, resp.errcode, resp.errmsg)
          continue
        }

        // 更新同步游标
        if (resp.get_updates_buf) {
          this.getUpdatesBuf = resp.get_updates_buf
          this.saveSyncBuf()
        }

        // 处理消息
        for (const msg of resp.msgs) {
          this.handleMessage(msg)
        }
      } catch (error) {
        if (signal.aborted) return

        failures++
        const backoff = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, failures - 1), MAX_BACKOFF_MS)
        console.warn(`[微信 Bridge] 轮询失败 (${failures}/${MAX_CONSECUTIVE_FAILURES}, backoff=${backoff}ms):`, error)

        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          console.warn('[微信 Bridge] 连续失败过多，可能需要重新登录')
        }

        await sleep(backoff)
      }
    }
  }

  /** 处理收到的消息，委托给通用命令处理器 */
  private handleMessage(msg: WeChatIncomingMessage): void {
    // 只处理已完成的用户消息
    if (msg.message_type !== WECHAT_MESSAGE_TYPE.USER) return
    if (msg.message_state !== WECHAT_MESSAGE_STATE.FINISH) return

    const text = msg.item_list
      .filter((item) => item.type === WECHAT_ITEM_TYPE.TEXT && item.text_item)
      .map((item) => item.text_item!.text)
      .join('')

    if (!text.trim()) return

    console.log('[微信 Bridge] 收到消息:', {
      from: msg.from_user_id,
      messageId: msg.message_id,
      text: text.length > 100 ? text.slice(0, 100) + '...' : text,
    })

    // 委托给通用命令处理器（自动区分 / 命令 vs 普通消息）
    this.commandHandler.handleIncomingMessage(
      msg.from_user_id,
      text,
      { contextToken: msg.context_token },
    ).catch((error) => {
      console.error('[微信 Bridge] 处理消息失败:', error)
    })
  }

  // ===== 同步游标持久化 =====

  private loadSyncBuf(): void {
    const syncPath = getWeChatSyncPath()
    if (!existsSync(syncPath)) return
    try {
      const data = JSON.parse(readFileSync(syncPath, 'utf-8'))
      if (data.get_updates_buf) {
        this.getUpdatesBuf = data.get_updates_buf
        console.log('[微信 Bridge] 已加载同步游标')
      }
    } catch {
      // 忽略
    }
  }

  private saveSyncBuf(): void {
    const syncPath = getWeChatSyncPath()
    try {
      writeFileSync(syncPath, JSON.stringify({ get_updates_buf: this.getUpdatesBuf }), 'utf-8')
    } catch (error) {
      console.warn('[微信 Bridge] 保存同步游标失败:', error)
    }
  }

  // ===== 状态推送 =====

  private updateStatus(partial: Partial<WeChatBridgeState>): void {
    this.state = { ...this.state, ...partial }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(WECHAT_IPC_CHANNELS.STATUS_CHANGED, this.state)
      }
    }
  }
}

export const wechatBridge = new WeChatBridge()
