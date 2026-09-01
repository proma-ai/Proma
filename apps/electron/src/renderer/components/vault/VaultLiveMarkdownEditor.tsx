import * as React from 'react'
import { LiveMarkdownEditor, type LiveMarkdownEditorHandle, type LiveMarkdownTextSelection, type LiveMarkdownPropertyEntry } from '@/components/markdown/LiveMarkdownEditor'
import { serializeFlatLeadingFrontmatter } from '@/components/markdown/live-markdown-frontmatter'

const MAX_PASTED_IMAGE_BYTES = 10 * 1024 * 1024

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

interface VaultLiveMarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  /** 选区变化由 Vault 外层处理为引用/右侧问答浮窗。 */
  onTextSelectionChange?: (selection: LiveMarkdownTextSelection | null) => void
  /** CodeMirror 异步挂载完成后通知外层，用于恢复阅读位置。 */
  onReady?: () => void
  relativePath: string
}

/** Vault's file adapter around the reusable, domain-neutral Markdown editor. */
export const VaultLiveMarkdownEditor = React.forwardRef<LiveMarkdownEditorHandle, VaultLiveMarkdownEditorProps>(
  function VaultLiveMarkdownEditor({ relativePath, ...props }, ref): React.ReactElement {
    const valueRef = React.useRef(props.value)
    const onChangeRef = React.useRef(props.onChange)
    valueRef.current = props.value
    onChangeRef.current = props.onChange
    const mediaRequestsRef = React.useRef(new Map<string, Promise<string | null>>())
    const resolveImageSrc = React.useCallback((src: string): Promise<string | null> => {
      const cached = mediaRequestsRef.current.get(src)
      if (cached) return cached
      const request = window.electronAPI.resolveVaultMedia(relativePath, src).then((result) => result?.url ?? null)
      mediaRequestsRef.current.set(src, request)
      return request
    }, [relativePath])

    const savePastedImage = React.useCallback(async (file: File): Promise<string | null> => {
      // Reject before allocating raw bytes, a binary string, Base64, and IPC copies.
      if (file.size <= 0 || file.size > MAX_PASTED_IMAGE_BYTES) return null
      return (await window.electronAPI.saveVaultPastedImage({
        noteRelativePath: relativePath,
        mimeType: file.type,
        base64: await fileToBase64(file),
      }))?.src ?? null
    }, [relativePath])

    const handlePropertiesChange = React.useCallback((entries: LiveMarkdownPropertyEntry[], documentValue?: string): void => {
      // This callback is retained by the one-time CodeMirror extension. Prefer
      // its live document snapshot, then the latest controlled value, so a
      // property change cannot reintroduce body text from a previous render.
      const nextValue = serializeFlatLeadingFrontmatter(documentValue ?? valueRef.current, entries)
      onChangeRef.current(nextValue)
    }, [])

    return <LiveMarkdownEditor ref={ref} {...props} enableProperties onChangeProperties={handlePropertiesChange} resolveImageSrc={resolveImageSrc} savePastedImage={savePastedImage} />
  },
)
