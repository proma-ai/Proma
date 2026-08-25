export const MAX_BROWSER_SCRIPT_CHARS = 20_000
export const MAX_BROWSER_DOM_SELECTOR_CHARS = 1_000
export const MAX_BROWSER_DOM_TEXT_CHARS = 10_000
export const MAX_BROWSER_EXTRACT_CHARS = 50_000
export const MAX_BROWSER_SCROLL_DELTA = 50_000

export const BROWSER_DOM_ACTIONS = ['focus', 'fill', 'click', 'inspect'] as const
export type BrowserDomAction = typeof BROWSER_DOM_ACTIONS[number]
export type BrowserExtractFormat = 'text' | 'markdown'
export type BrowserScrollPosition = 'top' | 'bottom'

export interface BrowserDomActionInput {
  action: BrowserDomAction
  selector: string
  text?: string
}

export interface BrowserScrollInput {
  /** Omit to scroll the document. Selectors may traverse open shadow roots. */
  selector?: string
  deltaY?: number
  position?: BrowserScrollPosition
}

export interface BrowserExtractInput {
  /** Omit to extract document.body. Selectors may traverse open shadow roots. */
  selector?: string
  format: BrowserExtractFormat
  maxChars?: number
}

export interface BrowserSelectOptionInput {
  selector: string
  value?: string
  label?: string
  index?: number
}

