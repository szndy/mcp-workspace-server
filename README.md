# mcp-workspace-server

An MCP (Model Context Protocol) server that runs on my own PC and lets an MCP client such as Claude work with:

- a **sandboxed workspace folder** (list, read, search, write, edit, delete files),
- my **local git projects** (recent commits, working-tree status, worktrees) plus **GitHub pull requests and issues**,
- my **class masterlist** in Excel (look up, count, add, remove students),
- **handoff files** (`PROJECT_STATE`, `PLAN_LOG`, `CHECKPOINTS`, `DECISIONS`) so a new chat session can pick up where the last one stopped.

It speaks Streamable HTTP, is exposed through an ngrok tunnel and is kept running by pm2.

## Tools

| Group | Tool | Access | What it does |
| --- | --- | --- | --- |
| Project | `project_summary` | read | One-call status: checkouts, commits, pushed work, open PRs/issues, saved state |
| Git | `list_repos` | read | Projects found in the workspace, grouped by worktree |
| Git | `git_log` | read | Recent commits (current branch, all, or what is on origin) |
| Git | `git_status` | read | Branch, uncommitted work, unpushed/unpulled per worktree |
| GitHub | `list_pull_requests` | read | PRs from GitHub (needs token) |
| GitHub | `list_issues` | read | Issues from GitHub (needs token) |
| Files | `list_files` | read | Folder listing, depth 1-3 |
| Files | `read_file` | read | Chunked read, returns a version for safe edits |
| Files | `search_files` | read | Find lines across text files |
| Files | `write_file` | write | Create or replace a file (`if_version` supported) |
| Files | `str_replace` | write | Replace exactly one occurrence (`if_version` supported) |
| Files | `delete_file` | destructive | Moves a file to `.trash`, needs `confirm: true` |
| Handoff | `handoff_init` | write | Create the handoff files for a project |
| Handoff | `handoff_read` | read | Load state, latest plan entries, decisions and checkpoint at once |
| Handoff | `handoff_log` | write | Add a numbered plan, decision or checkpoint entry |
| Masterlist | `masterlist_count` | read | Number of students |
| Masterlist | `masterlist_get` | read | Student at a list number |
| Masterlist | `masterlist_search` | read | Find by name or TUPM ID |
| Masterlist | `masterlist_list` | read | List a range (max 50) |
| Masterlist | `masterlist_add` | write | Add a student (backup first) |
| Masterlist | `masterlist_remove` | destructive | Remove by number + matching ID, needs `confirm: true` |

Masterlist tools only appear when `MASTERLIST_PATH` is set.

## Requirements

