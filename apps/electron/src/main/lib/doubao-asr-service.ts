/**
 * 豆包大模型流式 ASR 服务
 *
 * 主进程负责连接 OpenSpeech WebSocket，因为浏览器 WebSocket 无法设置
 * 豆包要求的自定义鉴权 Header。
 */

import type { BrowserWindow } from 'electron'
import { getCloudApiConfig } from '@proma/cloud'
import { randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import WebSocket from 'ws'
import type {
  VoiceDictationSettings,
  VoiceDictationTranscriptEvent,
  VoiceDictationStateEvent,
} from '../../types'
import { VOICE_DICTATION_IPC_CHANNELS } from '../../types'
import { getAuthToken, getCloudSessionRevision, tryRefreshAuthToken } from './cloud-auth-service'

const PROTOCOL_VERSION = 0b0001
const HEADER_SIZE = 0b0001

const MESSAGE_TYPE_FULL_CLIENT_REQUEST = 0b0001
const MESSAGE_TYPE_AUDIO_ONLY_REQUEST = 0b0010
const MESSAGE_TYPE_FULL_SERVER_RESPONSE = 0b1001
const MESSAGE_TYPE_SERVER_ERROR = 0b1111

const FLAG_NO_SEQUENCE = 0b0000
const FLAG_LAST_NO_SEQUENCE = 0b0010
const FLAG_SERVER_SEQUENCE = 0b0001
const FLAG_SERVER_LAST_SEQUENCE = 0b0011

const SERIALIZATION_NONE = 0b0000
const SERIALIZATION_JSON = 0b0001

const COMPRESSION_NONE = 0b0000
const COMPRESSION_GZIP = 0b0001

const ASYNC_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const DUPLEX_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel'
const DICTATION_END_WINDOW_SIZE_MS = 5000
const DICTATION_FORCE_TO_SPEECH_TIME_MS = 1000
const MAX_INLINE_HOTWORDS = 100
const HOTWORD_SEPARATOR_PATTERN = /[\n,，、;；]+/u

interface ServerUtterance {
  text?: string
  definite?: boolean
}

interface ServerResult {
  text?: string
  confidence?: number
  utterances?: ServerUtterance[]
}

interface ServerPayload {
  result?: ServerResult | ServerResult[]
  text?: string
  message?: string
  error?: string
}

interface ParsedServerMessage {
  text: string
  isFinal: boolean
}

interface DoubaoAsrHotword {
  word: string
}

interface DoubaoAsrCorpus {
  context: string
}

interface ActiveSession {
  sessionId: string
  ws: WebSocket
  win: BrowserWindow
  closed: boolean
  mode: 'cloud' | 'direct'
}

interface CloudSpeechResponse {
  text?: string
  is_final?: boolean
  isFinal?: boolean
  error?: string | {
    code?: string
    message?: string
  }
}

type WebSocketRawData = Buffer | ArrayBuffer | Buffer[]
type WebSocketTextSender = { send: (data: string) => void }

const activeSessions = new Map<string, ActiveSession>()

function isUsingCloud(settings: VoiceDictationSettings): boolean {
  return settings.cloudMode && settings.useCloud !== false
}

function getEndpoint(settings: VoiceDictationSettings): string {
  return settings.endpointMode === 'duplex' ? DUPLEX_ENDPOINT : ASYNC_ENDPOINT
}

async function getCloudSpeechToken(): Promise<string> {
  const revision = getCloudSessionRevision()
  const previousToken = getAuthToken()
  const token = await tryRefreshAuthToken(revision) ?? previousToken
  if (revision !== getCloudSessionRevision()) throw new Error('Cloud 账号已切换，请重新启动语音输入')
  if (!token) {
    throw new Error('请先登录 Proma Cloud 后再使用官方语音输入')
  }
  return token
}

async function buildCloudSpeechUrl(settings: VoiceDictationSettings): Promise<string> {
  const token = await getCloudSpeechToken()
  const { baseUrl } = getCloudApiConfig()
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/$/, '')}/speech/recognize`
  url.searchParams.set('token', token)
  url.searchParams.set('model_id', 'doubao-asr-bigmodel')
  url.searchParams.set('endpoint_mode', settings.endpointMode)
  if (settings.language) {
    url.searchParams.set('language', settings.language)
  }
  const hotwords = parseCustomHotwords(settings.customHotwords)
  if (hotwords.length > 0) {
    url.searchParams.set('hotwords', JSON.stringify(hotwords))
  }
  url.searchParams.set('end_window_size', String(DICTATION_END_WINDOW_SIZE_MS))
  url.searchParams.set('force_to_speech_time', String(DICTATION_FORCE_TO_SPEECH_TIME_MS))
  return url.toString()
}


function parseCustomHotwords(value: string): DoubaoAsrHotword[] {
  const seen = new Set<string>()
  const hotwords: DoubaoAsrHotword[] = []

  for (const rawWord of value.split(HOTWORD_SEPARATOR_PATTERN)) {
    const word = rawWord.trim()
    if (!word || seen.has(word)) continue
    seen.add(word)
    hotwords.push({ word })
    if (hotwords.length >= MAX_INLINE_HOTWORDS) break
  }

  return hotwords
}

function buildCorpus(settings: VoiceDictationSettings): DoubaoAsrCorpus | undefined {
  const hotwords = parseCustomHotwords(settings.customHotwords)
  if (hotwords.length === 0) return undefined

  return {
    context: JSON.stringify({ hotwords }),
  }
}

function buildHeader(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
): Buffer {
  return Buffer.from([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ])
}

function buildFrame(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
  payload: Buffer,
): Buffer {
  const header = buildHeader(messageType, flags, serialization, compression)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length, 0)
  return Buffer.concat([header, size, payload])
}

function buildClientRequest(settings: VoiceDictationSettings): Buffer {
  const audio: Record<string, unknown> = {
    format: 'pcm',
    codec: 'raw',
    rate: 16000,
    bits: 16,
    channel: 1,
  }
  if (settings.language) {
    audio.language = settings.language
  }

  const corpus = buildCorpus(settings)
  const requestOptions = {
    model_name: 'bigmodel',
    enable_nonstream: true,
    show_utterances: true,
    result_type: 'full',
    enable_itn: true,
    enable_punc: true,
    enable_ddc: true,
    // 听写场景允许用户自然停顿，避免 800ms 静音就过早切句。
    end_window_size: DICTATION_END_WINDOW_SIZE_MS,
    force_to_speech_time: DICTATION_FORCE_TO_SPEECH_TIME_MS,
    ...(corpus ? { corpus } : {}),
  }

  const request = {
    user: {
      uid: 'proma-desktop',
    },
    audio,
    request: requestOptions,
  }

  const payload = gzipSync(Buffer.from(JSON.stringify(request), 'utf-8'))
  return buildFrame(
    MESSAGE_TYPE_FULL_CLIENT_REQUEST,
    FLAG_NO_SEQUENCE,
    SERIALIZATION_JSON,
    COMPRESSION_GZIP,
    payload,
  )
}

function buildAudioFrame(audio: Buffer, isLast: boolean): Buffer {
  const payload = gzipSync(audio)
  return buildFrame(
    MESSAGE_TYPE_AUDIO_ONLY_REQUEST,
    isLast ? FLAG_LAST_NO_SEQUENCE : FLAG_NO_SEQUENCE,
    SERIALIZATION_NONE,
    COMPRESSION_GZIP,
    payload,
  )
}

function sendState(win: BrowserWindow, event: VoiceDictationStateEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send(VOICE_DICTATION_IPC_CHANNELS.STATE, event)
  }
}

function sendTranscript(win: BrowserWindow, event: VoiceDictationTranscriptEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send(VOICE_DICTATION_IPC_CHANNELS.TRANSCRIPT, event)
  }
}

function getResultText(result: ServerResult): string {
  return result.text ?? result.utterances?.map((item) => item.text ?? '').join('') ?? ''
}

function getAuthoritativeResult(results: ServerResult[]): ServerResult | null {
  const candidates = results
    .map((result) => ({ result, text: getResultText(result) }))
    .filter((item) => item.text.trim().length > 0)

  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]!.result

  // result 数组表示识别候选，不是需要拼接的分句；拼接会制造重复文本。
  return [...candidates]
    .sort((left, right) => (right.result.confidence ?? 0) - (left.result.confidence ?? 0))[0]!
    .result
}

function isResultFinal(result: ServerResult): boolean {
  return result.utterances?.some((item) => item.definite === true) ?? false
}

function parseServerPayload(value: unknown, fallbackFinal: boolean): ParsedServerMessage | null {
  if (typeof value !== 'object' || value === null) return null
  const payload = value as ServerPayload
  const results = Array.isArray(payload.result)
    ? payload.result
    : payload.result
      ? [payload.result]
      : []

  if (results.length === 0) {
    const message = payload.text ?? payload.message ?? payload.error
    return message ? { text: message, isFinal: fallbackFinal } : null
  }

  if (payload.text) {
    return {
      text: payload.text,
      isFinal: fallbackFinal || results.some(isResultFinal),
    }
  }

  const authoritativeResult = getAuthoritativeResult(results)
  const text = authoritativeResult ? getResultText(authoritativeResult) : ''
  const utteranceFinal = authoritativeResult ? isResultFinal(authoritativeResult) : false
  if (!text) return null
  return {
    text,
    isFinal: fallbackFinal || utteranceFinal,
  }
}

function parseServerMessage(data: Buffer): ParsedServerMessage | null {
  if (data.length < 8) return null

  const headerSize = (data[0]! & 0x0f) * 4
  const messageType = data[1]! >> 4
  const flags = data[1]! & 0x0f
  const serialization = data[2]! >> 4
  const compression = data[2]! & 0x0f
  let offset = headerSize

  const hasSequence = flags === FLAG_SERVER_SEQUENCE || flags === FLAG_SERVER_LAST_SEQUENCE
  if (hasSequence) {
    offset += 4
  }

  if (messageType === MESSAGE_TYPE_SERVER_ERROR) {
    if (data.length < offset + 8) return null
    const code = data.readUInt32BE(offset)
    offset += 4
    const size = data.readUInt32BE(offset)
    offset += 4
    const message = data.subarray(offset, offset + size).toString('utf-8')
    return { text: `豆包 ASR 错误 ${code}: ${message}`, isFinal: true }
  }

  if (messageType !== MESSAGE_TYPE_FULL_SERVER_RESPONSE || data.length < offset + 4) {
    return null
  }

  const payloadSize = data.readUInt32BE(offset)
  offset += 4
  const payload = data.subarray(offset, offset + payloadSize)
  const decoded = compression === COMPRESSION_GZIP ? gunzipSync(payload) : payload

  if (serialization !== SERIALIZATION_JSON) return null
  const parsed = JSON.parse(decoded.toString('utf-8')) as unknown
  return parseServerPayload(parsed, flags === FLAG_SERVER_LAST_SEQUENCE)
}

function rawDataToBuffer(message: WebSocketRawData): Buffer {
  if (Array.isArray(message)) return Buffer.concat(message)
  if (Buffer.isBuffer(message)) return message
  return Buffer.from(message)
}

function parseCloudSpeechMessage(message: WebSocketRawData): ParsedServerMessage | null {
  const text = rawDataToBuffer(message).toString('utf-8')
  const parsed = JSON.parse(text) as CloudSpeechResponse

  if (parsed.error) {
    if (typeof parsed.error === 'string') {
      throw new Error(parsed.error)
    }
    throw new Error(parsed.error.message || parsed.error.code || '云端语音输入失败')
  }

  if (!parsed.text) return null
  return {
    text: parsed.text,
    isFinal: parsed.is_final ?? parsed.isFinal ?? false,
  }
}

function sendTextFrame(ws: WebSocket, text: string): void {
  (ws as unknown as WebSocketTextSender).send(text)
}

/** 测试豆包 ASR 连接，仅验证 WebSocket 握手和鉴权 Header。 */
export async function testDoubaoAsrConnection(
  settings: VoiceDictationSettings,
): Promise<{ success: boolean; message: string }> {
  if (isUsingCloud(settings)) {
    try {
      await getCloudSpeechToken()
      return { success: true, message: 'Proma 官方语音输入已就绪' }
    } catch (error) {
      const message = error instanceof Error ? error.message : '请先登录 Proma Cloud'
      return { success: false, message }
    }
  }

  if (!settings.appId || !settings.accessToken || !settings.resourceId) {
    return { success: false, message: '请先填写 APP ID、Access Token 和 Resource ID' }
  }

  return await new Promise((resolve) => {
    const ws = new WebSocket(getEndpoint(settings), {
      headers: {
        'X-Api-App-Key': settings.appId,
        'X-Api-Access-Key': settings.accessToken,
        'X-Api-Resource-Id': settings.resourceId,
        'X-Api-Connect-Id': randomUUID(),
      },
    })

    const timer = setTimeout(() => {
      ws.terminate()
      resolve({ success: false, message: '连接超时，请检查网络或凭证' })
    }, 8000)

    ws.once('open', () => {
      clearTimeout(timer)
      ws.close()
      resolve({ success: true, message: '豆包 ASR 连接成功' })
    })

    ws.once('error', (error: Error) => {
      clearTimeout(timer)
      resolve({ success: false, message: `连接失败: ${error.message}` })
    })
  })
}

export async function startDoubaoAsrSession(
  sessionId: string,
  settings: VoiceDictationSettings,
  win: BrowserWindow,
): Promise<void> {
  const useCloud = isUsingCloud(settings)
  if (!useCloud && (!settings.appId || !settings.accessToken || !settings.resourceId)) {
    throw new Error('请先填写豆包 ASR 凭证')
  }

  await stopDoubaoAsrSession(sessionId)
  sendState(win, {
    sessionId,
    status: 'connecting',
    message: useCloud ? '正在连接 Proma 官方语音输入...' : '正在连接豆包 ASR...',
  })

  const url = useCloud ? await buildCloudSpeechUrl(settings) : getEndpoint(settings)

  await new Promise<void>((resolve, reject) => {
    const ws = useCloud
      ? new WebSocket(url)
      : new WebSocket(url, {
          headers: {
            'X-Api-App-Key': settings.appId,
            'X-Api-Access-Key': settings.accessToken,
            'X-Api-Resource-Id': settings.resourceId,
            'X-Api-Connect-Id': randomUUID(),
          },
        })

    const active: ActiveSession = {
      sessionId,
      ws,
      win,
      closed: false,
      mode: useCloud ? 'cloud' : 'direct',
    }
    activeSessions.set(sessionId, active)
    let connected = false
    let settled = false
    let socketErrored = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }

    const timer = setTimeout(() => {
      const error = new Error('连接豆包 ASR 超时')
      activeSessions.delete(sessionId)
      sendState(win, { sessionId, status: 'error', message: error.message })
      fail(error)
      ws.terminate()
    }, 10000)

    ws.once('open', () => {
      if (settled) return
      clearTimeout(timer)
      connected = true
      settled = true
      if (!useCloud) {
        ws.send(buildClientRequest(settings))
      }
      sendState(win, { sessionId, status: 'recording', message: '正在听写' })
      resolve()
    })

    ws.on('message', (message: WebSocketRawData) => {
      try {
        const parsed = active.mode === 'cloud'
          ? parseCloudSpeechMessage(message)
          : parseServerMessage(rawDataToBuffer(message))
        if (parsed) {
          sendTranscript(win, {
            sessionId,
            text: parsed.text,
            isFinal: parsed.isFinal,
          })
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : '未知解析错误'
        sendState(win, {
          sessionId,
          status: 'error',
          message: active.mode === 'cloud'
            ? `云端语音输入失败: ${messageText}`
            : `解析 ASR 响应失败: ${messageText}`,
        })
      }
    })

    ws.on('close', () => {
      clearTimeout(timer)
      active.closed = true
      activeSessions.delete(sessionId)
      if (!connected) {
        if (!settled) {
          const error = new Error('连接豆包 ASR 在建立前已关闭')
          sendState(win, { sessionId, status: 'error', message: error.message })
          fail(error)
        }
        return
      }
      // WebSocket transport error already notified the renderer; do not reclassify it
      // as a normal/VAD close, which would trigger the automatic reconnect path.
      if (socketErrored) return
      sendState(win, { sessionId, status: 'idle', message: 'asr_session_ended' })
    })

    ws.once('error', (error: Error) => {
      socketErrored = true
      clearTimeout(timer)
      activeSessions.delete(sessionId)
      sendState(win, { sessionId, status: 'error', message: error.message })
      fail(error)
    })
  })
}

export function sendDoubaoAsrAudio(sessionId: string, data: ArrayBuffer): void {
  const active = activeSessions.get(sessionId)
  if (!active || active.closed || active.ws.readyState !== WebSocket.OPEN) return
  const audio = Buffer.from(data)
  if (audio.length === 0) return
  active.ws.send(active.mode === 'cloud' ? audio : buildAudioFrame(audio, false))
}

export async function stopDoubaoAsrSession(sessionId: string): Promise<void> {
  const active = activeSessions.get(sessionId)
  if (!active || active.closed) return

  if (active.ws.readyState === WebSocket.OPEN) {
    if (active.mode === 'cloud') {
      sendTextFrame(active.ws, 'stop')
    } else {
      active.ws.send(buildAudioFrame(Buffer.alloc(0), true))
    }
    setTimeout(() => {
      if (!active.closed) active.ws.close()
    }, 800)
  } else {
    active.ws.terminate()
  }
}

export function cancelDoubaoAsrSession(sessionId: string): void {
  const active = activeSessions.get(sessionId)
  if (!active) return
  active.ws.terminate()
  activeSessions.delete(sessionId)
}

export function cancelAllDoubaoAsrSessions(): void {
  for (const session of activeSessions.values()) {
    session.ws.terminate()
  }
  activeSessions.clear()
}
