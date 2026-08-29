import type * as React from 'react'
import { LiveMarkdownEditor } from '@/components/markdown/LiveMarkdownEditor'

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
  relativePath: string
}

/** Vault's file adapter around the reusable, domain-neutral Markdown editor. */
export function VaultLiveMarkdownEditor({ relativePath, ...props }: VaultLiveMarkdownEditorProps): React.ReactElement {
  return (
    <LiveMarkdownEditor
      {...props}
      resolveImageSrc={async (src) => (await window.electronAPI.resolveVaultMedia(relativePath, src))?.url ?? null}
      savePastedImage={async (file) => (await window.electronAPI.saveVaultPastedImage({
        noteRelativePath: relativePath,
        mimeType: file.type,
        base64: await fileToBase64(file),
      }))?.src ?? null}
    />
  )
}
