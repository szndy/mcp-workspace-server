import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRemote } from '../src/git/repos.js';
import { makeCtx, sh, tool } from './helpers.js';

describe('parseRemote', () => {
  it('reads https and ssh GitHub urls', () => {
    expect(parseRemote('https://github.com/szndy/Pawi.git')).toMatchObject({ owner: 'szndy', repo: 'Pawi' });
    expect(parseRemote('git@github.com:szndy/tupm-election-system.git')).toMatchObject({ owner: 'szndy', repo: 'tupm-election-system' });
    expect(parseRemote('https://github.com/szndy/x')).toMatchObject({ repo: 'x' });
    expect(parseRemote('https://gitlab.com/a/b.git')).toBeUndefined();
  });
});

describe('git and project tools', async () => {
  const { ctx, workspaceRoot } = await makeCtx();
  const run = (name: string, args: Record<string, unknown>) => tool(ctx, name).run(args, ctx);

  // A repo with sibling worktrees in a folder, and a plain repo at the top.
  const main = path.join(workspaceRoot, 'Project Management', 'BotikAh! PH');
  fs.mkdirSync(main, { recursive: true });
  sh(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'app.txt'), 'v1');
  sh(main, 'add', '.');
  sh(main, 'commit', '-q', '-m', 'first commit');
  sh(main, 'remote', 'add', 'origin', 'git@github.com:szndy/botikah-ph.git');
  const wt = path.join(workspaceRoot, 'Project Management', 'botikah-ph-labels');
  sh(main, 'worktree', 'add', '-q', '-b', 'feat/labels', wt);
  fs.writeFileSync(path.join(wt, 'labels.txt'), 'wip');
  sh(wt, 'add', '.');
  sh(wt, 'commit', '-q', '-m', 'add labels');
  fs.writeFileSync(path.join(wt, 'dirty.txt'), 'uncommitted');

  const pawi = path.join(workspaceRoot, 'Pawi');
  fs.mkdirSync(pawi);
  sh(pawi, 'init', '-q', '-b', 'main');

  it('groups worktrees under one project and reads the GitHub remote', async () => {
    const out = await run('list_repos', {});
    expect(out).toContain('BotikAh! PH  (szndy/botikah-ph)');
    expect(out).toContain('botikah-ph-labels [feat/labels]');
    expect(out).toContain('Pawi  (no GitHub remote)');
    expect(out.match(/^BotikAh! PH {2}\(/gm)?.length).toBe(1);
  });

  it('finds projects by loose name', async () => {
    expect(await run('git_log', { project: 'botikah', scope: 'current', limit: 5 })).toContain('first commit');
    await expect(run('git_log', { project: 'nothing', scope: 'current', limit: 5 })).rejects.toThrow(/Known projects/);
  });

  it('logs a chosen worktree', async () => {
    const out = await run('git_log', { project: 'BotikAh', scope: 'current', worktree: 'labels', limit: 5 });
    expect(out).toContain('add labels');
    expect(out).toContain('first commit');
  });

  it('reports status per worktree', async () => {
    const out = await run('git_status', { project: 'BotikAh! PH' });
    expect(out).toMatch(/botikah-ph-labels \[feat\/labels\] 0 changed, 1 untracked; no upstream/);
    expect(out).toMatch(/BotikAh! PH \[main\] clean/);
  });

  it('handles a repo with no commits', async () => {
    expect(await run('git_log', { project: 'Pawi', scope: 'current', limit: 5 })).toMatch(/No commits/);
    expect(await run('git_status', { project: 'Pawi' })).toContain('no commits yet');
  });

  it('summarises a project without a GitHub token', async () => {
    const out = await run('project_summary', { project: 'BotikAh' });
    expect(out).toContain('PROJECT: BotikAh! PH (github.com/szndy/botikah-ph)');
    expect(out).toContain('CHECKOUTS (2)');
    expect(out).toContain('GITHUB_TOKEN not set');
    expect(out).toContain('no handoff files yet');
  });

  it('PR tools explain a missing token and a missing remote', async () => {
    await expect(run('list_pull_requests', { project: 'BotikAh', state: 'open', limit: 5 })).rejects.toThrow(/GITHUB_TOKEN/);
    await expect(run('list_issues', { project: 'Pawi', state: 'open', limit: 5 })).rejects.toThrow(/no GitHub "origin" remote/);
  });

  it('rejects option-looking refs and bad since values', async () => {
    const schema = tool(ctx, 'git_log').inputSchema as any;
    expect(schema.since.safeParse('--output=/tmp/x').success).toBe(false);
    expect(schema.since.safeParse('2 weeks ago').success).toBe(true);
  });

  it('handoff files feed the summary', async () => {
    await run('handoff_init', { project: 'BotikAh' });
    await run('str_replace', {
      path: '.handoff/botikah/PROJECT_STATE.md'.replace('botikah', 'botikah-ph'),
      old_str: '## Current status\n',
      new_str: '## Current status\nLabels feature in progress.\n',
    });
    await run('handoff_log', { project: 'BotikAh', kind: 'plan', title: 'Plan labels work', body: 'Do labels, then maplink.' });
    await run('handoff_log', { project: 'BotikAh', kind: 'checkpoint', title: 'End of session one', body: 'Labels half done.' });
    await run('handoff_log', { project: 'BotikAh', kind: 'checkpoint', title: 'End of session two', body: 'Labels done.' });

    const read = await run('handoff_read', { project: 'BotikAh' });
    expect(read).toContain('Labels feature in progress.');
    expect(read).toContain('0001-plan-labels-work.md');
    expect(read).toContain('0002-end-of-session-two.md');
    expect(read).toContain('Labels done.');

    const summary = await run('project_summary', { project: 'BotikAh' });
    expect(summary).toContain('Labels feature in progress.');
    expect(summary).toContain('Latest checkpoint: 0002-end-of-session-two.md');
    expect(await run('handoff_init', { project: 'BotikAh' })).toContain('already set up');
  });
});
