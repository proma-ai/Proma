// Flow 元数据。内置 Flow 由 SDK Skill/Workflow 工具原生执行，
// 不在此注入 prompt 指令——真实进度来自工具调用产生的 task 事件。
export const meta = {
  name: '!deep-research',
  description: 'Deep research harness — 扇出搜索、交叉验证、引用报告',
  group: 'proma',
  icon: 'Search',
  version: '1.1.0',
  type: 'builtin',
  argsHint: '研究主题',
}

export const trigger = '/deep-research'
