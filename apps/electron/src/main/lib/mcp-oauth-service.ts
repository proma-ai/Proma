/**
 * Remote MCP OAuth service.
 *
 * OAuth access and refresh tokens are encrypted with Electron safeStorage before
 * persistence. Workspace mcp.json receives only transport configuration.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { safeStorage, shell } from 'electron'
import type { McpOAuthProvider, McpOAuthStartResult, StartMcpOAuthInput } from '@proma/shared'
import { getMcpOAuthCredentialsPath } from './config-paths'
import { writeJsonFileAtomic } from './safe-file'
import { runWithOAuthProxyScope } from './oauth-proxy-scope'

const CALLBACK_PATH = '/callback'
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000
const EXPIRY_SKEW_MS = 60 * 1000

interface OAuthProtectedResourceMetadata {
  authorization_servers?: unknown
  scopes_supported?: unknown
}

interface OAuthAuthorizationServerMetadata {
  authorization_endpoint?: unknown
  token_endpoint?: unknown
  registration_endpoint?: unknown
}

interface OAuthClientRegistration {
  client_id?: unknown
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
}

interface McpOAuthCredential {
  provider: McpOAuthProvider
  serverUrl: string
  /** RFC 8707 resource indicator, retained as non-secret credential metadata. */
  resource?: string
  clientId: string
  tokenEndpoint: string
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

interface McpApiKeyCredential {
  kind: 'api-key'
  serverUrl: string
  headerName: string
  value: string
}

type McpCredential = McpOAuthCredential | McpApiKeyCredential

interface McpOAuthCredentialFile {
  version: 1
  credentials: Record<string, string>
}

interface AuthorizationConfiguration {
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  scopes: string[]
}

function credentialKey(workspaceSlug: string, serverName: string): string {
  return `${workspaceSlug}:${serverName}`
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(48))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function parseString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`OAuth 元数据缺少 ${fieldName}`)
  return value
}

function ensureHttpsUrl(value: string, fieldName: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`OAuth ${fieldName} 不是有效 URL`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`OAuth ${fieldName} 必须使用 HTTPS`)
  return parsed.toString()
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

async function fetchJson<T>(url: string, message: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`${message}（HTTP ${response.status}）`)
  return response.json() as Promise<T>
}

export function normalizeMcpResource(serverUrl: string): string {
  return new URL(serverUrl).toString()
}

export function protectedResourceMetadataUrl(serverUrl: string): string {
  const resource = new URL(serverUrl)
  const resourcePath = resource.pathname.replace(/\/$/, '')
  return new URL(`/.well-known/oauth-protected-resource${resourcePath}`, resource.origin).toString()
}

/** RFC 8414 inserts the issuer path after the host-level well-known prefix. */
export function authorizationServerMetadataUrl(authorizationServer: string): string {
  const issuer = new URL(authorizationServer)
  const issuerPath = issuer.pathname === '/' ? '' : issuer.pathname
  return new URL(`/.well-known/oauth-authorization-server${issuerPath}`, issuer.origin).toString()
}

async function discoverAuthorizationConfiguration(serverUrl: string): Promise<AuthorizationConfiguration> {
  const protectedResource = await fetchJson<OAuthProtectedResourceMetadata>(
    protectedResourceMetadataUrl(serverUrl),
    '无法读取 MCP OAuth 资源元数据',
  )
  const authorizationServer = ensureHttpsUrl(
    parseString(parseStringArray(protectedResource.authorization_servers)[0], 'authorization_servers'),
    'authorization server',
  )
  const metadataUrl = authorizationServerMetadataUrl(authorizationServer)
  const metadata = await fetchJson<OAuthAuthorizationServerMetadata>(metadataUrl, '无法读取 OAuth 授权服务器元数据')

  return {
    authorizationEndpoint: ensureHttpsUrl(parseString(metadata.authorization_endpoint, 'authorization_endpoint'), 'authorization_endpoint'),
    tokenEndpoint: ensureHttpsUrl(parseString(metadata.token_endpoint, 'token_endpoint'), 'token_endpoint'),
    registrationEndpoint: ensureHttpsUrl(parseString(metadata.registration_endpoint, 'registration_endpoint'), 'registration_endpoint'),
    scopes: parseStringArray(protectedResource.scopes_supported),
  }
}

async function registerClient(registrationEndpoint: string, redirectUri: string): Promise<string> {
  const response = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Proma',
      application_type: 'native',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (!response.ok) throw new Error(`OAuth 动态客户端注册失败（HTTP ${response.status}）`)
  const registration = await response.json() as OAuthClientRegistration
  return parseString(registration.client_id, 'client_id')
}

function closeServer(server: Server): void {
  server.close(() => undefined)
}

