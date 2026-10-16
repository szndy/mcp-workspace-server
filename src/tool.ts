import type { z } from 'zod';
import type { Config } from './config.js';
import type { RepoIndex } from './git/repos.js';
import type { GitHubClient } from './github.js';
import type { MasterlistStore } from './masterlist/store.js';

export type Access = 'read' | 'write' | 'destructive';

export interface AppContext {
  config: Config;
  repos: RepoIndex;
  github: GitHubClient;
  masterlist?: MasterlistStore;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  access: Access;
  inputSchema: z.ZodRawShape;
  // Arguments are validated by the MCP SDK before this runs.
  run: (args: any, ctx: AppContext) => Promise<string>;
}

export function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  access: Access;
  inputSchema: S;
  run: (args: z.infer<z.ZodObject<S>>, ctx: AppContext) => Promise<string>;
}): ToolDef {
  return def as unknown as ToolDef;
}

/** Longest reply a tool may send back. Keeps the agent's context small. */
export const MAX_OUTPUT_CHARS = 20_000;

export function clip(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n...[output cut at ${max} characters; narrow the request]`;
}