- Node.js 20 or newer
- git 2.31 or newer on the PATH
- An [ngrok](https://ngrok.com) account (free) and the ngrok agent for the public URL, for example `winget install ngrok.ngrok` on Windows
- pm2 (`npm install -g pm2`) to keep it running

## Setup

```bash
git clone <this repository>
cd mcp-workspace-server
npm install
cp .env.example .env        # on Windows: copy .env.example .env
npm run token               # run twice: one for ADMIN_TOKEN, one for READER_TOKEN
```

Edit `.env`. The important values:

| Variable | Meaning |
| --- | --- |
| `WORKSPACE_ROOT` | Folder the file and git tools may touch. Nothing outside it is reachable. |
| `MASTERLIST_PATH` | The one `.xlsx` file the masterlist tools may open (optional). |
| `ADMIN_TOKEN` | Full access. Required, at least 24 characters. |
| `READER_TOKEN` | Read-only access (optional). |
| `GITHUB_TOKEN` | Fine-grained token with read access to Contents, Issues, Pull requests (optional). |

Put Windows paths in **single quotes**, for example `WORKSPACE_ROOT='D:\.acads\[1] PROJECTS'`. Without quotes a `#` in a folder name is treated as a comment.

To try the masterlist without real data, point `MASTERLIST_PATH` at `sample-data/masterlist.sample.xlsx`.

## Run

```bash
npm run build
npm start                   # http://127.0.0.1:3000
```

Check it:

```bash
curl http://127.0.0.1:3000/health
npx @modelcontextprotocol/inspector     # connect to http://127.0.0.1:3000/mcp/<ADMIN_TOKEN>
```

### Public URL (ngrok)

```bash
ngrok config add-authtoken <your ngrok token>
ngrok http --url=<your-domain> 3000
```

A free ngrok account gets one static domain with a generated name ending in `.ngrok-free.dev`. It is shown under Domains in the ngrok dashboard. Choosing your own name needs a paid plan.

Clients connect to `https://<your-domain>/mcp/<token>`. The token can also be sent as an `Authorization: Bearer <token>` header; the path form exists for clients that only accept a URL.

### Keep it running (pm2)

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs mcp-server
```

If `NGROK_DOMAIN` is set in `.env`, pm2 also starts and restarts the tunnel. Do not also start the tunnel by hand: a domain can only have one tunnel, and a second one fails with `ERR_NGROK_334` ("endpoint is already online").

## Connect Claude

In Claude, open Settings, then Connectors, then Add custom connector.

- Admin connector: URL `https://<your-domain>/mcp/<ADMIN_TOKEN>`
- Read-only connector (optional, second connector): URL `https://<your-domain>/mcp/<READER_TOKEN>`

Leave the OAuth fields empty. Claude will say no sign-in is detected. This is expected: the token in the URL is the only protection, so keep the URL private.

The admin connector lists 21 tools when `MASTERLIST_PATH` is set. The reader connector lists 14. In the admin connector's tool permissions, set the 7 write and delete tools to "needs approval" and the 14 read-only tools to "always allow".

## Handoff files

Per project, under `<WORKSPACE_ROOT>/.handoff/<project>/`:

```
PROJECT_STATE.md      where the project stands right now
PLAN_LOG/0001-*.md    what was planned
DECISIONS/0001-*.md   what was decided and why
CHECKPOINTS/0001-*.md what the last session finished, and what is next
```

A new session starts with `handoff_read` and ends with a checkpoint written by `handoff_log`.

The demo transcripts, handoff files and a log excerpt are in `docs/evidence/`.

## Security

- Every path is resolved against `WORKSPACE_ROOT`; `..`, absolute and drive paths, `:` streams, reserved Windows names and symlinks that leave the root are rejected. `.git` and `.env*` are never readable or writable.
- Every request needs a token (constant-time comparison); after 20 failed attempts from one address within 10 minutes, that address gets 429 until the window passes. The server only listens on 127.0.0.1, so it is reachable from outside only through the tunnel.
- Two roles: the reader token only gets read-only tools.
- Destructive tools need `confirm: true`. Deleted files go to `.trash`; the masterlist is copied to `BACKUP_DIR` before each change.
- Every tool call is appended to `logs/tool-calls.jsonl`. File contents and student details are replaced by their length.
- Errors returned to the client are short messages, never stack traces.

## Tests

```bash
npm test
```

Covers path-escape protection, the file tools, the masterlist (including concurrent writes and the Excel lock), git worktree discovery, configuration, authentication and a full client-to-server run over HTTP.

## Layout

```
src/
  index.ts, app.ts, server.ts   HTTP server, MCP wiring, role-based tool registration
  auth.ts, config.ts, audit.ts  tokens, environment, call log
  sandbox.ts                    path resolution
  git/                          git runner and repository discovery
  github.ts                     GitHub REST client
  masterlist/store.ts           Excel reading and writing
  handoff.ts                    handoff file helpers
  tools/                        tool definitions, one file per group
tests/
docs/evidence/                  demo transcripts, handoff files, log excerpt
sample-data/                    fake masterlist for trying things out
```

## Troubleshooting

- **Windows paths in `.env`:** wrap the value in single quotes when the path contains spaces, brackets or `#`. Without quotes a `#` starts a comment.
- **"endpoint is already online" (`ERR_NGROK_334`):** another ngrok is running for the same domain. Stop it and let pm2 own the tunnel.
- **`npm install` fails with `EBUSY` or `EPERM` on Windows:** this is usually antivirus scanning new files. Retry with a fresh cache: `npm install --cache <new-folder>`.
