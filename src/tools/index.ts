import type { Access, AppContext, ToolDef } from '../tool.js';
import type { Role } from '../config.js';
import { fileTools } from './files.js';
import { githubTools } from './github.js';
import { gitTools } from './git.js';
import { handoffTools } from './handoff.js';
import { masterlistTools } from './masterlist.js';
import { projectTools } from './project.js';

export function allTools(ctx: AppContext): ToolDef[] {
  const tools = [...projectTools, ...gitTools, ...githubTools, ...handoffTools, ...fileTools];
  if (ctx.masterlist) tools.push(...masterlistTools);
  return tools;
}

/** Readers only get tools that cannot change anything. */
export function roleAllows(role: Role, access: Access): boolean {
  return role === 'admin' || access === 'read';
}
