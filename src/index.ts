import 'dotenv/config';
import { AuditLog } from './audit.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { RepoIndex } from './git/repos.js';
import { GitHubClient } from './github.js';
import { MasterlistStore } from './masterlist/store.js';
import type { AppContext } from './tool.js';

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const ctx: AppContext = {
    config,
    repos: new RepoIndex(config.workspaceRoot, config.scanDepth),
    github: new GitHubClient(config.githubToken),
    masterlist: config.masterlistPath ? new MasterlistStore(config.masterlistPath, config.backupDir) : undefined,
  };
  const audit = new AuditLog(config.logDir);
  const app = createApp(ctx, audit);

  const server = app.listen(config.port, '127.0.0.1', () => {
    console.log(`mcp-workspace-server listening on http://127.0.0.1:${config.port}`);
    console.log(`workspace: ${config.workspaceRoot}`);
    console.log(`masterlist: ${config.masterlistPath ?? 'not configured'}`);
    console.log(`github: ${config.githubToken ? 'token set' : 'no token (PR/issue tools disabled)'}`);
    console.log(`reader token: ${config.readerToken ? 'set' : 'not set'}`);
  });

  const stop = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
