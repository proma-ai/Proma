import { atomWithStorage } from 'jotai/utils'

/** Markdown 预览目录（TOC）侧栏是否展开，持久化到 localStorage */
export const markdownTocOpenAtom = atomWithStorage<boolean>('proma-markdown-toc-open', true)
