import fs from 'node:fs';
import path from 'node:path';

export interface AuditEntry {
  ts: string;
  role: string;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  error?: string;
}

// Values of these arguments are replaced by their length so the log never holds
// file contents or student details.
const REDACTED_KEYS = new Set([
  'content',
  'old_str',
  'new_str',
  'body',
  'first_name',
  'last_name',
  'middle_name',
  'tupm_id',
  'query',
]);

export function summariseArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (REDACTED_KEYS.has(key) && typeof value === 'string') {
      out[key] = `[${value.length} chars]`;
    } else if (typeof value === 'string' && value.length > 200) {
      out[key] = value.slice(0, 200) + '...';
    } else {
      out[key] = value;
    }
  }
  return out;
}

export class AuditLog {
  private readonly file: string;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'tool-calls.jsonl');
  }

  write(entry: AuditEntry): void {
    try {
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error('audit log write failed:', (err as Error).message);
    }
  }
}
