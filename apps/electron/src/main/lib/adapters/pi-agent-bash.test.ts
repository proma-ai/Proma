import { describe, expect, test } from 'bun:test'
import { buildWslBashArgs, isPiBashToolAvailable, isPiPowerShellToolAvailable, selectPiBuiltinShellTool, windowsPathToWslPath } from './pi-agent-adapter'

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

  test('Given Windows without Git Bash or WSL When resolving shell tools Then enables native PowerShell only', () => {
    expect(isPiBashToolAvailable('win32', undefined)).toBe(false)
    expect(isPiPowerShellToolAvailable('win32')).toBe(true)
    expect(selectPiBuiltinShellTool('win32', undefined)).toBe('powershell')
  })

  test('Given Windows with Git Bash or WSL When resolving shell tools Then preserves Bash', () => {
    expect(selectPiBuiltinShellTool('win32', { shellKind: 'git-bash' })).toBe('bash')
    expect(selectPiBuiltinShellTool('win32', { shellKind: 'wsl' })).toBe('bash')
  })

  test('Given macOS or Linux When resolving PowerShell Then keeps the tool Windows-only', () => {
    expect(isPiPowerShellToolAvailable('darwin')).toBe(false)
    expect(isPiPowerShellToolAvailable('linux')).toBe(false)
    expect(selectPiBuiltinShellTool('darwin', undefined)).toBe('bash')
  })
})
