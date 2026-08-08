import { describe, expect, test } from 'bun:test'
import {
  createPromaManagedResourceLoaderOptions,
  createPromaProjectInstructionFilesOverride,
  combinePromaInstructionFiles,
} from './pi-resource-loader-overrides'

describe('Proma 管理的 Pi 指令注入', () => {
  test('Given 受管工作区与已验证项目规则 When 生成 override Then 仅注入显式提供的文件', () => {
    const override = createPromaProjectInstructionFilesOverride([
      { path: '/proma/workspace/AGENTS.md', content: '# Proma rules' },
      { path: '/project/AGENTS.md', content: '# Project rules' },
    ])

    expect(override()).toEqual({
      agentsFiles: [
        { path: '/proma/workspace/AGENTS.md', content: '# Proma rules' },
        { path: '/project/AGENTS.md', content: '# Project rules' },
      ],
    })
  })

  test('Given managed runtime When 创建 ResourceLoader 选项 Then 禁止环境式规则与扩展发现', () => {
    expect(createPromaManagedResourceLoaderOptions()).toMatchObject({
      noContextFiles: true,
      noExtensions: true,
      noSkills: true,
      appendSystemPrompt: [],
    })
  })
})


test('Given workspace 与项目指令 When 合并 Then 工作区规则排在已授权项目规则之前', () => {
  expect(combinePromaInstructionFiles(
    { path: '/proma/workspace/AGENTS.md', content: '# Proma rules' },
    [{ path: '/project/AGENTS.md', content: '# Project rules' }],
  )).toEqual([
    { path: '/proma/workspace/AGENTS.md', content: '# Proma rules' },
    { path: '/project/AGENTS.md', content: '# Project rules' },
  ])
})
