import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Config, Role } from './config.js';

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

/** Constant-time comparison that does not leak the token length. */
function matches(candidate: string, secret: string): boolean {
  return crypto.timingSafeEqual(digest(candidate), digest(secret));
}

export function roleForToken(config: Pick<Config, 'adminToken' | 'readerToken'>, token: string | undefined): Role | undefined {
  if (!token) return undefined;
  if (matches(token, config.adminToken)) return 'admin';
  if (config.readerToken && matches(token, config.readerToken)) return 'reader';
  return undefined;
}

function tokenFromRequest(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  const fromPath = req.params['token'];
  return typeof fromPath === 'string' ? fromPath : undefined;
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 20;

/**
 * Accepts a token as "Authorization: Bearer ..." or as the last path segment
 * (/mcp/<token>), because some MCP clients can only be given a URL.
 * Repeated failures from one address are blocked for a while.
 */
export function authMiddleware(config: Config) {
  const failures = new Map<string, { count: number; since: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const record = failures.get(key);
    if (record && now - record.since > WINDOW_MS) failures.delete(key);

    const current = failures.get(key);
    if (current && current.count >= MAX_FAILURES) {
      res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
      return;
    }

    const role = roleForToken(config, tokenFromRequest(req));
    if (!role) {
      const entry = failures.get(key) ?? { count: 0, since: now };
      entry.count++;
      failures.set(key, entry);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    failures.delete(key);
    res.locals['role'] = role;
    next();
  };
}
