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
): SessionFileChange[] {
  const index = changes.findIndex((change) => change.path === next.path);
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
