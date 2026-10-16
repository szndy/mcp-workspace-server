import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInRoot } from '../src/sandbox.js';
import { tempDir } from './helpers.js';

const root = tempDir();
fs.mkdirSync(path.join(root, 'proj'));
fs.writeFileSync(path.join(root, 'proj', 'a.txt'), 'hi');

describe('resolveInRoot', () => {
  it('accepts normal relative paths', () => {
    expect(resolveInRoot(root, 'proj/a.txt')).toBe(path.join(root, 'proj', 'a.txt'));
    expect(resolveInRoot(root, '.')).toBe(root);
    expect(resolveInRoot(root, 'proj\\a.txt')).toBe(path.join(root, 'proj', 'a.txt'));
    expect(resolveInRoot(root, 'new/dir/file.md')).toBe(path.join(root, 'new', 'dir', 'file.md'));
  });

  it.each([
    '../outside.txt',
    'proj/../../outside.txt',
    '..\\..\\windows\\system32',
    'proj/..',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'D:/secret.txt',
    '//server/share/x',
  ])('rejects escape attempt %s', (p) => {
    expect(() => resolveInRoot(root, p)).toThrow();
  });

  it.each(['file.txt:stream', 'a\0b', 'proj/.git/config', '.GIT/config', '.env', 'proj/.env.local', 'name.', 'trail ', 'PROGRA~1', 'CON', 'nul.txt'])(
    'rejects unsafe name %j',
    (p) => {
      expect(() => resolveInRoot(root, p)).toThrow();
    },
  );

  it('allows .gitignore and .github', () => {
    expect(() => resolveInRoot(root, 'proj/.gitignore')).not.toThrow();
    expect(() => resolveInRoot(root, '.github/workflows/x.yml')).not.toThrow();
  });

  it('rejects a symlink that points outside the root', () => {
    const outside = tempDir('outside-');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
    try {
      fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
    } catch {
      return; // symlinks not permitted on this machine
    }
    expect(() => resolveInRoot(root, 'link/secret.txt')).toThrow(/outside/);
    expect(() => resolveInRoot(root, 'link/newfile.txt')).toThrow(/outside/);
  });

  it('rejects overly long paths', () => {
    expect(() => resolveInRoot(root, 'a/'.repeat(300))).toThrow();
  });
});
