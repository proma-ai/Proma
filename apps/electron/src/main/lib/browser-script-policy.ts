export const MAX_BROWSER_SCRIPT_CHARS = 20_000
export const MAX_BROWSER_DOM_SELECTOR_CHARS = 1_000
export const MAX_BROWSER_DOM_TEXT_CHARS = 10_000

export const BROWSER_DOM_ACTIONS = ['focus', 'fill', 'click', 'inspect'] as const
export type BrowserDomAction = typeof BROWSER_DOM_ACTIONS[number]

export interface BrowserDomActionInput {
  action: BrowserDomAction
  selector: string
  text?: string
}

export function assertBrowserScript(script: string): void {
  if (!script.trim()) throw new Error('JavaScript 不能为空。')
  if (script.length > MAX_BROWSER_SCRIPT_CHARS) throw new Error(`JavaScript 不能超过 ${MAX_BROWSER_SCRIPT_CHARS} 个字符。`)
}

export function assertBrowserDomAction(input: BrowserDomActionInput): void {
  if (!BROWSER_DOM_ACTIONS.includes(input.action)) throw new Error('不支持的 DOM 操作。')
  if (!input.selector.trim()) throw new Error('CSS selector 不能为空。')
  if (input.selector.length > MAX_BROWSER_DOM_SELECTOR_CHARS) throw new Error(`CSS selector 不能超过 ${MAX_BROWSER_DOM_SELECTOR_CHARS} 个字符。`)
  if (input.action === 'fill' && typeof input.text !== 'string') throw new Error('fill 操作需要 text。')
  if ((input.text?.length ?? 0) > MAX_BROWSER_DOM_TEXT_CHARS) throw new Error(`输入文本不能超过 ${MAX_BROWSER_DOM_TEXT_CHARS} 个字符。`)
}

/**
 * 在页面上下文内执行的固定 DOM 操作。参数经过 JSON 序列化，避免 selector/text 被解释成代码。
 * rich-text 编辑器常常没有稳定 AX 节点；这里同时派发 input/change，便于受控前端同步状态。
 */
export function buildBrowserDomActionExpression(input: BrowserDomActionInput): string {
  assertBrowserDomAction(input)
  const payload = JSON.stringify(input).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `(() => {
    const input = ${payload};
    const findElement = (root) => {
      const direct = root.querySelector(input.selector);
      if (direct) return direct;
      for (const host of root.querySelectorAll('*')) {
        if (!host.shadowRoot) continue;
        const nested = findElement(host.shadowRoot);
        if (nested) return nested;
      }
      return null;
    };
    const element = findElement(document);
    if (!element) return { ok: false, error: '未找到匹配 selector 的元素。' };
    const summary = () => {
      const root = element.getRootNode();
      return {
        ok: true,
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        contentEditable: element.isContentEditable,
        focused: document.activeElement === element || (root instanceof ShadowRoot && root.activeElement === element),
      };
    };
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    if (input.action === 'inspect') return summary();
    if (input.action === 'focus') {
      element.focus({ preventScroll: true });
      return summary();
    }
    if (input.action === 'click') {
      element.click();
      return summary();
    }
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
      return { ok: false, error: '目标不是 input、textarea 或 contenteditable。' };
    }
    element.focus({ preventScroll: true });
    const text = input.text ?? '';
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, text); else element.value = text;
    } else {
      element.textContent = text;
    }
    try {
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { ...summary(), valueLength: text.length };
  })()`
}
