import { atom } from 'jotai'

export const migrationImportDialogOpenAtom = atom(false)

export const migrationImportInitialFilePathAtom = atom<string | null>(null)
