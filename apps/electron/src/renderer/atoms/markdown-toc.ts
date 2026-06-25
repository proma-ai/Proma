import { atom } from 'jotai'

/** Markdown 预览目录（TOC）侧栏是否展开：仅本次运行记忆，重启后默认展开 */
export const markdownTocOpenAtom = atom<boolean>(true)
