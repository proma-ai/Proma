/**
 * ChatGPT (OpenAI Codex) OAuth 登录服务
 *
 * 复用 Pi SDK（@earendil-works/pi-ai/oauth）内置的 Codex OAuth 流程完成登录：
 * - 登录必须在主进程（Node 侧）执行——SDK 使用 Node crypto 生成 PKCE，并在
 *   本地 127.0.0.1:1455 起回调服务接收授权码，无法在渲染进程运行。
 * - 浏览器由本服务通过 shell.openExternal 打开；SDK 内部的回调服务负责接收
 *   redirect 并完成 code→token 交换，最终返回 { access, refresh, expires, accountId }。
 *
 * token 的加密存储与过期刷新由上层（channel-manager / pi-model-registry）负责，
 * 本服务只封装"跑一次登录流程""刷新一次 token"两个纯操作。
 */

import { shell } from 'electron'
import type { CodexOAuthCredentials } from '@proma/shared'

/** Pi SDK oauth 模块类型（external 包，运行时动态 import） */
type PiOAuthModule = typeof import('@earendil-works/pi-ai/oauth')

let piOAuthPromise: Promise<PiOAuthModule> | undefined

function loadPiOAuth(): Promise<PiOAuthModule> {
  piOAuthPromise ??= import('@earendil-works/pi-ai/oauth')
  return piOAuthPromise
}

/** 进行中的登录流程的取消控制器（同一时刻只允许一个登录流程）。 */
let activeLoginAbort: AbortController | undefined

export interface CodexLoginCallbacks {
  /** SDK 生成授权 URL 后回调，用于（除自动开浏览器外）通知渲染层展示 URL。 */
  onAuthUrl?: (url: string) => void
  /** 进度消息回调。 */
  onProgress?: (message: string) => void
}

/**
 * 发起一次 ChatGPT (Codex) 浏览器 OAuth 登录。
 *
 * 成功返回规范化的 OAuth 凭据；用户取消或失败则抛错。
 * 登录期间自动用系统浏览器打开授权页，SDK 内部回调服务（:1455）接收授权码。
 */
export async function loginCodexOAuth(callbacks?: CodexLoginCallbacks): Promise<CodexOAuthCredentials> {
  const { loginOpenAICodex } = await loadPiOAuth()

  // 取消上一个仍在进行的登录流程，避免 :1455 端口占用与并发回调。
  activeLoginAbort?.abort()
  const abort = new AbortController()
  activeLoginAbort = abort

  try {
    const credentials = await loginOpenAICodex({
      onAuth: (info: { url: string; instructions?: string }) => {
        callbacks?.onAuthUrl?.(info.url)
        // 自动打开系统浏览器进行授权；失败仅记录，用户仍可从 UI 手动打开。
        shell.openExternal(info.url).catch((err) => {
          console.error('[Codex OAuth] 打开浏览器失败:', err)
        })
      },
      onProgress: (message: string) => {
        console.log(`[Codex OAuth] ${message}`)
        callbacks?.onProgress?.(message)
      },
      // 浏览器流程以 :1455 本地回调服务为主路径完成；手动粘贴码不在 v1 UI 中提供，
      // 用一个永不 resolve 的 promise 占位，交由回调服务赢得竞争。
      onPrompt: () => new Promise<string>(() => {}),
    })

    return {
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
      ...(typeof credentials.accountId === 'string' && credentials.accountId
        ? { accountId: credentials.accountId }
        : {}),
    }
  } finally {
    if (activeLoginAbort === abort) {
      activeLoginAbort = undefined
    }
  }
}

/** 取消进行中的 Codex OAuth 登录流程（若有）。 */
export function cancelCodexOAuthLogin(): void {
  activeLoginAbort?.abort()
  activeLoginAbort = undefined
}

/**
 * 用 refresh token 刷新 Codex OAuth 凭据。
 *
 * 返回新的规范化凭据（含新的 expires）。SDK 在 refresh token 未轮换时会复用旧值。
 */
export async function refreshCodexOAuth(refreshToken: string): Promise<CodexOAuthCredentials> {
  const { refreshOpenAICodexToken } = await loadPiOAuth()
  const credentials = await refreshOpenAICodexToken(refreshToken)
  return {
    access: credentials.access,
    refresh: credentials.refresh,
    expires: credentials.expires,
    ...(typeof credentials.accountId === 'string' && credentials.accountId
      ? { accountId: credentials.accountId }
      : {}),
  }
}
