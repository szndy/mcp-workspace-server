import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { ADMIN, READER, tempDir } from './helpers.js';

describe('loadConfig', () => {
  const base = tempDir();
  fs.mkdirSync(path.join(base, 'ws'));
  const env = { ADMIN_TOKEN: ADMIN, WORKSPACE_ROOT: 'ws' };

  it('loads a minimal config', () => {
    const c = loadConfig(env, base);
    expect(c.port).toBe(3000);
    expect(c.workspaceRoot).toBe(fs.realpathSync(path.join(base, 'ws')));
    expect(c.masterlistPath).toBeUndefined();
  });

  it('treats blank values as unset', () => {
    expect(loadConfig({ ...env, MASTERLIST_PATH: '', GITHUB_TOKEN: '  ', READER_TOKEN: '' }, base).readerToken).toBeUndefined();
  });

  it('requires a strong admin token', () => {
    expect(() => loadConfig({ WORKSPACE_ROOT: 'ws' }, base)).toThrow(/ADMIN_TOKEN/);
    expect(() => loadConfig({ ...env, ADMIN_TOKEN: 'short' }, base)).toThrow(/24 characters/);
    expect(() => loadConfig({ ...env, READER_TOKEN: ADMIN }, base)).toThrow(/must differ/);
    expect(() => loadConfig({ ...env, READER_TOKEN: READER }, base)).not.toThrow();
  });

  it('fails clearly on a missing workspace or masterlist', () => {
    expect(() => loadConfig({ ...env, WORKSPACE_ROOT: 'nope' }, base)).toThrow(/WORKSPACE_ROOT does not exist/);
    expect(() => loadConfig({ ...env, MASTERLIST_PATH: 'nope.xlsx' }, base)).toThrow(/not found/);
    expect(() => loadConfig({ ...env, MASTERLIST_PATH: 'ws' }, base)).toThrow(/\.xlsx/);
  });

  it('single-quoted Windows paths with spaces, brackets and # survive .env parsing', () => {
    const parsed = dotenv.parse(
      [
        "WORKSPACE_ROOT='D:\\.acads\\[1] PROJECTS'",
        "MASTERLIST_PATH='D:\\.acads\\[2] BSCS #A FILES\\BSCS-3A MASTERLIST.xlsx'",
        'PORT=3000',
      ].join('\n'),
    );
    expect(parsed['WORKSPACE_ROOT']).toBe('D:\\.acads\\[1] PROJECTS');
    expect(parsed['MASTERLIST_PATH']).toBe('D:\\.acads\\[2] BSCS #A FILES\\BSCS-3A MASTERLIST.xlsx');
  });
});
