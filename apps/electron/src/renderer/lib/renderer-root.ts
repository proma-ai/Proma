import type { Root } from 'react-dom/client'

/**
 * 在同一个 renderer document 内保留唯一 React root。
 *
 * Vite Fast Refresh 会重新执行入口模块；将 root 挂在实际容器上可跨模块实例复用，
 * 避免新的入口再次对同一个 #root 调用 createRoot。
 */
const RENDERER_ROOT_KEY = Symbol.for('proma.renderer.react-root')

type CreateRoot = (container: HTMLElement) => Root

export function getOrCreateRendererRoot(container: HTMLElement, createRoot: CreateRoot): Root {
  const existingRoot = Reflect.get(container, RENDERER_ROOT_KEY) as Root | undefined
  if (existingRoot) return existingRoot

  const root = createRoot(container)
  Reflect.set(container, RENDERER_ROOT_KEY, root)
  return root
}
