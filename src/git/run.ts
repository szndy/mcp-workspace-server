import { execFile } from 'node:child_process';
import { ToolError } from '../errors.js';

/** Run git with an argument array (no shell), never prompting for credentials. */
export function git(cwd: string, args: string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') return reject(new ToolError('git is not installed or not on PATH.'));
          const firstLine = String(stderr || err.message).split('\n')[0]?.trim() ?? 'unknown error';
          return reject(new ToolError(`git failed: ${firstLine}`));
        }
        resolve(stdout);
      },
    );
  });
}

const SAFE_REF = /^[A-Za-z0-9._/@-]+$/;

export function assertSafeRef(ref: string): string {
  if (!SAFE_REF.test(ref) || ref.startsWith('-') || ref.includes('..')) {
    throw new ToolError(`"${ref}" is not a valid branch name.`);
  }
  return ref;
}
