import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export type Role = 'admin' | 'reader';

export interface Config {
  port: number;
  workspaceRoot: string;
  scanDepth: number;
  masterlistPath?: string;
  backupDir: string;
  logDir: string;
  adminToken: string;
  readerToken?: string;
  githubToken?: string;
}

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WORKSPACE_ROOT: z.string().min(1).default('./workspace'),
  SCAN_DEPTH: z.coerce.number().int().min(1).max(6).default(3),
  MASTERLIST_PATH: z.string().optional(),
  BACKUP_DIR: z.string().default('./backups'),
  LOG_DIR: z.string().default('./logs'),
  ADMIN_TOKEN: z
    .string({ error: 'ADMIN_TOKEN is required (generate one with: npm run token)' })
    .min(24, 'ADMIN_TOKEN must be at least 24 characters (generate one with: npm run token)'),
  READER_TOKEN: z.string().min(24, 'READER_TOKEN must be at least 24 characters').optional(),
  GITHUB_TOKEN: z.string().optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env, baseDir = process.cwd()): Config {
  // Blank values in .env should behave like "not set".
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') cleaned[key] = value.trim();
  }

  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const e = parsed.data;

  if (e.READER_TOKEN && e.READER_TOKEN === e.ADMIN_TOKEN) {
    throw new Error('Invalid configuration:\n  - READER_TOKEN must differ from ADMIN_TOKEN');
  }

  const workspaceRoot = path.resolve(baseDir, e.WORKSPACE_ROOT);
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    throw new Error(`Invalid configuration:\n  - WORKSPACE_ROOT does not exist: ${workspaceRoot}`);
  }

  let masterlistPath: string | undefined;
  if (e.MASTERLIST_PATH) {
    masterlistPath = path.resolve(baseDir, e.MASTERLIST_PATH);
    if (!masterlistPath.toLowerCase().endsWith('.xlsx')) {
      throw new Error('Invalid configuration:\n  - MASTERLIST_PATH must point to an .xlsx file');
    }
    if (!fs.existsSync(masterlistPath)) {
      throw new Error(`Invalid configuration:\n  - MASTERLIST_PATH not found: ${masterlistPath}`);
    }
  }

  return {
    port: e.PORT,
    workspaceRoot: fs.realpathSync(workspaceRoot),
    scanDepth: e.SCAN_DEPTH,
    masterlistPath,
    backupDir: path.resolve(baseDir, e.BACKUP_DIR),
    logDir: path.resolve(baseDir, e.LOG_DIR),
    adminToken: e.ADMIN_TOKEN,
    readerToken: e.READER_TOKEN,
    githubToken: e.GITHUB_TOKEN,
  };
}
