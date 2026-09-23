import { expect, test } from 'bun:test'
import { MCP_INTEGRATION_CATALOG, compareCatalogConnectionCards, type CatalogCredentialIntegration } from './integration-catalog'

function credentialIntegration(id: string): CatalogCredentialIntegration {
  const integration = MCP_INTEGRATION_CATALOG.find((item) => item.id === id)
  if (!integration || integration.kind !== 'credential') throw new Error(`missing credential integration: ${id}`)
  return integration
}

test('Given the MCP connection catalog When listing search providers Then Brave and Tavily require only their API key with official console links', () => {
  const brave = credentialIntegration('brave-search-mcp')
  const tavily = credentialIntegration('tavily-search-mcp')

  expect(brave.entry).toEqual({
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
    enabled: false,
  })
  expect(brave.credential).toMatchObject({
    envName: 'BRAVE_API_KEY',
    credentialStorageUrl: 'https://api.search.brave.com/',
    acquisitionUrl: 'https://api-dashboard.search.brave.com/app/keys',
  })

  expect(tavily.entry).toEqual({ type: 'http', url: 'https://mcp.tavily.com/mcp', enabled: false })
  expect(tavily.credential).toMatchObject({
    headerName: 'Authorization',
    valuePrefix: 'Bearer ',
    credentialStorageUrl: 'https://mcp.tavily.com/mcp',
    acquisitionUrl: 'https://app.tavily.com/home',
  })
})

test('Given no AnySearch API key When choosing the built-in AnySearch card Then an anonymous official MCP connection is available', () => {
  const anysearch = MCP_INTEGRATION_CATALOG.find((item) => item.id === 'anysearch-mcp')
  expect(anysearch).toMatchObject({
    kind: 'mcp',
    authentication: 'none',
    serverName: 'anysearch',
    entry: { type: 'http', url: 'https://api.anysearch.com/mcp', enabled: true },
  })
  expect(anysearch?.capabilities).toEqual(['通用与垂直搜索', '并行搜索', '网页正文提取'])
})

test('搜索服务目录顺序固定为飞书、钉钉、企业微信、Tavily、Brave，再到其他集成', () => {
  const expected = ['feishu-cli', 'dingtalk-cli', 'wecom-cli', 'tavily-search-mcp', 'brave-search-mcp']
  const actual = [...MCP_INTEGRATION_CATALOG]
    .sort((left, right) => compareCatalogConnectionCards(
      { priority: left.priority, placement: left.placement, featured: left.featured, statusRank: 1 },
      { priority: right.priority, placement: right.placement, featured: right.featured, statusRank: 1 },
    ))
    .map((integration) => integration.id)

  expect(actual.slice(0, expected.length)).toEqual(expected)
})
