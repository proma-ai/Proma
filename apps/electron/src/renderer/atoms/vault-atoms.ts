import { atom } from 'jotai'
import type { VaultReadResult } from '@proma/shared'

export const selectedVaultFileAtom = atom<string | null>(null)
/** Transient navigation target for an Obsidian context chip; not Agent state. */
export const focusedVaultFolderAtom = atom<string | null>(null)
export const vaultReadResultAtom = atom<VaultReadResult | null>(null)
export const vaultRefreshTokenAtom = atom(0)