async function startCallbackServer(state: string): Promise<{ redirectUri: string; waitForCode: Promise<string>; cancel: () => void }> {
  let resolveCode!: (code: string) => void
  let rejectCode!: (reason: Error) => void
  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (requestUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }

    const returnedState = requestUrl.searchParams.get('state')
    const code = requestUrl.searchParams.get('code')
    const error = requestUrl.searchParams.get('error')
    const received = returnedState ? Buffer.from(returnedState) : Buffer.alloc(0)
    const expected = Buffer.from(state)
    const stateMatches = received.length === expected.length && timingSafeEqual(received, expected)

    response.writeHead(stateMatches && code ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(stateMatches && code
      ? '<!doctype html><title>Proma</title><p>授权完成，可以关闭此页面并返回 Proma。</p>'
      : '<!doctype html><title>Proma</title><p>授权未完成，请返回 Proma 重试。</p>')

    closeServer(server)
    if (!stateMatches) rejectCode(new Error('OAuth state 校验失败，已拒绝回调'))
    else if (error) rejectCode(new Error(`OAuth 授权被拒绝：${error}`))
    else if (!code) rejectCode(new Error('OAuth 回调缺少授权码'))
    else resolveCode(code)
  })

  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const activeAddress = server.address()
      if (!activeAddress || typeof activeAddress === 'string') {
        reject(new Error('无法分配 OAuth 本地回调端口'))
        return
      }
      resolve({ port: activeAddress.port })
    })
  })

  void waitForCode.catch(() => undefined)
  const timeout = setTimeout(() => {
    closeServer(server)
    rejectCode(new Error('OAuth 授权超时，请重新连接'))
  }, CALLBACK_TIMEOUT_MS)
  void waitForCode.finally(() => clearTimeout(timeout)).catch(() => undefined)

  return {
    redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
    waitForCode,
    cancel: () => {
      clearTimeout(timeout)
      closeServer(server)
      rejectCode(new Error('OAuth 授权已取消'))
    },
  }
}

export async function exchangeAuthorizationCode(input: {
  tokenEndpoint: string
  clientId: string
  redirectUri: string
  code: string
  verifier: string
  resource?: string
}): Promise<Pick<McpOAuthCredential, 'accessToken' | 'refreshToken' | 'expiresAt'>> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.verifier,
  })
  if (input.resource) body.set('resource', input.resource)
  const response = await fetch(input.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  if (!response.ok) throw new Error(`OAuth 授权码交换失败（HTTP ${response.status}）`)
  const token = await response.json() as TokenResponse
  const expiresIn = typeof token.expires_in === 'number' && token.expires_in > 0 ? token.expires_in : undefined
  return {
    accessToken: parseString(token.access_token, 'access_token'),
    ...(typeof token.refresh_token === 'string' && token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(expiresIn ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
  }
}

function readCredentialFile(): McpOAuthCredentialFile {
  const path = getMcpOAuthCredentialsPath()
  if (!existsSync(path)) return { version: 1, credentials: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<McpOAuthCredentialFile>
    return { version: 1, credentials: parsed.credentials && typeof parsed.credentials === 'object' ? parsed.credentials : {} }
  } catch {
    return { version: 1, credentials: {} }
  }
}

function encryptCredential(credential: McpCredential): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统 Keychain 不可用，无法安全保存 MCP 凭据')
  return safeStorage.encryptString(JSON.stringify(credential)).toString('base64')
}

function decryptCredential(encrypted: string): McpCredential | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  try {
    const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) as Record<string, unknown>
    if (parsed.kind === 'api-key' && typeof parsed.serverUrl === 'string' && typeof parsed.headerName === 'string' && typeof parsed.value === 'string') {
      return { kind: 'api-key', serverUrl: parsed.serverUrl, headerName: parsed.headerName, value: parsed.value }
    }
    if (typeof parsed.accessToken !== 'string' || typeof parsed.clientId !== 'string' || typeof parsed.tokenEndpoint !== 'string' || typeof parsed.serverUrl !== 'string' || typeof parsed.provider !== 'string') return undefined
    return {
      provider: parsed.provider as McpOAuthProvider,
      serverUrl: parsed.serverUrl,
      clientId: parsed.clientId,
      tokenEndpoint: parsed.tokenEndpoint,
      accessToken: parsed.accessToken,
      ...(typeof parsed.resource === 'string' && parsed.resource ? { resource: parsed.resource } : {}),
      ...(typeof parsed.refreshToken === 'string' && parsed.refreshToken ? { refreshToken: parsed.refreshToken } : {}),
      ...(typeof parsed.expiresAt === 'number' ? { expiresAt: parsed.expiresAt } : {}),
    }
  } catch {
    return undefined
  }
}

function isMcpApiKeyCredential(credential: McpCredential): credential is McpApiKeyCredential {
  return 'kind' in credential && credential.kind === 'api-key'
}

function saveCredential(workspaceSlug: string, serverName: string, credential: McpCredential): void {
  const file = readCredentialFile()
  file.credentials[credentialKey(workspaceSlug, serverName)] = encryptCredential(credential)
  writeJsonFileAtomic(getMcpOAuthCredentialsPath(), file)
}

