import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Role } from './config.js';
import { AuditLog, summariseArgs } from './audit.js';
import { ToolError } from './errors.js';
import { clip, type AppContext, type ToolDef } from './tool.js';
import { allTools, roleAllows } from './tools/index.js';

const INSTRUCTIONS = [
  'This server gives access to a sandboxed workspace, local git projects, GitHub pull requests/issues and a class masterlist.',
  'Start with project_summary (status) or handoff_read (saved context) for a project; call list_repos if unsure of the name.',
  'Read before you write: read_file returns a version, pass it as if_version when editing.',
  'Prefer search_files and chunked read_file over reading whole files.',
  'Destructive tools need confirm: true. Ask the user first and look the target up before removing it.',
  'At the end of a session add a checkpoint with handoff_log so the next session can continue.',
].join('\n');

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text: clip(text) }] };
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function buildServer(ctx: AppContext, role: Role, audit: AuditLog): McpServer {
  const server = new McpServer({ name: 'mcp-workspace-server', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  const register = (tool: ToolDef): void => {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.access === 'read',
          destructiveHint: tool.access === 'destructive',
          openWorldHint: tool.name === 'list_pull_requests' || tool.name === 'list_issues',
        },
      },
      async (args: Record<string, unknown>): Promise<ToolResult> => {
        const started = Date.now();
        let result: ToolResult;
        let error: string | undefined;
        try {
          result = ok(await tool.run(args, ctx));
        } catch (err) {
          if (err instanceof ToolError) {
            error = err.message;
            result = fail(err.message);
          } else {
            console.error(`[${tool.name}] unexpected error:`, err);
            error = 'unexpected error';
            result = fail('Unexpected server error. The details were written to the server log.');
          }
        }
        audit.write({
          ts: new Date().toISOString(),
          role,
          tool: tool.name,
          args: summariseArgs(args),
          ok: !error,
          ms: Date.now() - started,
          ...(error ? { error } : {}),
        });
        return result;
      },
    );
  };

  for (const tool of allTools(ctx)) {
    if (roleAllows(role, tool.access)) register(tool);
  }
  return server;
}
