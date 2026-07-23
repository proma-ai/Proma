import { describe, expect, test } from 'bun:test'
import { buildWslBashArgs, windowsPathToWslPath } from './pi-agent-adapter'

describe('Pi WSL Bash', () => {
  test('Given a Windows workspace path When building WSL Bash arguments Then uses its mounted Linux path', () => {
    expect(buildWslBashArgs(
      { wslDistro: 'Ubuntu-24.04' },
      'C:\\Users\\alice\\Workspace\\project',
      'pwd',
      undefined,
    )).toEqual([
      '--distribution',
      'Ubuntu-24.04',
      '--cd',
      '/mnt/c/Users/alice/Workspace/project',
      '--exec',
      'bash',
      '-lc',
      'pwd',
    ])
  })

  test('Given a Linux path When converting for WSL Then leaves it unchanged', () => {
    expect(windowsPathToWslPath('/home/alice/project')).toBe('/home/alice/project')
  })
})
