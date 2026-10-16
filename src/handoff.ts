import fs from 'node:fs';
import path from 'node:path';

export type LogKind = 'plan' | 'decision' | 'checkpoint';

export const KIND_FOLDER: Record<LogKind, string> = {
  plan: 'PLAN_LOG',
  decision: 'DECISIONS',
  checkpoint: 'CHECKPOINTS',
};

export function handoffDir(root: string, projectSlug: string): string {
  return path.join(root, '.handoff', projectSlug);
}

export function stateTemplate(name: string): string {
  return [
    `# Project state: ${name}`,
    '',
    `Last updated: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## Goal',
    '',
    '## Current status',
    '',
    '## Next steps',
    '',
    '## Open questions',
    '',
  ].join('\n');
}

/** Entries of PLAN_LOG / DECISIONS / CHECKPOINTS, newest (highest number) first. */
export function listEntries(dir: string, kind: LogKind): string[] {
  const folder = path.join(dir, KIND_FOLDER[kind]);
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort()
    .reverse();
}

export function nextNumber(dir: string, kind: LogKind): number {
  const newest = listEntries(dir, kind)[0];
  return newest ? Number(newest.slice(0, 4)) + 1 : 1;
}

export function firstLine(file: string): string {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const heading = text.split('\n').find((l) => l.trim() !== '') ?? '';
    return heading.replace(/^#+\s*/, '').trim();
  } catch {
    return '';
  }
}
