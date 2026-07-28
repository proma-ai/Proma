import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const managerModulePath = join(import.meta.dir, 'planning-manager.ts')
const repoRoot = dirname(dirname(dirname(dirname(dirname(import.meta.dir)))))
const electronBinary = createRequire(import.meta.url)('electron') as string

/**
 * planning-manager 的数据库连接是模块级单例，而 node:sqlite 仅由 Electron 的 Node 22 提供。
 * 因此用 Bun 打包 TypeScript 验证脚本，再用独立 Electron Node 进程执行真实启动迁移，避免污染开发机的 planning.db。
 */
test('Given legacy and scoped groups When groups change Then Todo and calendar associations stay isolated', async () => {
  const home = mkdtempSync(join(tmpdir(), 'proma-planning-groups-'))
  const sourcePath = join(home, 'verify-planning-group-migration.ts')
  const outputPath = join(home, 'verify-planning-group-migration.mjs')
  const source = `
    import assert from 'node:assert/strict'
    import { mkdirSync } from 'node:fs'
    import { join } from 'node:path'
    import { DatabaseSync } from 'node:sqlite'
    import * as manager from ${JSON.stringify(managerModulePath)}

    const configDir = join(process.env.HOME, '.proma-dev')
    mkdirSync(configDir, { recursive: true })
    const db = new DatabaseSync(join(configDir, 'planning.db'))
    const now = Date.now()
    db.exec(\`
      PRAGMA foreign_keys = ON;
      CREATE TABLE planning_groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, color TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0, archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE todos (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, status TEXT NOT NULL, priority TEXT NOT NULL,
        due_at INTEGER, group_id TEXT REFERENCES planning_groups(id) ON DELETE SET NULL, workspace_id TEXT, scratch_excerpt TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
      );
      CREATE TABLE calendar_events (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, start_at INTEGER NOT NULL, end_at INTEGER,
        all_day INTEGER NOT NULL DEFAULT 0, group_id TEXT REFERENCES planning_groups(id) ON DELETE SET NULL,
        workspace_id TEXT, todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL, scratch_excerpt TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO planning_groups VALUES ('shared', '共享分组', '#2563eb', 0, NULL, \${now}, \${now});
      INSERT INTO planning_groups VALUES ('calendar-only', '仅旧日程分组', '#7c3aed', 1, NULL, \${now}, \${now});
      INSERT INTO todos VALUES ('todo-1', '旧 Todo', NULL, 'open', 'medium', NULL, 'shared', NULL, NULL, \${now}, \${now}, NULL);
      INSERT INTO calendar_events VALUES ('event-1', '旧日程', NULL, \${now}, NULL, 0, 'shared', NULL, NULL, NULL, \${now}, \${now});
      INSERT INTO calendar_events VALUES ('event-2', '旧日程专用', NULL, \${now}, NULL, 0, 'calendar-only', NULL, NULL, NULL, \${now}, \${now});
    \`)
    db.close()

    const todoGroups = manager.listPlanningGroups('todo')
    const calendarGroups = manager.listPlanningGroups('calendar')
    const todoGroup = todoGroups.find((group) => group.name === '共享分组')
    const calendarGroup = calendarGroups.find((group) => group.name === '共享分组')
    assert.ok(todoGroup)
    assert.ok(calendarGroup)
    assert.equal(todoGroup.scope, 'todo')
    assert.equal(calendarGroup.scope, 'calendar')
    assert.notEqual(todoGroup.id, calendarGroup.id)
    assert.equal(manager.getTodo('todo-1').group.id, todoGroup.id)
    assert.equal(manager.getCalendarEvent('event-1').group.id, calendarGroup.id)
    assert.equal(todoGroups.some((group) => group.name === '仅旧日程分组'), false)
    const calendarOnlyLegacyGroup = calendarGroups.find((group) => group.name === '仅旧日程分组')
    assert.ok(calendarOnlyLegacyGroup)
    assert.equal(manager.getCalendarEvent('event-2').group.id, calendarOnlyLegacyGroup.id)

    const todoOnly = manager.createPlanningGroup({ scope: 'todo', name: '仅 Todo' })
    const calendarOnly = manager.createPlanningGroup({ scope: 'calendar', name: '仅日程' })
    manager.createPlanningGroup({ scope: 'todo', name: '同名分组' })
    manager.createPlanningGroup({ scope: 'calendar', name: '同名分组' })
    assert.throws(() => manager.createCalendarEvent({ title: '错误日程', startAt: now, groupId: todoOnly.id }), /日程分组不存在/)
    assert.throws(() => manager.createTodo({ title: '错误 Todo', groupId: calendarOnly.id }), /Todo 分组不存在/)

    const renamedTodoGroup = manager.updatePlanningGroup({ id: todoOnly.id, scope: 'todo', name: '已重命名 Todo 分组' })
    assert.equal(renamedTodoGroup.name, '已重命名 Todo 分组')
    const todoUsingGroup = manager.createTodo({ title: '会解除分组的 Todo', groupId: todoOnly.id })
    assert.equal(manager.deletePlanningGroup('todo', todoOnly.id), true)
    assert.equal(manager.getTodo(todoUsingGroup.id).groupId, undefined)
    const eventUsingGroup = manager.createCalendarEvent({ title: '会解除分组的日程', startAt: now, groupId: calendarOnly.id })
    assert.equal(manager.deletePlanningGroup('calendar', calendarOnly.id), true)
    assert.equal(manager.getCalendarEvent(eventUsingGroup.id).groupId, undefined)

    assert.equal(manager.deletePlanningGroup('todo', todoGroup.id), true)
    assert.equal(manager.getCalendarEvent('event-1').group.id, calendarGroup.id)
    assert.deepEqual(new DatabaseSync(join(configDir, 'planning.db')).prepare('PRAGMA foreign_key_check').all(), [])
  `
  writeFileSync(sourcePath, source)

  try {
    const build = await Bun.build({
      entrypoints: [sourcePath],
      target: 'node',
      format: 'esm',
      external: ['electron', 'node:sqlite'],
    })
    expect(build.success, build.logs.map((log) => log.message).join('\n')).toBe(true)
    const compiledScript = build.outputs[0]
    if (!compiledScript) throw new Error('未生成日程分组迁移验证脚本')
    await Bun.write(outputPath, compiledScript)

    const result = spawnSync(electronBinary, [outputPath], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOME: home, PROMA_DEV: '1' },
      encoding: 'utf8',
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
