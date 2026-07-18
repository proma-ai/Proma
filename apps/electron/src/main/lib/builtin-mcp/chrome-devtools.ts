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

export function injectChromeDevtoolsMcpServer(mcpServers: Record<string, Record<string, unknown>>): void {
  const name = getBuiltinMcpName('chrome-devtools')
  if (mcpServers[name]) return

  mcpServers[name] = {
    type: 'stdio',
    command: npxCommand(),
    args: ['-y', 'chrome-devtools-mcp@latest'],
    env: {
      ...(process.env.PATH && { PATH: process.env.PATH }),
      ...(process.env.HOME && { HOME: process.env.HOME }),
      ...(process.env.USERPROFILE && { USERPROFILE: process.env.USERPROFILE }),
      ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
      ...(process.env.TEMP && { TEMP: process.env.TEMP }),
      ...(process.env.TMP && { TMP: process.env.TMP }),
    },
    timeout: 60,
  }
}