function readCredential(workspaceSlug: string, serverName: string): McpCredential | undefined {
  const encrypted = readCredentialFile().credentials[credentialKey(workspaceSlug, serverName)]
  return encrypted ? decryptCredential(encrypted) : undefined
}

export function deleteMcpCredential(workspaceSlug: string, serverName: string): void {
  const file = readCredentialFile()
  const key = credentialKey(workspaceSlug, serverName)
  if (!(key in file.credentials)) return
  delete file.credentials[key]
  writeJsonFileAtomic(getMcpOAuthCredentialsPath(), file)
}

export async function refreshCredential(credential: McpOAuthCredential): Promise<McpOAuthCredential> {
  if (!credential.refreshToken) throw new Error('MCP OAuth 凭据已过期，请重新授权')
  const response = await fetch(credential.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: (() => {
      const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: credential.clientId, refresh_token: credential.refreshToken })
      if (credential.resource) body.set('resource', credential.resource)
      return body
    })(),
  })
  if (!response.ok) throw new Error(`MCP OAuth 刷新失败（HTTP ${response.status}），请重新授权`)
  const token = await response.json() as TokenResponse
  const expiresIn = typeof token.expires_in === 'number' && token.expires_in > 0 ? token.expires_in : undefined
  return {
    ...credential,
    accessToken: parseString(token.access_token, 'access_token'),
    ...(typeof token.refresh_token === 'string' && token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(expiresIn ? { expiresAt: Date.now() + expiresIn * 1000 } : { expiresAt: undefined }),
  }
}

/** Start a standards-based authorization-code + PKCE flow for a remote MCP. */
export async function startMcpOAuth(input: StartMcpOAuthInput): Promise<McpOAuthStartResult> {
  const state = base64Url(randomBytes(32))
  const { verifier, challenge } = createPkcePair()
  const callback = await startCallbackServer(state)

  try {
    const result = await runWithOAuthProxyScope(async () => {
      const configuration = await discoverAuthorizationConfiguration(input.serverUrl)
      const clientId = await registerClient(configuration.registrationEndpoint, callback.redirectUri)
      const authorizationUrl = new URL(configuration.authorizationEndpoint)
      authorizationUrl.searchParams.set('response_type', 'code')
      authorizationUrl.searchParams.set('client_id', clientId)
      authorizationUrl.searchParams.set('redirect_uri', callback.redirectUri)
      authorizationUrl.searchParams.set('code_challenge', challenge)
      authorizationUrl.searchParams.set('code_challenge_method', 'S256')
      authorizationUrl.searchParams.set('state', state)
      const resource = normalizeMcpResource(input.serverUrl)
      authorizationUrl.searchParams.set('resource', resource)
      if (configuration.scopes.length > 0) authorizationUrl.searchParams.set('scope', configuration.scopes.join(' '))

      await shell.openExternal(authorizationUrl.toString())
      const code = await callback.waitForCode
      const token = await exchangeAuthorizationCode({
        tokenEndpoint: configuration.tokenEndpoint,
        clientId,
        redirectUri: callback.redirectUri,
        code,
        verifier,
        resource,
      })
      return { configuration, clientId, resource, token }
    })
    saveCredential(input.workspaceSlug, input.serverName, {
      provider: input.provider,
      serverUrl: input.serverUrl,
      resource: result.resource,
      clientId: result.clientId,
      tokenEndpoint: result.configuration.tokenEndpoint,
      ...result.token,
    })
    return { provider: input.provider, serverName: input.serverName, expiresAt: result.token.expiresAt }
  } catch (error) {
    callback.cancel()
    throw error
  }
}

export function saveMcpApiKey(input: {
  workspaceSlug: string
  serverName: string
  serverUrl: string
  headerName: string
  value: string
}): void {
  if (!input.value.trim()) throw new Error('请输入凭据')
  if (!input.headerName.trim()) throw new Error('凭据请求头不能为空')
  saveCredential(input.workspaceSlug, input.serverName, {
    kind: 'api-key',
    serverUrl: normalizeMcpResource(input.serverUrl),
    headerName: input.headerName,
    value: input.value.trim(),
  })
}

/** Resolve a current authentication header for a configured remote MCP without exposing its token to the renderer. */
export async function getMcpOAuthHeaders(workspaceSlug: string, serverName: string, serverUrl: string): Promise<Record<string, string> | undefined> {
  let credential = readCredential(workspaceSlug, serverName)
  if (!credential || credential.serverUrl !== normalizeMcpResource(serverUrl)) return undefined
  if (isMcpApiKeyCredential(credential)) return { [credential.headerName]: credential.value }
  const oauthCredential = credential
  if (oauthCredential.expiresAt && oauthCredential.expiresAt <= Date.now() + EXPIRY_SKEW_MS) {
    const refreshedCredential = await runWithOAuthProxyScope(() => refreshCredential(oauthCredential))
    saveCredential(workspaceSlug, serverName, refreshedCredential)
    return { Authorization: `Bearer ${refreshedCredential.accessToken}` }
  }
  return { Authorization: `Bearer ${oauthCredential.accessToken}` }
}
