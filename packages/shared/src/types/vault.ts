export interface VaultConfig {
  rootPath: string
  displayName: string
  inboxPath: string
  allowAgentWrites: boolean
  configuredAt: number
}

/** Renderer-safe summary. The selected root path stays in the main process. */
export interface VaultSummary {
  displayName: string
  inboxPath: string
  allowAgentWrites: boolean
  configuredAt: number
}

export interface VaultCandidate {
  path: string
  displayName: string
  isObsidianVault: boolean
  isPromaManaged?: boolean
}

export interface VaultFileEntry {
  relativePath: string
  name: string
  size: number
  modifiedAt: number
}

/** A user-selected location in a Vault. Paths are always relative to its authorized root. */
export interface VaultFocus {
  kind: 'file' | 'folder'
  relativePath: string
  /** Monotonic per-renderer sequence; the main process ignores stale focus IPC. */
  sequence: number
}

/** Durable turn metadata used to render the post-response Obsidian context chip. */
export interface VaultFocusAttribution {
  displayName: string
  rootPath: string
  focus: VaultFocus
}

export interface VaultRenameInput {
  relativePath: string
  name: string
  expectedSha256?: string
}

export interface VaultDeleteInput {
  relativePath: string
  expectedSha256?: string
}

export interface VaultSavePastedImageInput {
  noteRelativePath: string
  mimeType: string
  base64: string
}

export interface VaultReadResult {
  relativePath: string
  content: string
  sha256: string
  modifiedAt: number
}

export interface VaultWriteInput {
  relativePath: string
  content: string
  expectedSha256?: string
  createOnly?: boolean
}

export type VaultWriteResult =
  | { ok: true; relativePath: string; sha256: string; modifiedAt: number }
  | { ok: false; reason: 'conflict'; currentSha256: string; currentModifiedAt: number }

export const VAULT_IPC_CHANNELS = {
  GET_CONFIG: 'vault:get-config',
  SELECT_DEFAULT: 'vault:select-default',
  LIST_CANDIDATES: 'vault:list-candidates',
  SELECT: 'vault:select',
  AUTHORIZE_CANDIDATE: 'vault:authorize-candidate',
  LIST_FILES: 'vault:list-files',
  READ_FILE: 'vault:read-file',
  RESOLVE_MEDIA: 'vault:resolve-media',
  SAVE_PASTED_IMAGE: 'vault:save-pasted-image',
  WRITE_FILE: 'vault:write-file',
  CREATE_UNTITLED_FILE: 'vault:create-untitled-file',
  CREATE_UNTITLED_FILE_IN_FOLDER: 'vault:create-untitled-file-in-folder',
  CREATE_FOLDER: 'vault:create-folder',
  RENAME_FILE: 'vault:rename-file',
  DELETE_FILE: 'vault:delete-file',
  SET_USER_CONTEXT: 'vault:set-user-context',
} as const
