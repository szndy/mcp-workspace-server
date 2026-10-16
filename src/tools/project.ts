import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { formatIssue, formatPull } from '../github.js';
import { firstLine, handoffDir, listEntries } from '../handoff.js';
import { slug } from '../git/repos.js';
import { clip, defineTool } from '../tool.js';
import { formatCommit, formatStatus, recentCommits, worktreeStatus } from './git.js';

async function attempt<T>(job: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await job };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'unavailable' };
  }
}

export const projectSummary = defineTool({
  name: 'project_summary',
  title: 'Project summary',
  description:
    'One-call status report for a project: every checkout with its branch and uncommitted/unpushed work, recent commits, ' +
    'commits already on origin, open pull requests, open issues, and the saved PROJECT_STATE / latest checkpoint. ' +
    'Use this first when asked where a project stands; it replaces several separate calls.',
  access: 'read',
  inputSchema: { project: z.string().describe('Project name from list_repos (partial names work)') },
  async run({ project }, ctx) {
    const proj = await ctx.repos.find(project);
    const remote = proj.remote;

    const [statuses, local, pushed, pulls, issues] = await Promise.all([
      Promise.all(proj.worktrees.map((w) => attempt(worktreeStatus(w)))),
      attempt(recentCommits(proj.primary, 'current', 5)),
      attempt(recentCommits(proj.primary, 'remote', 5)),
      remote && ctx.github.enabled ? attempt(ctx.github.pulls(remote.owner, remote.repo, 'open', 5)) : Promise.resolve(undefined),
      remote && ctx.github.enabled ? attempt(ctx.github.issues(remote.owner, remote.repo, 'open', 5)) : Promise.resolve(undefined),
    ]);

    const out: string[] = [`PROJECT: ${proj.name}${remote ? ` (github.com/${remote.owner}/${remote.repo})` : ' (no GitHub remote)'}`];

    out.push('', `CHECKOUTS (${proj.worktrees.length})`);
    for (const s of statuses) out.push(s.ok ? `- ${formatStatus(s.value)}` : `- unavailable: ${s.message}`);

    out.push('', `LATEST COMMITS on ${proj.primary.folder}`);
    if (local.ok) out.push(...(local.value.length ? local.value.map((c) => `- ${formatCommit(c)}`) : ['- none']));
    else out.push(`- unavailable: ${local.message}`);

    out.push('', 'PUSHED TO ORIGIN (as of last fetch)');
    if (pushed.ok) out.push(...(pushed.value.length ? pushed.value.map((c) => `- ${formatCommit(c)}`) : ['- nothing tracked from origin']));
    else out.push(`- unavailable: ${pushed.message}`);

    const section = (label: string, result: Awaited<ReturnType<typeof attempt<any[]>>> | undefined, fmt: (x: any) => string) => {
      out.push('', label);
      if (!remote) out.push('- no GitHub remote');
      else if (!ctx.github.enabled) out.push('- GITHUB_TOKEN not set');
      else if (!result) out.push('- unavailable');
      else if (!result.ok) out.push(`- unavailable: ${result.message}`);
      else out.push(...(result.value.length ? result.value.map((x) => `- ${fmt(x)}`) : ['- none open']));
    };
    section('OPEN PULL REQUESTS (up to 5)', pulls as any, formatPull);
    section('OPEN ISSUES (up to 5)', issues as any, formatIssue);

    const dir = handoffDir(ctx.config.workspaceRoot, slug(proj.name));
    const statePath = path.join(dir, 'PROJECT_STATE.md');
    out.push('', 'SAVED STATE');
    if (fs.existsSync(statePath)) {
      out.push(fs.readFileSync(statePath, 'utf8').trim().slice(0, 1500));
      const cp = listEntries(dir, 'checkpoint')[0];
      if (cp) out.push(`Latest checkpoint: ${cp} - ${firstLine(path.join(dir, 'CHECKPOINTS', cp))}`);
    } else {
      out.push('- no handoff files yet (handoff_init creates them)');
    }
    return clip(out.join('\n'));
  },
});

export const projectTools = [projectSummary];
