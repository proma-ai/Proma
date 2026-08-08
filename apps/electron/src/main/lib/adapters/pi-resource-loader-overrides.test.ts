import { describe, expect, test } from 'bun:test'
import {
  combinePromaInstructionFiles,
  createPromaManagedResourceLoaderOptions,
  createPromaProjectInstructionFilesOverride,
} from './pi-resource-loader-overrides'

describe('Proma managed Pi resources', () => {
  test('Given Pi starts an Agent run When building resource options Then disables ambient project discovery', () => {
    expect(createPromaManagedResourceLoaderOptions()).toEqual({
      noContextFiles: true,
      noExtensions: true,
      noSkills: true,
      appendSystemPrompt: [],
    })
  })

  test('Given validated workspace and project instructions When composing the override Then preserves explicit precedence only', () => {
    const workspace = { path: '/workspace/AGENTS.md', content: 'workspace rules' }
    const project = { path: '/project/AGENTS.md', content: 'project rules' }
    const files = combinePromaInstructionFiles(workspace, [project])

    expect(files).toEqual([workspace, project])
    expect(createPromaProjectInstructionFilesOverride(files)()).toEqual({ agentsFiles: files })
  })
})
