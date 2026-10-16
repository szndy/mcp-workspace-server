import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ToolError } from '../errors.js';

export interface Student {
  number: number;
  tupmId: string;
  lastName: string;
  firstName: string;
  middleName: string;
}

export type NewStudent = Omit<Student, 'number'>;

const HEADER_NAMES = {
  number: '#',
  tupmId: 'tupm-id',
  lastName: 'last_name',
  firstName: 'first_name',
  middleName: 'middle_name',
} as const;

const ID_PATTERN = /^TUPM-\d{2}-\d{4,5}$/;
const MAX_BACKUPS = 20;

interface Sheet {
  workbook: ExcelJS.Workbook;
  ws: ExcelJS.Worksheet;
  headerRow: number;
  cols: Record<keyof typeof HEADER_NAMES, number>;
  students: Student[];
}

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function cleanName(value: string, label: string, required: boolean): string {
  const v = value.replace(/\s+/g, ' ').trim();
  if (required && v === '') throw new ToolError(`${label} is required.`);
  if (v.length > 60) throw new ToolError(`${label} is too long (max 60 characters).`);
  if (/[\u0000-\u001f=+@]/.test(v.charAt(0)) || /[\u0000-\u001f]/.test(v)) {
    throw new ToolError(`${label} contains characters that are not allowed.`);
  }
  return v;
}

export function cleanStudent(input: NewStudent): NewStudent {
  const tupmId = input.tupmId.trim().toUpperCase();
  if (!ID_PATTERN.test(tupmId)) {
    throw new ToolError('TUPM ID must look like TUPM-24-0123 (TUPM, 2-digit year, 4 or 5 digits).');
  }
  return {
    tupmId,
    lastName: cleanName(input.lastName, 'last_name', true),
    firstName: cleanName(input.firstName, 'first_name', true),
    middleName: cleanName(input.middleName ?? '', 'middle_name', false),
  };
}

function friendlyFsError(err: unknown, action: string): never {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    throw new ToolError(
      `Could not ${action} the masterlist because the file is locked. Close it in Excel and try again.`,
    );
  }
  if (code === 'ENOENT') throw new ToolError('The masterlist file was not found. Check MASTERLIST_PATH.');
  throw err;
}

