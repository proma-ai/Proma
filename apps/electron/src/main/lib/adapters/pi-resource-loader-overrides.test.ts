import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'
import {
  createPromaManagedResourceLoaderOptions,
  createPromaProjectInstructionFilesOverride,
} from './pi-resource-loader-overrides'

describe('Proma-managed Pi resource loader policy', () => {
  test('Given a Proma-managed Pi session When creating loader options Then disables ambient local resources', () => {
    const options = createPromaManagedResourceLoaderOptions()

    expect(options.noContextFiles).toBe(true)
    expect(options.noExtensions).toBe(true)
    expect(options.noSkills).toBe(true)
  })

  test('Given locally discovered append instructions When applying the policy Then supplies an empty source that skips discovery', () => {
    const options = createPromaManagedResourceLoaderOptions()

    expect(options.appendSystemPrompt).toEqual([])
  })

  test('Given Pi local context, append prompt and extension files When loading Proma-managed mode Then ignores them but keeps explicit Proma resources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-managed-pi-'))
    const cwd = join(root, 'project')
    const agentDir = join(root, 'agent')
    const promaSkillsDir = join(root, 'proma-skills')
    mkdirSync(join(cwd, '.pi', 'extensions'), { recursive: true })
    mkdirSync(join(agentDir, 'extensions'), { recursive: true })
    mkdirSync(join(agentDir, 'skills', 'untrusted-skill'), { recursive: true })
    mkdirSync(join(promaSkillsDir, 'trusted-skill'), { recursive: true })
    writeFileSync(join(cwd, 'AGENTS.md'), 'untrusted project instruction')
    writeFileSync(join(cwd, '.pi', 'APPEND_SYSTEM.md'), 'untrusted appended prompt')
    writeFileSync(join(cwd, '.pi', 'extensions', 'untrusted.ts'), 'export default () => { throw new Error("must not load") }')
    writeFileSync(join(agentDir, 'AGENTS.md'), 'untrusted global instruction')
    writeFileSync(join(agentDir, 'APPEND_SYSTEM.md'), 'untrusted global append')
    writeFileSync(join(agentDir, 'extensions', 'untrusted.ts'), 'export default () => { throw new Error("must not load") }')
    writeFileSync(join(agentDir, 'skills', 'untrusted-skill', 'SKILL.md'), '---\nname: untrusted-skill\ndescription: must not load\n---\n')
    writeFileSync(join(promaSkillsDir, 'trusted-skill', 'SKILL.md'), '---\nname: trusted-skill\ndescription: must load\n---\n')

    try {
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager: SettingsManager.inMemory(),
        ...createPromaManagedResourceLoaderOptions(),
        agentsFilesOverride: createPromaProjectInstructionFilesOverride([
          { path: '/proma/project/AGENTS.md', content: 'Proma-validated project instruction' },
        ]),
        additionalSkillPaths: [promaSkillsDir],
        extensionFactories: [() => {}],
      })
      await loader.reload()

      expect(loader.getAgentsFiles().agentsFiles).toEqual([
        { path: '/proma/project/AGENTS.md', content: 'Proma-validated project instruction' },
      ])
      expect(loader.getAppendSystemPrompt()).toEqual([])
      expect(loader.getExtensions().errors).toEqual([])
      expect(loader.getExtensions().extensions).toHaveLength(1)
      expect(loader.getExtensions().extensions[0]?.path).toBe('<inline:1>')
      expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(['trusted-skill'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
