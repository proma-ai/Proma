/**
 * 语音输入文本规范化
 *
 * 只做确定性口语清洗，不调用二次模型。
 */

const LEADING_THINKING_PATTERNS: RegExp[] = [
  /^(?:让我想想啊?|我想一下|我想想|等一下|稍等一下)[，,。.\s]*/u,
  /^(?:我刚刚(?:记得|想起来)来着|刚刚想起来了?)[，,。.\s]*/u,
]

const CLAUSE_FILLER_PATTERN = /(^|[，。！？；、,.!?\s])(?:嗯+|呃+|额+|啊+|哎+|诶+|哦+|喔+|那个|这个|就是|然后)[，、,\s]*/gu
const CLAUSE_THINKING_PATTERN = /(^|[，。！？；、,.!?\s])(?:让我想想啊?|我想一下|我想想|等一下|稍等一下|我刚刚(?:记得|想起来)来着|刚刚想起来了?)[，,。.\s]*/gu
const DEMONSTRATIVE_FILLER_PATTERN = /(?:这个|那个)(?=(?:光标|功能|问题|位置|输入|内容|界面|窗口|按钮|文字|文本|地方|时候|模式|配置|逻辑|体验|过程|设置|边框))/gu

function collapseRepeatedPronouns(text: string): string {
  return text.replace(/(这个|那个|我|你|他|她|它|这|那)\1/gu, '$1')
}

function collapseAccidentalRepeats(text: string): string {
  return text
    .replace(/([我你他她它这那给还有是的了就不在要会能把被和跟再也都来去可])\1+/gu, '$1')
    .replace(/做做(?=[的了得过出成到])/gu, '做')
    .replace(/想{3,}/gu, '想想')
}

function normalizePunctuation(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。！？；、,.!?])\s*/g, '$1')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[。．.]{2,}/g, '。')
    .replace(/[！？!?]{2,}/g, (match) => match.includes('？') || match.includes('?') ? '？' : '！')
    .replace(/^[，。！？；、,.!?\s]+/u, '')
    .trim()
}

/** 清理常见口语停顿词和犹豫表达，保留原始语义。 */
export function normalizeVoiceDictationText(text: string): string {
  let normalized = text.trim()
  if (!normalized) return ''

  let changed = true
  while (changed) {
    changed = false
    for (const pattern of LEADING_THINKING_PATTERNS) {
      const next = normalized.replace(pattern, '')
      if (next !== normalized) {
        normalized = next
        changed = true
      }
    }
  }

  normalized = normalized.replace(CLAUSE_FILLER_PATTERN, '$1')
  normalized = normalized.replace(CLAUSE_THINKING_PATTERN, '$1')
  normalized = collapseRepeatedPronouns(normalized)
  normalized = collapseAccidentalRepeats(normalized)
  normalized = normalized.replace(DEMONSTRATIVE_FILLER_PATTERN, '')
  return normalizePunctuation(normalized)
}
