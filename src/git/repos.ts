import fs from 'node:fs';
import path from 'node:path';
import { ToolError } from '../errors.js';
import { SKIPPED_DIRS } from '../sandbox.js';
import { git } from './run.js';

export interface Worktree {
  path: string;
  folder: string;
  branch: string | null;
  isMain: boolean;
}

export interface Remote {
  url: string;
  owner: string;
  repo: string;
}

export interface Project {
  name: string;
  worktrees: Worktree[];
  primary: Worktree;
  remote?: Remote;
}

const CACHE_MS = 30_000;

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function parseRemote(url: string): Remote | undefined {
  const match = url.trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!match || !match[1] || !match[2]) return undefined;
  return { url: url.trim(), owner: match[1], repo: match[2] };
}

function isInside(root: string, candidate: string): boolean {
  const win = process.platform === 'win32';
  const a = win ? root.toLowerCase() : root;
  const b = win ? candidate.toLowerCase() : candidate;
  return b === a || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
}

export class RepoIndex {
  private cache?: { at: number; projects: Project[] };

  constructor(
    private readonly root: string,
    private readonly depth: number,
  ) {}

  invalidate(): void {
    this.cache = undefined;
  }

  async projects(): Promise<Project[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.projects;
    const projects = await this.discover();
    this.cache = { at: Date.now(), projects };
    return projects;
  }

  async find(query: string): Promise<Project> {
    const all = await this.projects();
    const q = squash(query);
    if (!q) throw new ToolError('project name is empty.');
    const exact = all.filter((p) => squash(p.name) === q);
    if (exact.length === 1 && exact[0]) return exact[0];
    const partial = all.filter((p) => squash(p.name).includes(q));
    if (partial.length === 1 && partial[0]) return partial[0];
    if (partial.length > 1) {
      throw new ToolError(`"${query}" matches several projects: ${partial.map((p) => p.name).join(', ')}. Be more specific.`);
    }
    const names = all.map((p) => p.name).slice(0, 30).join(', ') || '(none found)';
    throw new ToolError(`No project matches "${query}". Known projects: ${names}`);
  }

  private findGitFolders(): string[] {
    const found: string[] = [];
    const scan = (dir: string, remaining: number): void => {
      if (fs.existsSync(path.join(dir, '.git'))) {
        found.push(dir);
        return;
      }
      if (remaining === 0) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        scan(path.join(dir, entry.name), remaining - 1);
      }
    };
    scan(this.root, this.depth);
    return found;
  }

  private async discover(): Promise<Project[]> {
    const folders = this.findGitFolders();
    const groups = new Map<string, string[]>();

    await Promise.all(
      folders.map(async (folder) => {
        try {
          const common = (await git(folder, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
          const list = groups.get(common) ?? [];
          list.push(folder);
          groups.set(common, list);
        } catch {
          /* not a usable repository, skip it */
        }
      }),
    );

    const projects: Project[] = [];
    for (const [commonDir, members] of groups) {
      members.sort();
      const probe = members[0] as string;
      const worktrees: Worktree[] = [];
      try {
        const out = await git(probe, ['worktree', 'list', '--porcelain']);
        let current: Partial<Worktree> | undefined;
        let index = 0;
        const flush = (): void => {
          if (current?.path && isInside(this.root, fs.realpathSync(current.path))) {
            worktrees.push({
              path: current.path,
              folder: path.basename(current.path),
              branch: current.branch ?? null,
              isMain: index === 0,
            });
          }
          if (current) index++;
          current = undefined;
        };
        for (const rawLine of out.split('\n')) {
          const lineText = rawLine.trim();
          if (lineText.startsWith('worktree ')) {
            flush();
            current = { path: path.normalize(lineText.slice('worktree '.length)) };
          } else if (lineText.startsWith('branch ') && current) {
            current.branch = lineText.slice('branch refs/heads/'.length);
          }
        }
        flush();
      } catch {
        /* fall back to the folder we found */
      }
      if (worktrees.length === 0) {
        worktrees.push({ path: probe, folder: path.basename(probe), branch: null, isMain: true });
      }

      const primary = worktrees.find((w) => w.isMain) ?? (worktrees[0] as Worktree);
      const name = path.basename(commonDir) === '.git' ? path.basename(path.dirname(commonDir)) : primary.folder;

      let remote: Remote | undefined;
      try {
        remote = parseRemote(await git(primary.path, ['remote', 'get-url', 'origin']));
      } catch {
        remote = undefined;
      }
      projects.push({ name, worktrees, primary, remote });
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Pick a worktree by folder name or branch; defaults to the main one. */
export function pickWorktree(project: Project, selector?: string): Worktree {
  if (!selector) return project.primary;
  const q = squash(selector);
  const hit =
    project.worktrees.find((w) => squash(w.folder) === q || squash(w.branch ?? '') === q) ??
    project.worktrees.find((w) => squash(w.folder).includes(q) || squash(w.branch ?? '').includes(q));
  if (!hit) {
    const options = project.worktrees.map((w) => `${w.folder} (${w.branch ?? 'detached'})`).join(', ');
    throw new ToolError(`No worktree matches "${selector}". Options: ${options}`);
  }
  return hit;
}
