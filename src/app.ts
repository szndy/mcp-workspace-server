import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Role } from './config.js';
import { AuditLog } from './audit.js';
import { authMiddleware } from './auth.js';
import { buildServer } from './server.js';
import type { AppContext } from './tool.js';

export function createApp(ctx: AppContext, audit: AuditLog): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // requests arrive through the tunnel
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const auth = authMiddleware(ctx.config);

  // Stateless: each request gets its own server instance, so a restart loses nothing.
  const handle = async (req: express.Request, res: express.Response): Promise<void> => {
    const role = res.locals['role'] as Role;
    const server = buildServer(ctx, role, audit);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  };

  const methodNotAllowed = (_req: express.Request, res: express.Response): void => {
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  };

  app.post(['/mcp', '/mcp/:token'], auth, handle);
  app.all(['/mcp', '/mcp/:token'], auth, methodNotAllowed);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  return app;
}
