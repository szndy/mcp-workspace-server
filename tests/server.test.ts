import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/audit.js';
import { createApp } from '../src/app.js';
import { roleForToken } from '../src/auth.js';
import { ADMIN, makeCtx, READER } from './helpers.js';

describe('roleForToken', () => {
  const cfg = { adminToken: ADMIN, readerToken: READER };
  it('maps tokens to roles', () => {
    expect(roleForToken(cfg, ADMIN)).toBe('admin');
    expect(roleForToken(cfg, READER)).toBe('reader');
    expect(roleForToken(cfg, 'wrong')).toBeUndefined();
    expect(roleForToken(cfg, undefined)).toBeUndefined();
    expect(roleForToken({ adminToken: ADMIN }, READER)).toBeUndefined();
  });
});

describe('HTTP server with a real MCP client', async () => {
  const { ctx, logDir, workspaceRoot } = await makeCtx({ masterlist: true });
  const server = createApp(ctx, new AuditLog(logDir)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(() => new Promise((r) => server.close(r)));

  async function connect(url: string, headers?: Record<string, string>) {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
    return client;
  }
  const text = (res: any) => (res.content as { text: string }[])[0]!.text;

  it('health check needs no token, everything else does', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const noAuth = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(noAuth.status).toBe(401);
    const wrong = await fetch(`${base}/mcp/not-the-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(wrong.status).toBe(401);
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404);
  });

  it('admin (token in the URL path) sees all tools', async () => {
    const client = await connect(`${base}/mcp/${ADMIN}`);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const n of ['read_file', 'str_replace', 'delete_file', 'project_summary', 'masterlist_remove', 'handoff_log']) {
      expect(names).toContain(n);
    }
    await client.close();
  });

  it('reader (Bearer header) only sees read-only tools', async () => {
    const client = await connect(`${base}/mcp`, { Authorization: `Bearer ${READER}` });
    const tools = (await client.listTools()).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('masterlist_count');
    for (const n of ['write_file', 'str_replace', 'delete_file', 'masterlist_add', 'masterlist_remove', 'handoff_log']) {
      expect(names).not.toContain(n);
    }
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    await client.close();
  });

  it('runs a multi-step task end to end and logs it without leaking contents', async () => {
    const client = await connect(`${base}/mcp/${ADMIN}`);
    const wrote = await client.callTool({ name: 'write_file', arguments: { path: 'demo/Demo.txt', content: 'hi cs 3a secret-body' } });
    expect(wrote.isError).toBeFalsy();
    const read = await client.callTool({ name: 'read_file', arguments: { path: 'demo/Demo.txt' } });
    expect(text(read)).toContain('hi cs 3a');
    expect(fs.readFileSync(path.join(workspaceRoot, 'demo', 'Demo.txt'), 'utf8')).toBe('hi cs 3a secret-body');

    const escape = await client.callTool({ name: 'read_file', arguments: { path: '../../etc/passwd' } });
    expect(escape.isError).toBe(true);
    expect(text(escape)).toMatch(/escapes/);

    const bad = await client.callTool({ name: 'masterlist_remove', arguments: { number: 1, tupm_id: 'TUPM-24-1001', confirm: false } });
    expect(bad.isError).toBe(true); // schema rejects confirm: false

    const count = await client.callTool({ name: 'masterlist_count', arguments: {} });
    expect(text(count)).toContain('6 students');
    await client.close();

    const log = fs.readFileSync(path.join(logDir, 'tool-calls.jsonl'), 'utf8');
    expect(log).toContain('"tool":"write_file"');
    expect(log).toContain('"content":"[20 chars]"');
    expect(log).not.toContain('secret-body');
  });

  it('never returns raw stack traces', async () => {
    const client = await connect(`${base}/mcp/${ADMIN}`);
    const res = await client.callTool({ name: 'list_files', arguments: { path: 'does-not-exist' } });
    expect(res.isError).toBe(true);
    expect(text(res)).not.toMatch(/\bat .*\.ts:\d+/);
    await client.close();
  });
});
