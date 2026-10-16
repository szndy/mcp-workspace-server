import fs from 'node:fs';
import path from 'node:path';
import { ToolError } from './errors.js';

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_PATH_LENGTH = 500;

function isBlockedSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  if (lower === '.git') return true;
  if (lower === '.env' || lower.startsWith('.env.')) return true;
  return false;
}

function insideRoot(realRoot: string, candidate: string): boolean {
  const win = process.platform === 'win32';
  const a = win ? realRoot.toLowerCase() : realRoot;
  const b = win ? candidate.toLowerCase() : candidate;
  return b === a || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
}

function nearestExisting(p: string): string {
  let current = p;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

/**
 * Turn a user supplied relative path into an absolute path that is guaranteed to
 * stay inside `root`. Throws ToolError for anything that tries to leave it.
 */
export function resolveInRoot(root: string, userPath: string): string {
  if (typeof userPath !== 'string') throw new ToolError('path must be a string.');
  if (userPath.length > MAX_PATH_LENGTH) throw new ToolError('path is too long.');
  if (userPath.includes('\0')) throw new ToolError('path contains an invalid character.');

  const normalised = userPath.replace(/\\/g, '/');
  if (normalised.startsWith('/') || /^[a-zA-Z]:/.test(normalised)) {
    throw new ToolError('Use a path relative to the workspace root, not an absolute path.');
  }

  const segments = normalised.split('/').filter((s) => s !== '' && s !== '.');
  for (const segment of segments) {
    if (segment === '..') throw new ToolError('Path escapes the workspace root.');
    if (segment.includes(':')) throw new ToolError('":" is not allowed in a path.');
    if (/[. ]$/.test(segment)) throw new ToolError('Path segments may not end with a dot or space.');
    if (/~\d/.test(segment)) throw new ToolError('Short (8.3) style names are not allowed.');
    if (RESERVED_NAMES.test(segment)) throw new ToolError(`"${segment}" is a reserved name.`);
    if (isBlockedSegment(segment)) throw new ToolError(`"${segment}" is protected and cannot be accessed.`);
  }

  const absolute = path.join(root, ...segments);
  const rel = path.relative(root, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ToolError('Path escapes the workspace root.');
  }

  // Follow symlinks / junctions on the part of the path that already exists.
  const realRoot = fs.realpathSync(root);
  const realExisting = fs.realpathSync(nearestExisting(absolute));
  if (!insideRoot(realRoot, realExisting)) {
    throw new ToolError('Path resolves outside the workspace root.');
  }
  return absolute;
}

/** Path shown to the agent: relative to the root, forward slashes. */
export function displayPath(root: string, absolute: string): string {
  const rel = path.relative(root, absolute).split(path.sep).join('/');
  return rel === '' ? '.' : rel;
}

/** Directory names the listing and search tools never descend into. */
export const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  '.next',
  '.gradle',
  '.dart_tool',
  '.trash',
]);
