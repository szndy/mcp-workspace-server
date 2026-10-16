import { z } from 'zod';
import { ToolError } from '../errors.js';
import { formatIssue, formatPull } from '../github.js';
import { clip, defineTool, type AppContext } from '../tool.js';

async function repoOf(ctx: AppContext, project: string) {
  const proj = await ctx.repos.find(project);
  if (!proj.remote) {
    throw new ToolError(`${proj.name} has no GitHub "origin" remote, so there are no pull requests or issues to read.`);
  }
  return { proj, remote: proj.remote };
}

export const listPullRequests = defineTool({
  name: 'list_pull_requests',
  title: 'Pull requests',
  description:
    'List pull requests of a project from GitHub (read-only), most recently updated first. Defaults to open ones. ' +
    'Needs GITHUB_TOKEN with access to the repository.',
  access: 'read',
  inputSchema: {
    project: z.string().describe('Project name from list_repos (partial names work)'),
    state: z.enum(['open', 'closed', 'all']).default('open'),
    limit: z.number().int().min(1).max(20).default(10),
  },
  async run({ project, state, limit }, ctx) {
    const { remote } = await repoOf(ctx, project);
    const rows = await ctx.github.pulls(remote.owner, remote.repo, state, limit);
    if (rows.length === 0) return `No ${state === 'all' ? '' : state + ' '}pull requests in ${remote.owner}/${remote.repo}.`;
    return clip(`${remote.owner}/${remote.repo}\n` + rows.map(formatPull).join('\n'));
  },
});

export const listIssues = defineTool({
  name: 'list_issues',
  title: 'Issues',
  description:
    'List issues of a project from GitHub (read-only), most recently updated first. Pull requests are not included. ' +
    'Defaults to open ones. Needs GITHUB_TOKEN with access to the repository.',
  access: 'read',
  inputSchema: {
    project: z.string().describe('Project name from list_repos (partial names work)'),
    state: z.enum(['open', 'closed', 'all']).default('open'),
    limit: z.number().int().min(1).max(20).default(10),
  },
  async run({ project, state, limit }, ctx) {
    const { remote } = await repoOf(ctx, project);
    const rows = await ctx.github.issues(remote.owner, remote.repo, state, limit);
    if (rows.length === 0) return `No ${state === 'all' ? '' : state + ' '}issues in ${remote.owner}/${remote.repo}.`;
    return clip(`${remote.owner}/${remote.repo}\n` + rows.map(formatIssue).join('\n'));
  },
});

export const githubTools = [listPullRequests, listIssues];