export class MasterlistStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly backupDir: string,
  ) {}

  private async load(): Promise<Sheet> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.readFile(this.file);
    } catch (err) {
      friendlyFsError(err, 'read');
    }
    const ws = workbook.worksheets[0];
    if (!ws) throw new ToolError('The masterlist workbook has no sheets.');

    let headerRow = 0;
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      if (ws.getRow(r).getCell(1).text.trim() === HEADER_NAMES.number) {
        headerRow = r;
        break;
      }
    }
    if (!headerRow) throw new ToolError('Could not find the header row (a row starting with "#") in the first 10 rows.');

    const header = ws.getRow(headerRow);
    const cols = {} as Record<keyof typeof HEADER_NAMES, number>;
    for (const key of Object.keys(HEADER_NAMES) as (keyof typeof HEADER_NAMES)[]) {
      let found = 0;
      header.eachCell((cell, colNumber) => {
        if (!found && norm(cell.text) === HEADER_NAMES[key]) found = colNumber;
      });
      if (!found) throw new ToolError(`Column "${HEADER_NAMES[key]}" was not found in the header row.`);
      cols[key] = found;
    }

    const students: Student[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const tupmId = row.getCell(cols.tupmId).text.trim();
      const lastName = row.getCell(cols.lastName).text.trim();
      const firstName = row.getCell(cols.firstName).text.trim();
      if (!tupmId && !lastName && !firstName) continue;
      students.push({
        number: students.length + 1,
        tupmId,
        lastName,
        firstName,
        middleName: row.getCell(cols.middleName).text.trim(),
      });
    }
    return { workbook, ws, headerRow, cols, students };
  }

  async all(): Promise<Student[]> {
    return (await this.load()).students;
  }

  async count(): Promise<number> {
    return (await this.all()).length;
  }

  async get(number: number): Promise<Student | undefined> {
    return (await this.all()).find((s) => s.number === number);
  }

  async range(from: number, to: number): Promise<Student[]> {
    return (await this.all()).filter((s) => s.number >= from && s.number <= to);
  }

  /** Every word of the query must appear somewhere in the ID or name, in any order. */
  async search(query: string): Promise<Student[]> {
    const words = norm(query).split(/[\s,]+/).filter(Boolean);
    if (words.length === 0) return [];
    return (await this.all()).filter((s) => {
      const haystack = norm(`${s.tupmId} ${s.firstName} ${s.middleName} ${s.lastName}`);
      return words.every((w) => haystack.includes(w));
    });
  }

  /** Appends unless position (1-based) is given. */
  add(input: NewStudent, position?: number): Promise<Student> {
    return this.mutate((students) => {
      const clean = cleanStudent(input);
      if (students.some((s) => s.tupmId === clean.tupmId)) {
        throw new ToolError(`TUPM ID ${clean.tupmId} is already on the list.`);
      }
      const at = position ?? students.length + 1;
      if (at < 1 || at > students.length + 1) {
        throw new ToolError(`position must be between 1 and ${students.length + 1}.`);
      }
      const list = [...students];
      list.splice(at - 1, 0, { number: at, ...clean });
      return { list, result: { number: at, ...clean } };
    });
  }

  /** Remove the student at `number`, but only if the TUPM ID matches what the caller expects. */
  remove(number: number, expectedId: string): Promise<Student> {
    return this.mutate((students) => {
      const target = students.find((s) => s.number === number);
      if (!target) throw new ToolError(`There is no student number ${number} (list has ${students.length}).`);
      if (target.tupmId.toUpperCase() !== expectedId.trim().toUpperCase()) {
        throw new ToolError(
          `Number ${number} is ${target.tupmId}, not ${expectedId.trim()}. Nothing was removed. Look the student up again.`,
        );
      }
      return { list: students.filter((s) => s !== target), result: target };
    });
  }

  private mutate<T>(change: (students: Student[]) => { list: Student[]; result: T }): Promise<T> {
    const run = this.queue.then(() => this.applyChange(change));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async applyChange<T>(change: (students: Student[]) => { list: Student[]; result: T }): Promise<T> {
    const dir = path.dirname(this.file);
    const lockFile = path.join(dir, `~$${path.basename(this.file)}`);
    if (fs.existsSync(lockFile)) {
      throw new ToolError('The masterlist is open in Excel. Close it and try again.');
    }

    const sheet = await this.load();
    const { list, result } = change(sheet.students);
    const { ws, headerRow, cols } = sheet;
    const oldCount = sheet.students.length;
    const firstData = headerRow + 1;

    this.backup();

    list.forEach((student, i) => {
      const rowIndex = firstData + i;
      const row = ws.getRow(rowIndex);
      if (rowIndex > firstData + oldCount - 1 && rowIndex > 1) {
        const template = ws.getRow(rowIndex - 1);
        row.height = template.height;
        for (let c = 1; c <= ws.columnCount; c++) {
          row.getCell(c).style = { ...template.getCell(c).style };
        }
      }
      row.getCell(cols.number).value = i + 1;
      row.getCell(cols.tupmId).value = student.tupmId;
      row.getCell(cols.lastName).value = student.lastName;
      row.getCell(cols.firstName).value = student.firstName;
      row.getCell(cols.middleName).value = student.middleName;
      row.commit();
    });
    if (list.length < oldCount) {
      ws.spliceRows(firstData + list.length, oldCount - list.length);
    }

    const tmp = `${this.file}.tmp`;
    try {
      await sheet.workbook.xlsx.writeFile(tmp);
      fs.renameSync(tmp, this.file);
    } catch (err) {
      friendlyFsError(err, 'save');
    } finally {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    }
    return result;
  }

  private backup(): void {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.basename(this.file, path.extname(this.file));
    fs.copyFileSync(this.file, path.join(this.backupDir, `${base}__${stamp}.xlsx`));
    const old = fs
      .readdirSync(this.backupDir)
      .filter((f) => f.startsWith(`${base}__`) && f.endsWith('.xlsx'))
      .sort();
    for (const f of old.slice(0, Math.max(0, old.length - MAX_BACKUPS))) {
      fs.rmSync(path.join(this.backupDir, f), { force: true });
    }
  }
}
