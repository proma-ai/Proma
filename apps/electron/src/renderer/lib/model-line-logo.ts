import type { ProviderType } from '@proma/shared'

import DefaultLineLogo from '@/assets/models/line/default.png'
import ClaudeLineLogo from '@/assets/models/line/claude.png'
import OpenAILineLogo from '@/assets/models/line/openai.png'
import GPT4LineLogo from '@/assets/models/line/gpt_4.png'
import GPT35LineLogo from '@/assets/models/line/gpt_3.5.png'
import GPTo1LineLogo from '@/assets/models/line/gpt_o1.png'
import GPTImageLineLogo from '@/assets/models/line/gpt_image_1.png'
import GPT5LineLogo from '@/assets/models/line/gpt-5.png'
import GPT5ChatLineLogo from '@/assets/models/line/gpt-5-chat.png'
import GPT5MiniLineLogo from '@/assets/models/line/gpt-5-mini.png'
import GPT5NanoLineLogo from '@/assets/models/line/gpt-5-nano.png'
import GPT5CodexLineLogo from '@/assets/models/line/gpt-5-codex.png'
import GPT51LineLogo from '@/assets/models/line/gpt-5.1.png'
import GPT51ChatLineLogo from '@/assets/models/line/gpt-5.1-chat.png'
import GPT51CodexLineLogo from '@/assets/models/line/gpt-5.1-codex.png'
import GPT51CodexMiniLineLogo from '@/assets/models/line/gpt-5.1-codex-mini.png'
import DeepSeekLineLogo from '@/assets/models/line/deepseek.png'
import GeminiLineLogo from '@/assets/models/line/gemini.png'
import GemmaLineLogo from '@/assets/models/line/gemma.png'
import KimiGeminiLineLogo from '@/assets/models/line/kimigemini.png'
import QwenGeminiLineLogo from '@/assets/models/line/qwengemini.png'
import SeedGeminiLineLogo from '@/assets/models/line/seedgemini.png'
import QwenLineLogo from '@/assets/models/line/qwen.png'
import GrokLineLogo from '@/assets/models/line/grok.png'
import KimiLineLogo from '@/assets/models/line/moonshot.png'
import DoubaoLineLogo from '@/assets/models/line/doubao.png'
import ZhipuLineLogo from '@/assets/models/line/zhipu.png'
import ChatGLMLineLogo from '@/assets/models/line/chatglm.png'
import LlamaLineLogo from '@/assets/models/line/llama.png'
import MistralLineLogo from '@/assets/models/line/mixtral.png'
import CodestralLineLogo from '@/assets/models/line/codestral.png'
import YiLineLogo from '@/assets/models/line/yi.png'
import HunyuanLineLogo from '@/assets/models/line/hunyuan.png'
import WenxinLineLogo from '@/assets/models/line/wenxin.png'
import SparkDeskLineLogo from '@/assets/models/line/sparkdesk.png'
import StepLineLogo from '@/assets/models/line/step.png'
import MiniMaxLineLogo from '@/assets/models/line/minimax.png'
import XiaomiLineLogo from '@/assets/models/line/xiaomi.png'
import PromaLineLogo from '@/assets/models/line/proma.png'
import CohereLineLogo from '@/assets/models/line/cohere.png'
import EmbeddingLineLogo from '@/assets/models/line/embedding.png'

interface ChannelLineLogoInput {
  provider: ProviderType
  baseUrl: string
}

