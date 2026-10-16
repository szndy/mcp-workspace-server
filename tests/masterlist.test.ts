import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { makeCtx, tool } from './helpers.js';

describe('masterlist tools', async () => {
  const { ctx, masterlistPath, backupDir } = await makeCtx({ masterlist: true });
  const run = (name: string, args: Record<string, unknown>) => tool(ctx, name).run(args, ctx);

  it('counts and looks up by number', async () => {
    expect(await run('masterlist_count', {})).toContain('6 students');
    expect(await run('masterlist_get', { number: 3 })).toContain('TUPM-24-1003');
    await expect(run('masterlist_get', { number: 99 })).rejects.toThrow(/no student number 99/);
  });

  it('searches by name in either order and by id', async () => {
    expect(await run('masterlist_search', { query: 'firstname02 lastname02' })).toContain('#2');
    expect(await run('masterlist_search', { query: 'Lastname05, Firstname05' })).toContain('#5');
    expect(await run('masterlist_search', { query: '24-1004' })).toContain('#4');
    expect(await run('masterlist_search', { query: 'nobody' })).toMatch(/No student/);
  });

  it('adds at the end, keeps the file layout, and writes a backup', async () => {
    const msg = await run('masterlist_add', { tupm_id: 'tupm-24-2001', last_name: 'Added', first_name: 'New', middle_name: 'Person' });
    expect(msg).toContain('#7');
    expect(msg).toContain('7 students');
    expect(fs.readdirSync(backupDir).length).toBe(1);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(masterlistPath as string);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toBe('SAMPLE CLASS MASTERLIST');
    expect(ws.getCell('A9').value).toBe(7);
    expect(ws.getCell('B9').value).toBe('TUPM-24-2001');
    expect(ws.getCell('A9').alignment?.horizontal).toBe('center');
  });

  it('rejects bad or duplicate ids and bad positions', async () => {
    await expect(run('masterlist_add', { tupm_id: 'TUPM-24-1001', last_name: 'A', first_name: 'B', middle_name: '' })).rejects.toThrow(/already/);
    await expect(run('masterlist_add', { tupm_id: 'nope', last_name: 'A', first_name: 'B', middle_name: '' })).rejects.toThrow(/TUPM ID must look like/);
    await expect(run('masterlist_add', { tupm_id: 'TUPM-24-3001', last_name: '=cmd', first_name: 'B', middle_name: '' })).rejects.toThrow(/not allowed/);
    await expect(run('masterlist_add', { tupm_id: 'TUPM-24-3001', last_name: 'A', first_name: 'B', middle_name: '', position: 50 })).rejects.toThrow(/position/);
  });

  it('inserts at a position and renumbers', async () => {
    await run('masterlist_add', { tupm_id: 'TUPM-24-2002', last_name: 'Inserted', first_name: 'Mid', middle_name: '', position: 2 });
    expect(await run('masterlist_get', { number: 2 })).toContain('TUPM-24-2002');
    expect(await run('masterlist_get', { number: 3 })).toContain('TUPM-24-1002');
    expect(await run('masterlist_count', {})).toContain('8 students');
  });

  it('removes only when the id matches, then renumbers and trims the sheet', async () => {
    await expect(run('masterlist_remove', { number: 2, tupm_id: 'TUPM-24-9999', confirm: true })).rejects.toThrow(/Nothing was removed/);
    expect(await run('masterlist_count', {})).toContain('8 students');
    const msg = await run('masterlist_remove', { number: 2, tupm_id: 'tupm-24-2002', confirm: true });
    expect(msg).toContain('Removed');
    expect(await run('masterlist_count', {})).toContain('7 students');
    expect(await run('masterlist_get', { number: 2 })).toContain('TUPM-24-1002');
    const all = await run('masterlist_list', { from: 1, to: 50 });
    expect(all.split('\n').length).toBe(7);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(masterlistPath as string);
    expect(wb.worksheets[0]!.rowCount).toBe(9); // title + header + 7 students
  });

  it('refuses to write while Excel holds the file open', async () => {
    const lock = path.join(path.dirname(masterlistPath as string), `~$${path.basename(masterlistPath as string)}`);
    fs.writeFileSync(lock, '');
    await expect(run('masterlist_add', { tupm_id: 'TUPM-24-4001', last_name: 'L', first_name: 'F', middle_name: '' })).rejects.toThrow(/open in Excel/);
    fs.rmSync(lock);
    expect(await run('masterlist_count', {})).toContain('7 students');
  });

  it('serialises concurrent writes without losing any', async () => {
    const before = Number(/(\d+) students/.exec(await run('masterlist_count', {}))![1]);
    await Promise.all(
      [1, 2, 3, 4].map((i) =>
        run('masterlist_add', { tupm_id: `TUPM-24-50${i}0`, last_name: `Par${i}`, first_name: 'X', middle_name: '' }),
      ),
    );
    expect(await run('masterlist_count', {})).toContain(`${before + 4} students`);
    const ids = (await run('masterlist_list', { from: 1, to: 50 })).split('\n').map((l) => l.split(/\s+/)[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
