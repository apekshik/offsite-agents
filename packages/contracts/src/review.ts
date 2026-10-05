import { z } from "zod";

// What the captain sees of the crew's work: a task's changes, or a whole thread's in one repo. The runner computes
// them from git on the machine that holds the repo (packages/git review.ts) and writes them to the ship; the app reads
// them (apps/web/src/review). Stats are also kept on each task when it lands.

/** "+38 −2 · 2 files": a task's or a thread's size. */
export const ChangeStats = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
});
export type ChangeStats = z.infer<typeof ChangeStats>;

export const FileStatus = z.enum(["added", "deleted", "modified", "renamed", "copied", "typechange"]);
export type FileStatus = z.infer<typeof FileStatus>;

/** One changed file. `oldPath` is set for renames and copies. */
export const ChangedFile = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: FileStatus,
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  binary: z.boolean(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

export const DIFF_LIMITS = {
  /** The unified diff is cut here (about 300 KB) and marked truncated: a Convex document stays well under 1 MB. */
  patchChars: 300_000,
  /** Files listed; the rest are counted in the stats only. */
  files: 1000,
} as const;

/** A computed diff, as the runner writes it back. `sha` is what it was computed at (the branch's tip, or the task's last landed commit). */
export const DiffResult = z.object({
  sha: z.string(),
  base: z.string().nullable(),
  stats: ChangeStats,
  files: z.array(ChangedFile).max(DIFF_LIMITS.files),
  patch: z.string().max(DIFF_LIMITS.patchChars + 200),
  truncated: z.boolean(),
});
export type DiffResult = z.infer<typeof DiffResult>;

/** "+38 −2 · 2 files". */
export function statsLine(s: ChangeStats): string {
  return `+${s.added} −${s.removed} · ${s.files} file${s.files === 1 ? "" : "s"}`;
}

/** Cut a patch at the limit on a line boundary. */
export function capPatch(patch: string, max: number = DIFF_LIMITS.patchChars): { patch: string; truncated: boolean } {
  if (patch.length <= max) return { patch, truncated: false };
  const cut = patch.lastIndexOf("\n", max);
  return { patch: patch.slice(0, cut > 0 ? cut : max), truncated: true };
}
