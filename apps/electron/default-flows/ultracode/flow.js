// Flow 元数据。内置 Flow 由 SDK Workflow 工具原生执行，
// 不在此注入 prompt 指令——真实进度来自 Workflow 工具产生的 task 事件。
export const meta = {
  name: '!ultracode',
  description: 'Dynamic workflow — 动态工作流编写和运行',
  group: 'proma',
  icon: 'Workflow',
  version: '1.1.0',
  type: 'builtin',
  argsHint: '任务描述',
}

export const trigger = '/ultracode'
