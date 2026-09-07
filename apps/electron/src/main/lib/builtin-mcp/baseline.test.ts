import { expect, test } from 'bun:test'
import { getBuiltinMcpDefinitions, RESERVED_BUILTIN_KEYS } from './baseline'

test('Given commercial Proma runtime tools When listing integrated MCP capabilities Then Cloud gateway is exposed while runtime names stay reserved', () => {
  expect(getBuiltinMcpDefinitions().map((item) => item.id)).toEqual(['proma-cloud'])
  expect(RESERVED_BUILTIN_KEYS).toEqual(new Set(['proma-cloud', 'proma_cloud', 'automation', 'collaboration']))
})
