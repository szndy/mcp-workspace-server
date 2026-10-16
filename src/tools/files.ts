import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import { displayPath, resolveInRoot, SKIPPED_DIRS } from '../sandbox.js';
import { clip, defineTool } from '../tool.js';

const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_WRITE_CHARS = 1_000_000;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;

export function versionOf(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 4096).includes(0);
}

function readText(abs: string, shown: string): string {
  if (!fs.existsSync(abs)) throw new ToolError(`File not found: ${shown}`);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new ToolError(`${shown} is not a file.`);
  if (stat.size > MAX_READ_BYTES) throw new ToolError(`${shown} is larger than 5 MB.`);
  const buf = fs.readFileSync(abs);
  if (looksBinary(buf)) throw new ToolError(`${shown} looks like a binary file and cannot be read as text.`);
  return buf.toString('utf8');
}

function checkVersion(current: string, expected: string | undefined, shown: string): void {
  if (expected !== undefined && expected !== versionOf(current)) {
    throw new ToolError(
      `${shown} changed since you read it (expected version ${expected}, now ${versionOf(current)}). Read it again before editing.`,
    );
  }
}

export const listFiles = defineTool({
  name: 'list_files',
  title: 'List files',
  description:
    'List files and folders under a workspace path. Use depth 1 first and go deeper only when needed. ' +
    'Skips .git, node_modules and similar folders. Returns at most 200 entries.',
  access: 'read',
  inputSchema: {
    path: z.string().default('.').describe('Folder relative to the workspace root, e.g. "Pawi" or "."'),
    depth: z.number().int().min(1).max(3).default(1).describe('How many folder levels to show (1-3)'),
  },
  async run({ path: p, depth }, ctx) {
    const root = ctx.config.workspaceRoot;
    const start = resolveInRoot(root, p);
    if (!fs.existsSync(start)) throw new ToolError(`Folder not found: ${p}`);
    if (!fs.statSync(start).isDirectory()) throw new ToolError(`${p} is a file, not a folder.`);

    const lines: string[] = [];
    let truncated = false;
    const walk = (dir: string, level: number): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (lines.length >= 200) {
          truncated = true;
          return;
        }
        if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        const shown = displayPath(root, abs);
        if (entry.isDirectory()) {
          lines.push(`${shown}/`);
          if (level < depth) walk(abs, level + 1);
        } else {
          let size = 0;
          try {
            size = fs.statSync(abs).size;
          } catch {
            /* unreadable entry, show size 0 */
          }
          lines.push(`${shown}  (${size} bytes)`);
        }
      }
    };
    walk(start, 1);
    if (lines.length === 0) return `${displayPath(root, start)} is empty.`;
    return lines.join('\n') + (truncated ? '\n...[more entries not shown; list a deeper folder]' : '');
  },
});

export const readFile = defineTool({
  name: 'read_file',
  title: 'Read file',
  description:
    'Read a text file in chunks. Returns the chunk, the total length, a "version" to pass as if_version when editing, ' +
    'and next_offset when more remains. Read before you write. Use search_files to find a spot instead of reading whole files.',
  access: 'read',
  inputSchema: {
    path: z.string().describe('File relative to the workspace root'),
    offset: z.number().int().min(0).default(0).describe('Character to start from'),
    limit: z.number().int().min(1).max(20000).default(8000).describe('Maximum characters to return'),
  },
  async run({ path: p, offset, limit }, ctx) {
    const abs = resolveInRoot(ctx.config.workspaceRoot, p);
    const text = readText(abs, p);
    const chunk = text.slice(offset, offset + limit);
    const end = offset + chunk.length;
    const head = [`path: ${p}`, `version: ${versionOf(text)}`, `total_chars: ${text.length}`, `range: ${offset}-${end}`];
    if (end < text.length) head.push(`next_offset: ${end}`);
    return head.join('\n') + '\n---\n' + chunk;
  },
});

