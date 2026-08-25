import { expect, test } from 'bun:test'
import { getBuiltinMcpDefinitions, RESERVED_BUILTIN_KEYS } from './baseline'

test('Given Proma runtime tools When listing configurable integrated MCP capabilities Then only Nano Banana is exposed while runtime names stay reserved', () => {
  expect(getBuiltinMcpDefinitions().map((item) => item.id)).toEqual(['nano-banana'])
  expect(RESERVED_BUILTIN_KEYS).toEqual(new Set(['nano-banana', 'nano_banana', 'automation', 'collaboration']))
})
