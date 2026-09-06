import { expect, test } from 'bun:test'
import { getBuiltinMcpDefinitions, RESERVED_BUILTIN_KEYS } from './baseline'

test('Given legacy search and image tools are removed When listing integrated MCP capabilities Then no legacy tools are exposed and only runtime names stay reserved', () => {
  expect(getBuiltinMcpDefinitions()).toEqual([])
  expect(RESERVED_BUILTIN_KEYS).toEqual(new Set(['automation', 'collaboration']))
})