function serializePayload(payload: unknown): string {
  return JSON.stringify(payload).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function assertSelector(selector: string | undefined, required = false): void {
  if (required && !selector?.trim()) throw new Error('CSS selector 不能为空。')
  if (selector && selector.length > MAX_BROWSER_DOM_SELECTOR_CHARS) throw new Error(`CSS selector 不能超过 ${MAX_BROWSER_DOM_SELECTOR_CHARS} 个字符。`)
}

function finderExpression(payload: unknown): string {
  return `
    const input = ${serializePayload(payload)};
    const findElement = (root, selector) => {
      const direct = root.querySelector(selector);
      if (direct) return direct;
      for (const host of root.querySelectorAll('*')) {
        if (!host.shadowRoot) continue;
        const nested = findElement(host.shadowRoot, selector);
        if (nested) return nested;
      }
      return null;
    };
  `
}

export function assertBrowserScript(script: string): void {
  if (!script.trim()) throw new Error('JavaScript 不能为空。')
  if (script.length > MAX_BROWSER_SCRIPT_CHARS) throw new Error(`JavaScript 不能超过 ${MAX_BROWSER_SCRIPT_CHARS} 个字符。`)
}

export function assertBrowserDomAction(input: BrowserDomActionInput): void {
  if (!BROWSER_DOM_ACTIONS.includes(input.action)) throw new Error('不支持的 DOM 操作。')
  assertSelector(input.selector, true)
  if (input.action === 'fill' && typeof input.text !== 'string') throw new Error('fill 操作需要 text。')
  if ((input.text?.length ?? 0) > MAX_BROWSER_DOM_TEXT_CHARS) throw new Error(`输入文本不能超过 ${MAX_BROWSER_DOM_TEXT_CHARS} 个字符。`)
}

export function assertBrowserScroll(input: BrowserScrollInput): void {
  assertSelector(input.selector)
  if (input.deltaY !== undefined && input.position !== undefined) throw new Error('滚动只能指定 deltaY 或 position 其中之一。')
  if (input.deltaY === undefined && input.position === undefined) throw new Error('滚动需要指定 deltaY 或 position。')
  if (input.deltaY !== undefined && (!Number.isFinite(input.deltaY) || Math.abs(input.deltaY) > MAX_BROWSER_SCROLL_DELTA)) {
    throw new Error(`deltaY 必须是绝对值不超过 ${MAX_BROWSER_SCROLL_DELTA} 的有限数字。`)
  }
  if (input.position !== undefined && input.position !== 'top' && input.position !== 'bottom') throw new Error('不支持的滚动位置。')
}

export function assertBrowserExtract(input: BrowserExtractInput): void {
  assertSelector(input.selector)
  if (input.format !== 'text' && input.format !== 'markdown') throw new Error('抽取格式必须是 text 或 markdown。')
  if (input.maxChars !== undefined && (!Number.isFinite(input.maxChars) || input.maxChars < 1 || input.maxChars > MAX_BROWSER_EXTRACT_CHARS)) {
    throw new Error(`maxChars 必须是 1 到 ${MAX_BROWSER_EXTRACT_CHARS} 的有限数字。`)
  }
}

export function assertBrowserSelectOption(input: BrowserSelectOptionInput): void {
  assertSelector(input.selector, true)
  const criteria = [input.value, input.label, input.index].filter((value) => value !== undefined)
  if (criteria.length !== 1) throw new Error('下拉选择必须且只能指定 value、label 或 index 其中之一。')
  if (input.index !== undefined && (!Number.isInteger(input.index) || input.index < 0)) throw new Error('index 必须是非负整数。')
}

/**
 * 在页面上下文内执行的固定 DOM 操作。参数经过 JSON 序列化，避免 selector/text 被解释成代码。
 * rich-text 编辑器常常没有稳定 AX 节点；这里同时派发 input/change，便于受控前端同步状态。
 */
export function buildBrowserDomActionExpression(input: BrowserDomActionInput): string {
  assertBrowserDomAction(input)
  return `(() => {${finderExpression(input)}
    const element = findElement(document, input.selector);
    if (!element) return { ok: false, error: '未找到匹配 selector 的元素。' };
    const root = element.getRootNode();
    const rect = element.getBoundingClientRect();
    const isPassword = element instanceof HTMLInputElement && element.type === 'password';
    const safeHref = (() => {
      if (!(element instanceof HTMLAnchorElement) || !element.href) return null;
      try { const url = new URL(element.href); return url.origin + url.pathname; } catch { return null; }
    })();
    const summary = () => {
      const rawValue = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.isContentEditable ? element.textContent || '' : '';
      const style = getComputedStyle(element);
      return {
        ok: true,
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        contentEditable: element.isContentEditable,
        focused: document.activeElement === element || (root instanceof ShadowRoot && root.activeElement === element),
        visible: !!(element.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none'),
        disabled: 'disabled' in element && !!element.disabled,
        checked: element instanceof HTMLInputElement ? element.checked : element.getAttribute('aria-checked'),
        selected: element.getAttribute('aria-selected'),
        valueLength: rawValue.length,
        valuePreview: isPassword ? null : rawValue.slice(0, 500),
        text: (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 2_000),
        attributes: {
          id: element.id || null,
          className: element.className && typeof element.className === 'string' ? element.className.slice(0, 500) : null,
          name: element.getAttribute('name'),
          type: element.getAttribute('type'),
          role: element.getAttribute('role'),
          ariaLabel: element.getAttribute('aria-label'),
          ariaExpanded: element.getAttribute('aria-expanded'),
          ariaSelected: element.getAttribute('aria-selected'),
          placeholder: element.getAttribute('placeholder'),
          href: safeHref,
        },
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        scroll: { top: Math.round(element.scrollTop), height: Math.round(element.scrollHeight), clientHeight: Math.round(element.clientHeight) },
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
    return summary();
  })()`
}

/** Fixed scroll implementation: it accepts data only and never evaluates agent-supplied JavaScript. */
export function buildBrowserScrollExpression(input: BrowserScrollInput): string {
  assertBrowserScroll(input)
  return `(() => {${finderExpression(input)}
    const element = input.selector ? findElement(document, input.selector) : (document.scrollingElement || document.documentElement);
    if (!element) return { ok: false, error: '未找到可滚动目标。' };
    if (typeof element.scrollTo !== 'function') return { ok: false, error: '目标不支持滚动。' };
    const read = () => ({ top: Math.round(element.scrollTop), height: Math.round(element.scrollHeight), clientHeight: Math.round(element.clientHeight) });
    const before = read();
    const top = input.position === 'top' ? 0 : input.position === 'bottom' ? Math.max(0, element.scrollHeight - element.clientHeight) : element.scrollTop + input.deltaY;
    element.scrollTo({ top, left: element.scrollLeft, behavior: 'auto' });
    const after = read();
    return { ok: true, selector: input.selector || null, before, after, moved: before.top !== after.top };
  })()`
}

/** Extract compact page content without exposing arbitrary page evaluation to the Agent. */
export function buildBrowserExtractExpression(input: BrowserExtractInput): string {
  assertBrowserExtract(input)
  return `(() => {${finderExpression(input)}
    const root = input.selector ? findElement(document, input.selector) : document.body;
    if (!root) return { ok: false, error: '未找到可抽取内容。' };
    const maxChars = Math.floor(input.maxChars || ${MAX_BROWSER_EXTRACT_CHARS});
    // Keep both page work and returned/intermediate strings bounded even when a single text node is huge.
    const workCharLimit = maxChars + 1_024;
    const maxNodes = 10_000;
    const maxDepth = 64;
    let remainingRawChars = workCharLimit;
    let remainingOutputChars = workCharLimit;
    let visitedNodes = 0;
    let stoppedEarly = false;
    const emit = (value) => {
      if (!value || remainingOutputChars <= 0) { if (value) stoppedEarly = true; return ''; }
      const bounded = value.slice(0, remainingOutputChars);
      if (bounded.length < value.length) stoppedEarly = true;
      remainingOutputChars -= bounded.length;
      return bounded;
    };
    const cleanText = (value) => {
      if (!value || remainingRawChars <= 0) { if (value) stoppedEarly = true; return ''; }
      const raw = String(value);
      const bounded = raw.slice(0, remainingRawChars);
      if (bounded.length < raw.length) stoppedEarly = true;
      remainingRawChars -= bounded.length;
      return emit(bounded.replace(/\\s+/g, ' ').trim());
    };
    // rendered is already capped by remainingOutputChars, so this final normalization cannot scan unbounded page content.
    const cleanRendered = (value) => String(value).replace(/\\s+/g, ' ').trim();
    const safeLink = (href) => { try { const url = new URL(String(href).slice(0, 2_048), location.href); return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin + url.pathname : ''; } catch { return ''; } };
    const markdown = (node, depth = 0) => {
      if (++visitedNodes > maxNodes || depth > maxDepth) { stoppedEarly = true; return ''; }
      if (node.nodeType === Node.TEXT_NODE) return cleanText(node.nodeValue || '');
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const element = node;
      const tag = element.tagName.toLowerCase();
      if (element.hidden || ['script', 'style', 'noscript', 'template', 'svg'].includes(tag) || element.getAttribute('aria-hidden') === 'true') return '';
      const parts = [];
      for (const child of element.childNodes) {
        if (visitedNodes >= maxNodes || remainingOutputChars <= 0) { stoppedEarly = true; break; }
        const childContent = markdown(child, depth + 1);
        if (childContent) {
          if (parts.length) parts.push(emit(' '));
          parts.push(childContent);
        }
      }
      const children = parts.length === 1 ? parts[0] : parts.join('');
      if (!children && tag !== 'img' && tag !== 'br') return '';
      if (/^h[1-6]$/.test(tag)) return emit('\\n\\n' + '#'.repeat(Number(tag[1])) + ' ') + children + emit('\\n\\n');
      if (tag === 'p' || tag === 'section' || tag === 'article' || tag === 'blockquote') return emit('\\n\\n') + children + emit('\\n\\n');
      if (tag === 'li') return emit('\\n- ') + children;
      if (tag === 'br') return emit('\\n');
      if (tag === 'pre') { const fence = String.fromCharCode(96).repeat(3); return emit('\\n\\n' + fence + '\\n') + children + emit('\\n' + fence + '\\n\\n'); }
      if (tag === 'code') { const tick = String.fromCharCode(96); return emit(tick) + children + emit(tick); }
      if (tag === 'a') { const href = safeLink(element.getAttribute('href') || ''); return href ? emit('[') + (children || emit(href)) + emit('](' + href + ')') : children; }
      if (tag === 'img') { const alt = cleanText(element.getAttribute('alt') || ''); return alt ? emit(' ![') + alt + emit(']') : ''; }
      return children;
    };
    const rendered = markdown(root);
    const content = input.format === 'text'
      ? cleanRendered(rendered)
      : rendered.replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
    return { ok: true, format: input.format, selector: input.selector || null, text: content.slice(0, maxChars), truncated: stoppedEarly || content.length > maxChars, totalChars: content.length, totalCharsIsLowerBound: stoppedEarly, visitedNodes };
  })()`
}

/** Select an option in a native <select>; custom comboboxes remain available through Observe/Click. */
export function buildBrowserSelectOptionExpression(input: BrowserSelectOptionInput): string {
  assertBrowserSelectOption(input)
  return `(() => {${finderExpression(input)}
    const element = findElement(document, input.selector);
    if (!element) return { ok: false, error: '未找到匹配 selector 的元素。' };
    if (!(element instanceof HTMLSelectElement)) return { ok: false, error: '目标不是原生 select 元素；自定义下拉菜单请使用 BrowserObserve 和 BrowserClick。' };
    const options = Array.from(element.options);
    const index = input.index !== undefined ? input.index : options.findIndex((option) => input.value !== undefined ? option.value === input.value : option.label === input.label || option.text === input.label);
    if (index < 0 || index >= options.length) return { ok: false, error: '未找到匹配的下拉选项。', optionCount: options.length };
    element.selectedIndex = index;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    const option = element.options[index];
    return { ok: true, index, value: option.value, label: option.label || option.text, optionCount: options.length };
  })()`
}
