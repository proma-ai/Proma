/**
 * Chrome DevTools MCP builtin server.
 *
 * This is a lightweight stdio MCP entry backed by the npm package
 * `chrome-devtools-mcp`. Claude runtime receives it through native mcpServers;
 * Pi runtime uses the existing Pi MCP bridge to convert the server tools into
 * Pi customTools.
 */

import { getBuiltinMcpName } from './baseline'

function npxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

const PROXY_ENV_KEYS = new Set([
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
])

function getProxyEnv(runtimeEnv?: Record<string, string>): Record<string, string> {
  if (!runtimeEnv) return {}
  return Object.fromEntries(
    Object.entries(runtimeEnv).filter(([key]) => PROXY_ENV_KEYS.has(key)),
  )
}

export function injectChromeDevtoolsMcpServer(
  mcpServers: Record<string, Record<string, unknown>>,
  runtimeEnv?: Record<string, string>,
): void {
  const name = getBuiltinMcpName('chrome-devtools')
  if (mcpServers[name]) return

  mcpServers[name] = {
    type: 'stdio',
    command: npxCommand(),
    args: ['-y', 'chrome-devtools-mcp@latest'],
    // Chrome DevTools is an optional visual-inspection enhancement. Startup
    // failures (missing npx, first-run package download failure, no Chrome,
    // etc.) must not block the main Agent session.
    required: false,
    // Optional MCP 启动在后台进行；5 秒后放弃本次连接并由后续会话重试，不能阻塞 Agent 首包。
    startup_timeout_sec: 5,
    env: {
      ...(process.env.PATH && { PATH: process.env.PATH }),
      ...(process.env.HOME && { HOME: process.env.HOME }),
      ...(process.env.USERPROFILE && { USERPROFILE: process.env.USERPROFILE }),
      ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
      ...(process.env.TEMP && { TEMP: process.env.TEMP }),
      ...(process.env.TMP && { TMP: process.env.TMP }),
      ...getProxyEnv(runtimeEnv),
    },
    timeout: 60,
  }
}
