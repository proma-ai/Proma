import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { VaultReadResult } from '@proma/shared'

/** A renderer can host several Agent sessions, each with independent Vault navigation. */
export function getVaultSessionScope(sessionId?: string): string {
  return sessionId ?? '__standalone_vault__'
}

export const selectedVaultFileAtomFamily = atomFamily((sessionScope: string) => atom<string | null>(null))
/** Transient navigation target for an Obsidian context chip; not Agent state. */
export const focusedVaultFolderAtomFamily = atomFamily((sessionScope: string) => atom<string | null>(null))
export const vaultReadResultAtomFamily = atomFamily((sessionScope: string) => atom<VaultReadResult | null>(null))
export const vaultRefreshTokenAtom = atom(0)
