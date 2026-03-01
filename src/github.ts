import { Octokit } from "octokit";
import type { StarredRepo, UnstarResult } from "./types.ts";

type RepoObject = {
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  language: string | null;
};

type StarItem = RepoObject | { starred_at: string; repo: RepoObject };

function extractRepo(item: StarItem): { repo: RepoObject; starredAt: string | null } {
  if ("repo" in item) {
    return { repo: item.repo, starredAt: item.starred_at };
  }
  return { repo: item, starredAt: null };
}

export function createClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

export async function getAuthenticatedUser(octokit: Octokit): Promise<{ login: string; name: string | null }> {
  const { data } = await octokit.rest.users.getAuthenticated();
  return { login: data.login, name: data.name ?? null };
}

export async function fetchAllStarred(octokit: Octokit, onPage?: (fetched: number) => void): Promise<StarredRepo[]> {
  const repos: StarredRepo[] = [];

  for await (const response of octokit.paginate.iterator(octokit.rest.activity.listReposStarredByAuthenticatedUser, {
    per_page: 100,
  })) {
    for (const item of response.data as StarItem[]) {
      const { repo, starredAt } = extractRepo(item);
      repos.push({
        owner: repo.owner.login,
        repo: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        language: typeof repo.language === "string" ? repo.language : null,
        starredAt,
      });
    }

    onPage?.(repos.length);
  }

  return repos;
}

export async function unstarRepo(octokit: Octokit, repo: StarredRepo): Promise<UnstarResult> {
  try {
    await octokit.rest.activity.unstarRepoForAuthenticatedUser({
      owner: repo.owner,
      repo: repo.repo,
    });
    return { repo, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { repo, success: false, error: message };
  }
}
