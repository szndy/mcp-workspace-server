import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeCtx, tool } from './helpers.js';

describe('file tools', async () => {
  const { ctx, workspaceRoot } = await makeCtx();
  const run = (name: string, args: Record<string, unknown>) => tool(ctx, name).run(args, ctx);
  const version = (text: string) => /version: (\w+)/.exec(text)?.[1] as string;

  it('writes, reads in chunks and lists', async () => {
    await run('write_file', { path: 'demo/notes.txt', content: 'abcdefghij' });
    const first = await run('read_file', { path: 'demo/notes.txt', offset: 0, limit: 4 });
    expect(first).toContain('abcd');
    expect(first).toContain('next_offset: 4');
    const rest = await run('read_file', { path: 'demo/notes.txt', offset: 4, limit: 100 });
    expect(rest).toContain('efghij');
    expect(rest).not.toContain('next_offset');
    expect(await run('list_files', { path: '.', depth: 2 })).toContain('demo/notes.txt');
  });

  it('str_replace needs exactly one match', async () => {
    await run('write_file', { path: 'r.txt', content: 'one two two' });
    await expect(run('str_replace', { path: 'r.txt', old_str: 'two', new_str: 'x' })).rejects.toThrow(/more than once/);
    await expect(run('str_replace', { path: 'r.txt', old_str: 'zzz', new_str: 'x' })).rejects.toThrow(/not found/);
    await run('str_replace', { path: 'r.txt', old_str: 'one', new_str: '1' });
    expect(fs.readFileSync(path.join(workspaceRoot, 'r.txt'), 'utf8')).toBe('1 two two');
  });

  it('if_version blocks stale edits', async () => {
    await run('write_file', { path: 'v.txt', content: 'v1' });
    const v1 = version(await run('read_file', { path: 'v.txt' }));
    await run('write_file', { path: 'v.txt', content: 'v2', if_version: v1 });
    await expect(run('write_file', { path: 'v.txt', content: 'v3', if_version: v1 })).rejects.toThrow(/changed since/);
    await expect(run('str_replace', { path: 'v.txt', old_str: 'v2', new_str: 'x', if_version: v1 })).rejects.toThrow(/changed since/);
  });

  it('delete moves the file to .trash', async () => {
    await run('write_file', { path: 'gone.txt', content: 'bye' });
    const msg = await run('delete_file', { path: 'gone.txt', confirm: true });
    expect(msg).toContain('.trash/');
    expect(fs.existsSync(path.join(workspaceRoot, 'gone.txt'))).toBe(false);
    expect(fs.readdirSync(path.join(workspaceRoot, '.trash')).some((f) => f.endsWith('__gone.txt'))).toBe(true);
    await run('write_file', { path: 'folder/inner.txt', content: 'x' });
    await expect(run('delete_file', { path: 'folder', confirm: true })).rejects.toThrow(/not a file/);
  });

  it('refuses escapes and protected paths', async () => {
    await expect(run('read_file', { path: '../x' })).rejects.toThrow();
    await expect(run('write_file', { path: '../x.txt', content: 'x' })).rejects.toThrow();
    await expect(run('write_file', { path: 'a/.git/hooks/pre-commit', content: 'x' })).rejects.toThrow(/protected/);
  });

  it('refuses binary files', async () => {
    fs.writeFileSync(path.join(workspaceRoot, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
    await expect(run('read_file', { path: 'bin.dat' })).rejects.toThrow(/binary/);
  });

  it('search_files finds lines and skips ignored folders', async () => {
    await run('write_file', { path: 's/a.md', content: 'alpha\nNeedle here\nomega' });
    await run('write_file', { path: 's/node_modules/x.js', content: 'needle hidden' });
    const out = await run('search_files', { query: 'needle', path: 's', max_results: 10, case_sensitive: false });
    expect(out).toContain('s/a.md:2: Needle here');
    expect(out).not.toContain('node_modules');
    expect(await run('search_files', { query: 'nothing-like-this', path: 's', max_results: 10, case_sensitive: false })).toMatch(/No matches/);
  });
});
