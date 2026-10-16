import { ToolError } from './errors.js';

export interface PullSummary {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  author: string;
  head: string;
  base: string;
  updated: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  author: string;
  labels: string[];
  comments: number;
  updated: string;
}

type State = 'open' | 'closed' | 'all';

export class GitHubClient {
  constructor(private readonly token?: string) {}

  get enabled(): boolean {
    return Boolean(this.token);
  }

  private async get(url: string): Promise<any[]> {
    if (!this.token) {
      throw new ToolError(
        'GITHUB_TOKEN is not set, so pull requests and issues are unavailable. Local git tools still work.',
      );
    }
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'mcp-workspace-server',
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ToolError('Could not reach GitHub (network error or timeout).');
    }
    if (res.status === 401) throw new ToolError('GitHub rejected the token. It may be expired or mistyped.');
    if (res.status === 403) throw new ToolError('GitHub refused the request (rate limit, or the token lacks permission).');
    if (res.status === 404) {
      throw new ToolError(
        'GitHub says the repository was not found. For a private repo, the token must be granted access to it with read permission for Issues and Pull requests.',
      );
    }
    if (!res.ok) throw new ToolError(`GitHub returned an error (HTTP ${res.status}).`);
    return (await res.json()) as any[];
  }

  async pulls(owner: string, repo: string, state: State, limit: number): Promise<PullSummary[]> {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=${limit}`;
    const rows = await this.get(url);
    return rows.map((p) => ({
      number: p.number,
      title: String(p.title),
      state: p.merged_at ? 'merged' : String(p.state),
      draft: Boolean(p.draft),
      author: String(p.user?.login ?? 'unknown'),
      head: String(p.head?.ref ?? ''),
      base: String(p.base?.ref ?? ''),
      updated: String(p.updated_at ?? '').slice(0, 10),
    }));
  }

  async issues(owner: string, repo: string, state: State, limit: number): Promise<IssueSummary[]> {
    // The issues endpoint also returns pull requests, so ask for extra and filter them out.
    const perPage = Math.min(100, limit * 3);
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&sort=updated&direction=desc&per_page=${perPage}`;
    const rows = await this.get(url);
    return rows
      .filter((i) => !i.pull_request)
      .slice(0, limit)
      .map((i) => ({
        number: i.number,
        title: String(i.title),
        state: String(i.state),
        author: String(i.user?.login ?? 'unknown'),
        labels: (i.labels ?? []).map((l: any) => String(typeof l === 'string' ? l : l.name)),
        comments: Number(i.comments ?? 0),
        updated: String(i.updated_at ?? '').slice(0, 10),
      }));
  }
}

export function formatPull(p: PullSummary): string {
  return `#${p.number} [${p.draft ? 'draft' : p.state}] ${p.title} - ${p.author}, ${p.head} -> ${p.base}, updated ${p.updated}`;
}

export function formatIssue(i: IssueSummary): string {
  const labels = i.labels.length ? ` {${i.labels.join(', ')}}` : '';
  return `#${i.number} [${i.state}] ${i.title}${labels} - ${i.author}, ${i.comments} comments, updated ${i.updated}`;
}