const MODEL_LINE_LOGO_MAP: Record<string, string> = {
  'gpt-image': GPTImageLineLogo,
  'gpt-3': GPT35LineLogo,
  'gpt-4': GPT4LineLogo,
  o1: GPTo1LineLogo,
  o3: GPTo1LineLogo,
  o4: GPTo1LineLogo,
  'gpt-5-mini': GPT5MiniLineLogo,
  'gpt-5-nano': GPT5NanoLineLogo,
  'gpt-5-chat': GPT5ChatLineLogo,
  'gpt-5-codex': GPT5CodexLineLogo,
  'gpt-5\\.1-codex-mini': GPT51CodexMiniLineLogo,
  'gpt-5\\.1-codex': GPT51CodexLineLogo,
  'gpt-5\\.1-chat': GPT51ChatLineLogo,
  'gpt-5\\.1': GPT51LineLogo,
  'gpt-5': GPT5LineLogo,
  gpts: GPT4LineLogo,
  '(claude|anthropic-)': ClaudeLineLogo,
  deepseek: DeepSeekLineLogo,
  kimigemini: KimiGeminiLineLogo,
  qwengemini: QwenGeminiLineLogo,
  seedgemini: SeedGeminiLineLogo,
  veo: GeminiLineLogo,
  gemma: GemmaLineLogo,
  gemini: GeminiLineLogo,
  '(qwen|qwq|qvq|wan-)': QwenLineLogo,
  grok: GrokLineLogo,
  kimi: KimiLineLogo,
  doubao: DoubaoLineLogo,
  'ep-202': DoubaoLineLogo,
  seed: DoubaoLineLogo,
  zhipu: ZhipuLineLogo,
  cogview: ZhipuLineLogo,
  glm: ChatGLMLineLogo,
  llama: LlamaLineLogo,
  codestral: CodestralLineLogo,
  mixtral: MistralLineLogo,
  mistral: MistralLineLogo,
  ministral: MistralLineLogo,
  magistral: MistralLineLogo,
  'yi-': YiLineLogo,
  'ernie-': WenxinLineLogo,
  'tao-': WenxinLineLogo,
  hunyuan: HunyuanLineLogo,
  sparkdesk: SparkDeskLineLogo,
  generalv: SparkDeskLineLogo,
  step: StepLineLogo,
  minimax: MiniMaxLineLogo,
  mimo: XiaomiLineLogo,
  proma: PromaLineLogo,
  cohere: CohereLineLogo,
  command: CohereLineLogo,
  'text-embedding': EmbeddingLineLogo,
  embedding: EmbeddingLineLogo,
}

const PROVIDER_LINE_LOGO_MAP: Record<ProviderType, string> = {
  anthropic: ClaudeLineLogo,
  'anthropic-compatible': DefaultLineLogo,
  openai: OpenAILineLogo,
  deepseek: DeepSeekLineLogo,
  google: GeminiLineLogo,
  'kimi-api': KimiLineLogo,
  'kimi-coding': KimiLineLogo,
  zhipu: ZhipuLineLogo,
  'zhipu-coding': ZhipuLineLogo,
  minimax: MiniMaxLineLogo,
  doubao: DoubaoLineLogo,
  qwen: QwenLineLogo,
  'qwen-anthropic': QwenLineLogo,
  xiaomi: XiaomiLineLogo,
  'xiaomi-token-plan': XiaomiLineLogo,
  custom: DefaultLineLogo,
}

const URL_LINE_LOGO_MAP: Array<[RegExp, string]> = [
  [/proma\.cool/i, PromaLineLogo],
  [/moonshot\.cn|kimi/i, KimiLineLogo],
  [/bigmodel\.cn|zhipuai/i, ZhipuLineLogo],
  [/minimax/i, MiniMaxLineLogo],
  [/xiaomimimo|mimo/i, XiaomiLineLogo],
  [/volces\.com|volcengine/i, DoubaoLineLogo],
  [/dashscope|aliyuncs/i, QwenLineLogo],
  [/deepseek/i, DeepSeekLineLogo],
  [/openai\.com/i, OpenAILineLogo],
  [/googleapis|generativelanguage/i, GeminiLineLogo],
  [/grok|x\.ai/i, GrokLineLogo],
  [/stepfun/i, StepLineLogo],
  [/cohere/i, CohereLineLogo],
  [/spark-api|xfyun/i, SparkDeskLineLogo],
  [/hunyuan/i, HunyuanLineLogo],
  [/ernie|baidu/i, WenxinLineLogo],
  [/yi\.com|lingyiwanwu/i, YiLineLogo],
]

const GENERIC_PROVIDERS: ReadonlySet<ProviderType> = new Set<ProviderType>([
  'anthropic',
  'anthropic-compatible',
  'custom',
])

export function getModelLineLogo(modelId: string, provider?: ProviderType): string {
  for (const key in MODEL_LINE_LOGO_MAP) {
    if (new RegExp(key, 'i').test(modelId)) {
      return MODEL_LINE_LOGO_MAP[key]!
    }
  }
  return provider ? PROVIDER_LINE_LOGO_MAP[provider] : DefaultLineLogo
}

export function getChannelLineLogo(channel: ChannelLineLogoInput, fallbackModelId?: string): string {
  if (GENERIC_PROVIDERS.has(channel.provider) && channel.baseUrl) {
    for (const [regex, logo] of URL_LINE_LOGO_MAP) {
      if (regex.test(channel.baseUrl)) {
        return logo
      }
    }
  }

  return fallbackModelId
    ? getModelLineLogo(fallbackModelId, channel.provider)
    : PROVIDER_LINE_LOGO_MAP[channel.provider]
}
