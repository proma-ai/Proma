import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'

mock.module('electron', () => ({
  app: { isPackaged: true, getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] },
}))
mock.module('./cloud-auth-service', () => ({
  getApiClient: () => ({ get: async () => ({ data: {} }), post: async () => ({ data: {} }) }),
  getAuthToken: () => null,
  getCloudSessionRevision: () => 0,
  tryRefreshAuthToken: async () => null,
}))

type EnterpriseSkills = typeof import('./enterprise-skills-service')
let service: EnterpriseSkills
let root: string

beforeAll(async () => { service = await import('./enterprise-skills-service') })
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })

function setupSkill(): string {
  root = mkdtempSync(join(tmpdir(), 'proma-enterprise-skill-'))
  const skill = join(root, 'example')
  mkdirSync(join(skill, 'references'), { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: Example\n---\nHello\n')
  writeFileSync(join(skill, 'references', 'guide.md'), 'guide\n')
  writeFileSync(join(skill, '.source.json'), '{"local":true}')
  return skill
}

describe('企业 Skills 制品安全处理', () => {
  test('打包忽略本地来源元数据，并可安全解压且清单一致', () => {
    const source = setupSkill()
    const artifact = service.createEnterpriseSkillArtifact(source)
    const destination = join(root, 'extracted')
    const result = service.extractEnterpriseSkillArtifact(artifact, destination)

    expect(readFileSync(join(destination, 'SKILL.md'), 'utf8')).toContain('Example')
    expect(() => readFileSync(join(destination, '.source.json'))).toThrow()
    expect(result.fileCount).toBe(2)
    expect(result.manifestSha256).toBe(service.calculateSkillManifest(destination))
  })

  test('拒绝缺少 SKILL.md 的下载制品', () => {
    root = mkdtempSync(join(tmpdir(), 'proma-enterprise-skill-'))
    const zip = new AdmZip()
    zip.addFile('README.md', Buffer.from('not a skill'))
    expect(() => service.extractEnterpriseSkillArtifact(zip.toBuffer(), join(root, 'out'))).toThrow('缺少 SKILL.md')
  })

  test('拒绝包含敏感文件的下载制品', () => {
    root = mkdtempSync(join(tmpdir(), 'proma-enterprise-skill-'))
    const zip = new AdmZip()
    zip.addFile('SKILL.md', Buffer.from('---\nname: Example\n---'))
    zip.addFile('.env', Buffer.from('TOKEN=secret'))
    expect(() => service.extractEnterpriseSkillArtifact(zip.toBuffer(), join(root, 'out'))).toThrow('敏感文件')
  })
})
