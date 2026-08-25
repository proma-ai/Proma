import { expect, test } from 'bun:test'
import { getBuiltinMcpDefinitions, RESERVED_BUILTIN_KEYS } from './baseline'

test('Given commercial Proma runtime tools When listing integrated MCP capabilities Then Cloud and Nano Banana are exposed while runtime names stay reserved', () => {
  expect(getBuiltinMcpDefinitions().map((item) => item.id)).toEqual(['proma-cloud', 'nano-banana'])
  expect(RESERVED_BUILTIN_KEYS).toEqual(new Set(['proma-cloud', 'proma_cloud', 'nano-banana', 'nano_banana', 'automation', 'collaboration']))
})