export const writeFile = defineTool({
  name: 'write_file',
  title: 'Write file',
  description:
    'Create a text file or replace the whole content of an existing one. Missing folders are created. ' +
    'To change part of a file use str_replace instead. When replacing an existing file pass if_version from read_file ' +
    'so a newer edit is not overwritten.',
  access: 'write',
  inputSchema: {
    path: z.string().describe('File relative to the workspace root'),
    content: z.string().max(MAX_WRITE_CHARS).describe('Full new content of the file'),
    if_version: z.string().optional().describe('Version from read_file; the write fails if the file has changed since'),
  },
  async run({ path: p, content, if_version }, ctx) {
    const abs = resolveInRoot(ctx.config.workspaceRoot, p);
    let existed = false;
    if (fs.existsSync(abs)) {
      if (!fs.statSync(abs).isFile()) throw new ToolError(`${p} is a folder.`);
      existed = true;
      checkVersion(fs.readFileSync(abs, 'utf8'), if_version, p);
    } else if (if_version !== undefined) {
      throw new ToolError(`${p} does not exist, so if_version cannot match.`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    return `${existed ? 'Replaced' : 'Created'} ${p} (${content.length} chars). version: ${versionOf(content)}`;
  },
});

export const strReplace = defineTool({
  name: 'str_replace',
  title: 'Replace text in file',
  description:
    'Replace exactly one occurrence of old_str with new_str in a file. Fails if old_str is missing or appears more than ' +
    'once, so include surrounding text to make it unique. Pass if_version from read_file to avoid overwriting newer edits.',
  access: 'write',
  inputSchema: {
    path: z.string().describe('File relative to the workspace root'),
    old_str: z.string().min(1).describe('Exact text to replace; must occur once'),
    new_str: z.string().describe('Replacement text (may be empty)'),
    if_version: z.string().optional().describe('Version from read_file'),
  },
  async run({ path: p, old_str, new_str, if_version }, ctx) {
    const abs = resolveInRoot(ctx.config.workspaceRoot, p);
    const text = readText(abs, p);
    checkVersion(text, if_version, p);
    const first = text.indexOf(old_str);
    if (first === -1) throw new ToolError(`old_str was not found in ${p}. Read the file again and copy the text exactly.`);
    if (text.indexOf(old_str, first + 1) !== -1) {
      throw new ToolError(`old_str appears more than once in ${p}. Add surrounding text so it matches exactly once.`);
    }
    const updated = text.slice(0, first) + new_str + text.slice(first + old_str.length);
    fs.writeFileSync(abs, updated, 'utf8');
    return `Edited ${p}. version: ${versionOf(updated)}`;
  },
});

export const deleteFile = defineTool({
  name: 'delete_file',
  title: 'Delete file',
  description:
    'Delete one file. The file is moved to the workspace ".trash" folder, not erased, so it can be restored. ' +
    'Requires confirm: true. Folders cannot be deleted.',
  access: 'destructive',
  inputSchema: {
    path: z.string().describe('File relative to the workspace root'),
    confirm: z.literal(true).describe('Must be true. Ask the user before setting it.'),
  },
  async run({ path: p }, ctx) {
    const root = ctx.config.workspaceRoot;
    const abs = resolveInRoot(root, p);
    if (!fs.existsSync(abs)) throw new ToolError(`File not found: ${p}`);
    if (!fs.statSync(abs).isFile()) throw new ToolError(`${p} is not a file. Only single files can be deleted.`);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashed = path.join(root, '.trash', `${stamp}__${path.basename(abs)}`);
    fs.mkdirSync(path.dirname(trashed), { recursive: true });
    fs.renameSync(abs, trashed);
    return `Moved ${p} to ${displayPath(root, trashed)}.`;
  },
});

export const searchFiles = defineTool({
  name: 'search_files',
  title: 'Search file contents',
  description:
    'Find lines containing a piece of text across the text files under a folder. Case-insensitive by default. ' +
    'Returns path:line: snippet, at most max_results matches. Use this instead of reading whole files.',
  access: 'read',
  inputSchema: {
    query: z.string().min(1).max(200).describe('Text to look for (plain text, not a regex)'),
    path: z.string().default('.').describe('Folder to search, relative to the workspace root'),
    max_results: z.number().int().min(1).max(100).default(30),
    case_sensitive: z.boolean().default(false),
  },
  async run({ query, path: p, max_results, case_sensitive }, ctx) {
    const root = ctx.config.workspaceRoot;
    const start = resolveInRoot(root, p);
    if (!fs.existsSync(start) || !fs.statSync(start).isDirectory()) throw new ToolError(`Folder not found: ${p}`);
    const needle = case_sensitive ? query : query.toLowerCase();
    const hits: string[] = [];
    let scanned = 0;

    const walk = (dir: string): void => {
      if (hits.length >= max_results) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (hits.length >= max_results) return;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRS.has(entry.name)) walk(abs);
          continue;
        }
        if (!entry.isFile() || entry.name.toLowerCase().startsWith('.env')) continue;
        let buf: Buffer;
        try {
          if (fs.statSync(abs).size > MAX_SEARCH_FILE_BYTES) continue;
          buf = fs.readFileSync(abs);
        } catch {
          continue;
        }
        if (looksBinary(buf)) continue;
        scanned++;
        const lines = buf.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length && hits.length < max_results; i++) {
          const line = lines[i] ?? '';
          if ((case_sensitive ? line : line.toLowerCase()).includes(needle)) {
            hits.push(`${displayPath(root, abs)}:${i + 1}: ${line.trim().slice(0, 160)}`);
          }
        }
      }
    };
    walk(start);
    if (hits.length === 0) return `No matches for "${query}" in ${scanned} text files.`;
    const note = hits.length >= max_results ? `\n...[stopped at ${max_results} matches]` : '';
    return clip(hits.join('\n') + note);
  },
});

export const fileTools = [listFiles, readFile, writeFile, strReplace, deleteFile, searchFiles];
