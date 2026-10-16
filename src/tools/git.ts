import { z } from 'zod';
import { ToolError } from '../errors.js';
import { git } from '../git/run.js';
import { pickWorktree, type Worktree } from '../git/repos.js';
import { clip, defineTool } from '../tool.js';

const SEP = '\x1f';

export interface CommitLine {
  hash: string;
  date: string;
  author: string;
  subject: string;
  refs: string;
}

export async function recentCommits(
  wt: Worktree,
  scope: 'current' | 'all' | 'remote',
  limit: number,
  since?: string,
): Promise<CommitLine[]> {
  const args = ['log', '-n', String(limit), '--date=short', `--pretty=format:%h${SEP}%ad${SEP}%an${SEP}%s${SEP}%D`];
  if (since) args.push(`--since=${since}`);
  if (scope === 'all') args.push('--all');
  if (scope === 'remote') args.push('--remotes');
  let out: string;
  try {
    out = await git(wt.path, args);
  } catch (err) {
    // A repository with no commits yet has no log.
    if (err instanceof ToolError && /does not have any commits|unknown revision/i.test(err.message)) return [];
    throw err;
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [hash = '', date = '', author = '', subject = '', refs = ''] = row.split(SEP);
      return { hash, date, author, subject, refs };
    });
}

export function formatCommit(c: CommitLine): string {
  return `${c.hash} ${c.date} ${c.author}: ${c.subject}${c.refs ? `  [${c.refs}]` : ''}`;
}

export interface WorktreeStatus {
  folder: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changed: number;
  untracked: number;
  conflicts: number;
  lastCommit: string;
}

export async function worktreeStatus(wt: Worktree): Promise<WorktreeStatus> {
  const out = await git(wt.path, ['status', '--porcelain=v2', '--branch']);
  const s: WorktreeStatus = {
    folder: wt.folder,
    branch: wt.branch ?? 'detached',
    ahead: 0,
    behind: 0,
    changed: 0,
    untracked: 0,
    conflicts: 0,
    lastCommit: '(no commits yet)',
  };
  for (const row of out.split('\n')) {
    if (row.startsWith('# branch.head ')) s.branch = row.slice('# branch.head '.length);
    else if (row.startsWith('# branch.upstream ')) s.upstream = row.slice('# branch.upstream '.length);
    else if (row.startsWith('# branch.ab ')) {
      const m = row.match(/\+(\d+) -(\d+)/);
      if (m) {
        s.ahead = Number(m[1]);
        s.behind = Number(m[2]);
      }
    } else if (row.startsWith('1 ') || row.startsWith('2 ')) s.changed++;
    else if (row.startsWith('u ')) s.conflicts++;
    else if (row.startsWith('? ')) s.untracked++;
  }
  try {
    s.lastCommit = (await git(wt.path, ['log', '-1', '--pretty=format:%h %s (%cr)'])).trim() || s.lastCommit;
  } catch {
    /* keep placeholder */
  }
  return s;
}

export function formatStatus(s: WorktreeStatus): string {
  const sync = s.upstream
    ? `${s.ahead} unpushed, ${s.behind} to pull (vs ${s.upstream})`
    : 'no upstream branch (never pushed)';
  const dirty =
    s.changed + s.untracked + s.conflicts === 0
      ? 'clean'
      : `${s.changed} changed, ${s.untracked} untracked${s.conflicts ? `, ${s.conflicts} conflicted` : ''}`;
  return `${s.folder} [${s.branch}] ${dirty}; ${sync}; last: ${s.lastCommit}`;
}

export const listRepos = defineTool({
  name: 'list_repos',
  title: 'List git projects',
  description:
    'List the git projects found in the workspace, with their GitHub repo (from the origin remote) and any worktrees. ' +
    'Worktrees of the same repository are grouped under one project. Use this to learn project names.',
  access: 'read',
  inputSchema: {},
  async run(_args, ctx) {
    const projects = await ctx.repos.projects();
    if (projects.length === 0) return 'No git repositories were found under the workspace root.';
    return clip(
      projects
        .map((p) => {
          const remote = p.remote ? `${p.remote.owner}/${p.remote.repo}` : 'no GitHub remote';
          const trees = p.worktrees.map((w) => `    - ${w.folder} [${w.branch ?? 'detached'}]${w.isMain ? ' (main)' : ''}`).join('\n');
          return `${p.name}  (${remote})\n${trees}`;
        })
        .join('\n'),
    );
  },
});

export const gitLog = defineTool({
  name: 'git_log',
  title: 'Recent commits',
  description:
    'Recent commits of a project. scope "current" = the checked-out branch, "all" = every local and remote branch, ' +
    '"remote" = branches on origin as of the last fetch (what has been pushed). Set refresh_remote to run git fetch first.',
  access: 'read',
  inputSchema: {
    project: z.string().describe('Project name from list_repos (partial names work)'),
    scope: z.enum(['current', 'all', 'remote']).default('current'),
    worktree: z.string().optional().describe('Worktree folder or branch name; defaults to the main checkout'),
    limit: z.number().int().min(1).max(30).default(10),
    since: z
      .string()
      .regex(/^[A-Za-z0-9 :.-]{1,40}$/)
      .optional()
      .describe('Only commits after this, e.g. "2026-10-01" or "2 weeks ago"'),
    refresh_remote: z.boolean().default(false).describe('Run git fetch first (needs network, up to 20 s)'),
  },
  async run({ project, scope, worktree, limit, since, refresh_remote }, ctx) {
    const proj = await ctx.repos.find(project);
    const wt = pickWorktree(proj, worktree);
    if (refresh_remote) await git(wt.path, ['fetch', '--quiet', '--prune', 'origin'], 20_000);
    const commits = await recentCommits(wt, scope, limit, since);
    if (commits.length === 0) return `No commits found for ${proj.name} (${scope}).`;
    return clip(`${proj.name} / ${wt.folder} / scope=${scope}\n` + commits.map(formatCommit).join('\n'));
  },
});

export const gitStatus = defineTool({
  name: 'git_status',
  title: 'Working tree status',
  description:
    'For every checkout (worktree) of a project: branch, uncommitted changes, unpushed and unpulled commits, last commit. ' +
    'Unpushed/unpulled counts are relative to the last fetch.',
  access: 'read',
  inputSchema: { project: z.string().describe('Project name from list_repos (partial names work)') },
  async run({ project }, ctx) {
    const proj = await ctx.repos.find(project);
    const statuses = await Promise.all(proj.worktrees.map((w) => worktreeStatus(w)));
    return clip(`${proj.name}\n` + statuses.map(formatStatus).join('\n'));
  },
});

export const gitTools = [listRepos, gitLog, gitStatus];
