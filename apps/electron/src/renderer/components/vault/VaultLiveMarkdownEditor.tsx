import type * as React from 'react'
import { LiveMarkdownEditor } from '@/components/markdown/LiveMarkdownEditor'

interface VaultLiveMarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave: () => void
}

/** Vault's file adapter around the reusable, domain-neutral Markdown editor. */
export function VaultLiveMarkdownEditor(props: VaultLiveMarkdownEditorProps): React.ReactElement {
  return <LiveMarkdownEditor {...props} />
}
