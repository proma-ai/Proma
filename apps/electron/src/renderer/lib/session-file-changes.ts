function normalizePath(path: string, caseInsensitive: boolean): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '')
  return caseInsensitive ? normalized.toLowerCase() : normalized
}

export function arePathsEqual(leftPath: string, rightPath: string, caseInsensitive = false): boolean {
  return normalizePath(leftPath, caseInsensitive) === normalizePath(rightPath, caseInsensitive)
}

export function isPathWithinRoot(rootPath: string, targetPath: string, caseInsensitive = false): boolean {
  const root = normalizePath(rootPath, caseInsensitive)
  const target = normalizePath(targetPath, caseInsensitive)
  return target === root || target.startsWith(`${root}/`)
}

export interface SessionWatcherOwnershipScope {
  sessionExists: boolean
  sessionPath?: string
  sessionAttachedDirectories: readonly string[]
  sessionAttachedFiles: readonly string[]
  workspaceAttachmentsComplete: boolean
  workspaceFilesPath?: string | null
  workspaceAttachedDirectories: readonly string[]
  workspaceAttachedFiles: readonly string[]
}

/** Returns watcher paths that can be attributed from the available session scope. */
export function getOwnedSessionWatcherPaths(
  changedPaths: readonly string[],
  scope: SessionWatcherOwnershipScope,
  caseInsensitive = false,
): string[] {
  if (!scope.sessionExists) return []

  const directoryRoots = [
    scope.sessionPath,
    ...scope.sessionAttachedDirectories,
  ]
  const attachedFiles = [...scope.sessionAttachedFiles]

  if (scope.workspaceAttachmentsComplete) {
    directoryRoots.push(
      scope.workspaceFilesPath ?? undefined,
      ...scope.workspaceAttachedDirectories,
    )
    attachedFiles.push(...scope.workspaceAttachedFiles)
  }

  return changedPaths.filter((changedPath) => (
    directoryRoots.some((rootPath) => (
      typeof rootPath === 'string'
      && rootPath.length > 0
      && isPathWithinRoot(rootPath, changedPath, caseInsensitive)
    ))
    || attachedFiles.some((filePath) => arePathsEqual(filePath, changedPath, caseInsensitive))
  ))
}

export type SessionFileChangeKind = "created" | "edited";

export interface SessionFileChange {
  path: string;
  kind: SessionFileChangeKind;
  runId: string;
  updatedAt: number;
}

export function getSessionFileChangeKind(
  toolName: string,
  existedBefore: boolean | undefined,
): SessionFileChangeKind {
  if (toolName === "Write" && existedBefore === false) return "created";
  return "edited";
}

export function upsertSessionFileChange(
  changes: readonly SessionFileChange[],
  next: SessionFileChange,
  caseInsensitive = false,
): SessionFileChange[] {
  const index = changes.findIndex((change) => arePathsEqual(change.path, next.path, caseInsensitive));
  if (index < 0) return [next, ...changes];

  const current = changes[index]!;
  const updated = {
    ...next,
    // A file created in this session should remain visibly new after later edits.
    kind: current.kind === "created" ? "created" : next.kind,
  };
  return changes.map((change, changeIndex) =>
    changeIndex === index ? updated : change,
  );
}

export function groupSessionFileChanges(
  changes: readonly SessionFileChange[],
  currentRunId: string | undefined,
): { current: SessionFileChange[]; earlier: SessionFileChange[] } {
  if (!currentRunId) return { current: [...changes], earlier: [] };
  return {
    current: changes.filter((change) => change.runId === currentRunId),
    earlier: changes.filter((change) => change.runId !== currentRunId),
  };
}
