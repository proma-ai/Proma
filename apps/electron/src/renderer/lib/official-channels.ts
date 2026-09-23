/**
 * official-channels - Proma 官方渠道共享展示数据
 *
 * 模型配置页的「当前 Proma 官方 Agent 渠道」推荐区与购买额度页
 * 的「为什么选择 Proma 官方的 AI 渠道？」区块共用同一份清单与对比文案，
 * 避免两处各自维护导致不一致。
 */

import openaiModelLogo from '@/assets/models/official/openai.png'
import claudeModelLogo from '@/assets/models/official/claude.png'
import deepseekModelLogo from '@/assets/models/official/deepseek.png'
import moonshotModelLogo from '@/assets/models/official/moonshot.png'
import zhipuModelLogo from '@/assets/models/official/zhipu.png'

/** 官方推荐渠道清单：渠道摘要 + 具体模型（动态官方渠道同步前的兜底展示） */
export const OFFICIAL_MODEL_CHANNELS = [
  {
    provider: 'OpenAI',
    model: 'GPT-6 最新模型',
    logo: openaiModelLogo,
    models: ['GPT-6 Astra', 'GPT-6 Sol', 'GPT-6 Luna', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-5.5', 'GPT-5.4', 'GPT-5.4 Mini'],
  },
  {
    provider: 'Anthropic',
    model: 'Claude 最新模型',
    logo: claudeModelLogo,
    models: ['Claude Opus 4.8', 'Claude Opus 4.7', 'Claude Opus 4.6', 'Claude Sonnet 5', 'Claude Sonnet 4.6', 'Claude Fable 5'],
  },
  {
    provider: 'DeepSeek',
    model: 'DeepSeek V4',
    logo: deepseekModelLogo,
    models: ['DeepSeek V4 Pro', 'DeepSeek V4 Flash'],
  },
  {
    provider: 'Moonshot',
    model: 'Kimi K3',
    logo: moonshotModelLogo,
    models: ['Kimi K3', 'Kimi K2.6'],
  },
  {
    provider: '智谱',
    model: 'GLM-5.2',
    logo: zhipuModelLogo,
    models: ['GLM-5.2'],
  },
] as const

/** 官方 vs 非官方对比项（购买页与 onboarding 弹窗共用） */
export interface OfficialComparisonItem {
  label: string
  official: string
  alternative: string
  alternativePositive: boolean
}

export const OFFICIAL_COMPARISON: readonly OfficialComparisonItem[] = [
  {
    label: '透明计费',
    official: '按模型、Agent 与工具展示用量和扣费明细',
    alternative: '价格、扣费规则或明细难以核验',
    alternativePositive: false,
  },
  {
    label: '模型质量',
    official: '精选官方模型并持续验证实际模型能力与协议兼容性',
    alternative: '可能存在模型掺水或实际能力与宣传不符的问题',
    alternativePositive: false,
  },
  {
    label: '数据安全',
    official: '官方托管链路提供统一安全保障，减少第三方中转的不确定性',
    alternative: '数据流向与留存规则不透明，难以排除二次使用或倒卖风险',
    alternativePositive: false,
  },
  {
    label: '高峰稳定性',
    official: '持续监控模型健康状态并维护故障恢复能力',
    alternative: '高峰期可能降速，稳定性与故障恢复能力难以保障',
    alternativePositive: false,
  },
  {
    label: '价格优势',
    official: '以官方参考价为基础计算折扣，精选模型提供专属优惠',
    alternative: '可能具备更低价格，但价格来源和优惠依据不够透明',
    alternativePositive: true,
  },
]

/**
 * 根据模型 ID 判断所属官方推荐渠道；不匹配返回 null。
 * 官方渠道模型名由云端同步，可能包含折扣（如「GPT-5.6 Terra 2 折」）。
 */
export function matchOfficialProvider(modelId: string): string | null {
  const id = modelId.toLowerCase().replace(/^(?:openai|anthropic|deepseek|moonshot|zhipu)[/:.]/, '')
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) return 'OpenAI'
  if (id.startsWith('claude-')) return 'Anthropic'
  if (id.startsWith('deepseek-')) return 'DeepSeek'
  if (id.startsWith('k3') || id.startsWith('kimi-')) return 'Moonshot'
  if (id.startsWith('glm-')) return '智谱'
  return null
}

/** 官方模型列表旁统一展示的折扣口径，避免用户将「几折」误解为额度包或订阅折扣。 */
export const OFFICIAL_DISCOUNT_NOTE = '模型名后的「X 折」= 官方 API 公开价的 X 折；例如「2 折」就是官方价的 20%。'

/** 计费说明（购买页与 onboarding 弹窗共用，固定展示在所有内容最底部） */
export const BILLING_NOTES: readonly string[] = [
  OFFICIAL_DISCOUNT_NOTE,
  '未标注「X 折」的模型按商业版页面展示的当期规则计费；Proma Cloud 额度会按所选模型、输入输出长度及任务规模消耗。',
  '各额度包按所选档位独立计时，到期后未使用额度清零（团队采用单独计费层）。',
  '每次购买均为一次性支付，不会自动续费或自动扣款；赠送额度随对应额度包同时到期。',
  '支持少量多次购买叠加，各额度包独立计时，优先消耗先购买的额度（FIFO）。',
]
