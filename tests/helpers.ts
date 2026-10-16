import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AppContext, ToolDef } from '../src/tool.js';
import type { Config } from '../src/config.js';
import { RepoIndex } from '../src/git/repos.js';
import { GitHubClient } from '../src/github.js';
import { MasterlistStore } from '../src/masterlist/store.js';
import { allTools } from '../src/tools/index.js';
import { writeSampleMasterlist } from './fixtures.js';

export const ADMIN = 'a'.repeat(32);
export const READER = 'r'.repeat(32);

export function tempDir(prefix = 'mcp-test-'): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export async function makeCtx(options: { masterlist?: boolean; githubToken?: string } = {}) {
  const base = tempDir();
  const workspaceRoot = path.join(base, 'workspace');
  fs.mkdirSync(workspaceRoot);
  const logDir = path.join(base, 'logs');
  const backupDir = path.join(base, 'backups');
  let masterlistPath: string | undefined;
  if (options.masterlist) {
    masterlistPath = path.join(base, 'data', 'list.xlsx');
    await writeSampleMasterlist(masterlistPath, 6);
  }
  const config: Config = {
    port: 0,
    workspaceRoot,
    scanDepth: 3,
    masterlistPath,
    backupDir,
    logDir,
    adminToken: ADMIN,
    readerToken: READER,
    githubToken: options.githubToken,
  };
  const ctx: AppContext = {
    config,
    repos: new RepoIndex(workspaceRoot, 3),
    github: new GitHubClient(options.githubToken),
    masterlist: masterlistPath ? new MasterlistStore(masterlistPath, backupDir) : undefined,
  };
  return { base, ctx, workspaceRoot, masterlistPath, backupDir, logDir };
}

export function tool(ctx: AppContext, name: string): ToolDef {
  const found = allTools(ctx).find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return found;
}

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  });
}
