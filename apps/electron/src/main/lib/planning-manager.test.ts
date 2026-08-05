import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const managerModulePath = join(import.meta.dir, 'planning-manager.ts')
const repoRoot = dirname(dirname(dirname(dirname(dirname(import.meta.dir)))))
const electronBinary = createRequire(import.meta.url)('electron') as string

/**
 * planning-manager 的数据库连接是模块级单例，而 node:sqlite 仅由 Electron 的 Node 22 提供。
 * 因此用 Bun 打包 TypeScript 验证脚本，再用独立 Electron Node 进程执行真实 SQLite 回归。
 */
test('Given a fresh planning database When planning data changes Then isolation, transactions, reminders and optimistic versions stay correct', async () => {
  const home = mkdtempSync(join(tmpdir(), 'proma-planning-'))
  const sourcePath = join(home, 'verify-planning-manager.ts')
  const outputPath = join(home, 'verify-planning-manager.mjs')
  const source = `
    import assert from 'node:assert/strict'
    import { mkdirSync } from 'node:fs'
    import { join } from 'node:path'
    import { DatabaseSync } from 'node:sqlite'
    import * as manager from ${JSON.stringify(managerModulePath)}

    const configDir = join(process.env.HOME, '.proma-dev')
    mkdirSync(configDir, { recursive: true })
    const now = Date.now()

    // Given a fresh database, groups remain independent even when names match.
    const todoGroup = manager.createPlanningGroup({ scope: 'todo', name: '工作' })
    const calendarGroup = manager.createPlanningGroup({ scope: 'calendar', name: '工作' })
    assert.notEqual(todoGroup.id, calendarGroup.id)
    assert.equal(manager.listPlanningGroups('todo').length, 1)
    assert.equal(manager.listPlanningGroups('calendar').length, 1)
    assert.throws(() => manager.createTodo({ title: '错误 Todo', groupId: calendarGroup.id }), /Todo 分组不存在/)
    assert.throws(() => manager.createCalendarEvent({ title: '错误日程', startAt: now, groupId: todoGroup.id }), /日程分组不存在/)

    const tagged = manager.createPlanningTag({ name: '重要' })
    assert.throws(() => manager.createTodo({ title: '不应部分创建', tagIds: [tagged.id, 'missing-tag'] }), /标签不存在/)
    assert.equal(manager.listTodos().some((todo) => todo.title === '不应部分创建'), false)
    assert.throws(() => manager.createCalendarEvent({ title: '不应部分创建的日程', startAt: now, reminders: [{ triggerAt: Number.NaN }] }), /triggerAt/)
    assert.equal(manager.listCalendarEvents().some((event) => event.title === '不应部分创建的日程'), false)

    // Given a persisted Todo, an invalid tag update leaves every prior field intact.
    const todo = manager.createTodo({ title: '稳定 Todo', groupId: todoGroup.id, tagIds: [tagged.id] })
    assert.throws(() => manager.updateTodo({ id: todo.id, title: '不应写入', tagIds: ['missing-tag'], expectedUpdatedAt: todo.updatedAt }), /标签不存在/)
    const unchangedTodo = manager.getTodo(todo.id)
    assert.equal(unchangedTodo.title, '稳定 Todo')
    assert.deepEqual(unchangedTodo.tags.map((tag) => tag.id), [tagged.id])

    // Snoozing or manually moving a default reminder makes it user-owned.
    const dueAt = now + 2 * 60 * 60 * 1000
    const snoozedTodo = manager.createTodo({ title: '推迟提醒', dueAt })
    const defaultReminder = manager.getTodo(snoozedTodo.id).reminders.find((item) => item.origin === 'todo_due_at')
    assert.ok(defaultReminder)
    const snoozed = manager.snoozePlanningReminder(defaultReminder.id, 10)
    assert.equal(snoozed.origin, 'manual')
    manager.updateTodo({ id: snoozedTodo.id, dueAt: null, expectedUpdatedAt: snoozedTodo.updatedAt })
    assert.ok(manager.getTodo(snoozedTodo.id).reminders.some((item) => item.id === defaultReminder.id))

    const movedTodo = manager.createTodo({ title: '手动改期提醒', dueAt: dueAt + 60_000 })
    const movedDefault = manager.getTodo(movedTodo.id).reminders.find((item) => item.origin === 'todo_due_at')
    assert.ok(movedDefault)
    const manuallyMoved = manager.updatePlanningReminder(movedDefault.id, dueAt + 90 * 60_000)
    assert.equal(manuallyMoved.origin, 'manual')
    manager.updateTodo({ id: movedTodo.id, dueAt: dueAt + 3 * 60 * 60 * 1000, expectedUpdatedAt: movedTodo.updatedAt })
    assert.equal(manager.getTodo(movedTodo.id).reminders.find((item) => item.id === movedDefault.id).triggerAt, dueAt + 90 * 60_000)

    // An older window cannot overwrite a newer Todo or calendar event snapshot.
    const firstTodoUpdate = manager.updateTodo({ id: todo.id, title: 'Todo 新版本', expectedUpdatedAt: todo.updatedAt })
    assert.equal(firstTodoUpdate.title, 'Todo 新版本')
    assert.throws(() => manager.updateTodo({ id: todo.id, title: 'Todo 旧版本', expectedUpdatedAt: todo.updatedAt }), /其他窗口修改/)

    const calendarEvent = manager.createCalendarEvent({ title: '稳定日程', startAt: now, groupId: calendarGroup.id, tagIds: [tagged.id] })
    const firstEventUpdate = manager.updateCalendarEvent({ id: calendarEvent.id, title: '日程新版本', expectedUpdatedAt: calendarEvent.updatedAt })
    assert.equal(firstEventUpdate.title, '日程新版本')
    assert.throws(() => manager.updateCalendarEvent({ id: calendarEvent.id, title: '日程旧版本', expectedUpdatedAt: calendarEvent.updatedAt }), /其他窗口修改/)

    // Group deletes only detach their own scope and keep foreign keys consistent.
    assert.equal(manager.deletePlanningGroup('todo', todoGroup.id), true)
    assert.equal(manager.getTodo(todo.id).groupId, undefined)
    assert.equal(manager.getCalendarEvent(calendarEvent.id).groupId, calendarGroup.id)
    assert.equal(manager.deletePlanningGroup('calendar', calendarGroup.id), true)
    assert.equal(manager.getCalendarEvent(calendarEvent.id).groupId, undefined)

    // Deleting a Todo detaches linked events through the foreign key cascade.
    const linkedEvent = manager.createCalendarEvent({ title: '关联 Todo 的日程', startAt: now, todoId: todo.id })
    assert.equal(manager.deleteTodo(todo.id), true)
    assert.equal(manager.getCalendarEvent(linkedEvent.id).todoId, undefined)

    const db = new DatabaseSync(join(configDir, 'planning.db'))
    const eventColumns = db.prepare('PRAGMA table_info(calendar_events)').all().map((column) => column.name)
    assert.ok(eventColumns.includes('calendar_group_id'))
    assert.equal(eventColumns.includes('group_id'), false)
    assert.equal(eventColumns.includes('scratch_excerpt'), false)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
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
    if (!compiledScript) throw new Error('未生成 planning manager 验证脚本')
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
