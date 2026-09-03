import * as React from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { CatalogCredentialIntegration } from './integration-catalog'

interface CredentialDialogProps {
  integration: CatalogCredentialIntegration | null
  onOpenChange: (open: boolean) => void
  onSave: (integration: CatalogCredentialIntegration, value: string) => Promise<void>
}

export function CredentialDialog({ integration, onOpenChange, onSave }: CredentialDialogProps): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (inputRef.current) inputRef.current.value = ''
    setSaving(false)
  }, [integration?.id])

  const handleSave = async (): Promise<void> => {
    const value = inputRef.current?.value ?? ''
    if (!integration || !value.trim() || saving) return
    setSaving(true)
    try {
      await onSave(integration, value)
      if (inputRef.current) inputRef.current.value = ''
      onOpenChange(false)
    } catch {
      // The parent reports a provider-specific error toast and keeps the dialog open.
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(integration)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] p-7" onOpenAutoFocus={(event) => event.preventDefault()}>
        {integration && (
          <>
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="text-xl font-semibold">{integration.name} 授权</DialogTitle>
              <DialogDescription className="text-[15px] leading-6">
                输入 {integration.name} 提供的 {integration.credential.label}，Proma 会加密保存在系统 Keychain 中，并为当前工作区建立连接。
              </DialogDescription>
            </DialogHeader>

            <div className="mt-7">
              <label htmlFor="catalog-credential" className="text-sm font-medium text-foreground">
                {integration.credential.label} <span className="text-destructive">*</span>
              </label>
              <Input
                id="catalog-credential"
                autoComplete="off"
                className="mt-2 h-12 text-sm"
                placeholder={integration.credential.placeholder}
                type="password"
                ref={inputRef}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSave()
                }}
              />
              <a
                href={integration.credential.acquisitionUrl}
                onClick={(event) => {
                  event.preventDefault()
                  void window.electronAPI.openExternal(integration.credential.acquisitionUrl)
                }}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
              >
                <span>{integration.credential.acquisitionLabel}</span>
                <ExternalLink size={12} />
              </a>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{integration.credential.helpText}</p>
            </div>

            <DialogFooter className="mt-7 gap-3 sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
              <Button onClick={() => { void handleSave() }} disabled={saving}>
                {saving && <Loader2 size={15} className="animate-spin" />}
                保存并连接
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
