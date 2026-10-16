import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import {
  firstLine,
  handoffDir,
  KIND_FOLDER,
  listEntries,
  nextNumber,
  stateTemplate,
  type LogKind,
} from '../handoff.js';
import { slug } from '../git/repos.js';
import { clip, defineTool, type AppContext } from '../tool.js';

async function resolveName(ctx: AppContext, project: string): Promise<string> {
  try {
    return (await ctx.repos.find(project)).name;
  } catch {
    const cleaned = project.trim();
    if (!cleaned || cleaned.length > 60) throw new ToolError('project name must be 1-60 characters.');
    return cleaned;
  }
}

export const handoffInit = defineTool({
  name: 'handoff_init',
  title: 'Set up handoff files',
  description:
    'Create the handoff folder for a project under .handoff/<project>/: PROJECT_STATE.md plus PLAN_LOG, CHECKPOINTS and ' +
    'DECISIONS folders. Safe to call twice; existing files are never overwritten. Edit PROJECT_STATE.md afterwards with str_replace.',
  access: 'write',
  inputSchema: { project: z.string().describe('Project name (matched against git projects when possible)') },
  async run({ project }, ctx) {
    const name = await resolveName(ctx, project);
    const dir = handoffDir(ctx.config.workspaceRoot, slug(name));
    const created: string[] = [];
    for (const folder of Object.values(KIND_FOLDER)) {
      const target = path.join(dir, folder);
      if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
        created.push(`${folder}/`);
      }
    }
    const state = path.join(dir, 'PROJECT_STATE.md');
    if (!fs.existsSync(state)) {
      fs.writeFileSync(state, stateTemplate(name), 'utf8');
      created.push('PROJECT_STATE.md');
    }
    const where = `.handoff/${slug(name)}`;
    return created.length ? `Created in ${where}: ${created.join(', ')}` : `${where} already set up. Nothing changed.`;
  },
});

export const handoffRead = defineTool({
  name: 'handoff_read',
  title: 'Load project context',
  description:
    'Start-of-session call. Returns PROJECT_STATE.md, the titles of the latest plan log entries and decisions, and the ' +
    'newest checkpoint in one reply, so you do not have to read each file separately.',
  access: 'read',
  inputSchema: { project: z.string().describe('Project name') },
  async run({ project }, ctx) {
    const name = await resolveName(ctx, project);
    const dir = handoffDir(ctx.config.workspaceRoot, slug(name));
    const statePath = path.join(dir, 'PROJECT_STATE.md');
    if (!fs.existsSync(statePath)) {
      throw new ToolError(`No handoff files for ${name} yet. Call handoff_init first.`);
    }
    const parts = [`PROJECT_STATE (.handoff/${slug(name)}/PROJECT_STATE.md)`, fs.readFileSync(statePath, 'utf8').trim()];

    const plans = listEntries(dir, 'plan').slice(0, 3);
    parts.push('', `Latest plan log entries:`, plans.length ? plans.map((f) => `- ${f}: ${firstLine(path.join(dir, 'PLAN_LOG', f))}`).join('\n') : '- none yet');

    const decisions = listEntries(dir, 'decision').slice(0, 5);
    parts.push('', 'Recent decisions:', decisions.length ? decisions.map((f) => `- ${f}: ${firstLine(path.join(dir, 'DECISIONS', f))}`).join('\n') : '- none yet');

    const checkpoint = listEntries(dir, 'checkpoint')[0];
    if (checkpoint) {
      const body = fs.readFileSync(path.join(dir, 'CHECKPOINTS', checkpoint), 'utf8').trim();
      parts.push('', `Newest checkpoint (${checkpoint}):`, body.slice(0, 3000));
    } else {
      parts.push('', 'Newest checkpoint: none yet');
    }
    return clip(parts.join('\n'));
  },
});

export const handoffLog = defineTool({
  name: 'handoff_log',
  title: 'Add handoff entry',
  description:
    'Append a numbered entry to the project log: kind "plan" -> PLAN_LOG, "decision" -> DECISIONS, "checkpoint" -> CHECKPOINTS. ' +
    'Write a checkpoint at the end of a session so the next session can continue from it. Entries are never edited, only added.',
  access: 'write',
  inputSchema: {
    project: z.string().describe('Project name'),
    kind: z.enum(['plan', 'decision', 'checkpoint']),
    title: z.string().min(1).max(80),
    body: z.string().min(1).max(10_000).describe('What was planned, decided or finished, and what comes next'),
  },
  async run({ project, kind, title, body }, ctx) {
    const name = await resolveName(ctx, project);
    const dir = handoffDir(ctx.config.workspaceRoot, slug(name));
    const folder = path.join(dir, KIND_FOLDER[kind as LogKind]);
    fs.mkdirSync(folder, { recursive: true });
    const n = String(nextNumber(dir, kind as LogKind)).padStart(4, '0');
    const file = `${n}-${slug(title).slice(0, 40)}.md`;
    const text = `# ${n} ${title.trim()}\n\nDate: ${new Date().toISOString().slice(0, 10)}\n\n${body.trim()}\n`;
    fs.writeFileSync(path.join(folder, file), text, { encoding: 'utf8', flag: 'wx' });
    return `Saved .handoff/${slug(name)}/${KIND_FOLDER[kind as LogKind]}/${file}`;
  },
});

export const handoffTools = [handoffInit, handoffRead, handoffLog];
