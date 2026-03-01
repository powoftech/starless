import { Octokit } from "octokit";
import type { StarredRepo, UnstarResult } from "./types.ts";

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
    for (const repo of response.data) {
      repos.push({
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        language: typeof repo.language === "string" ? repo.language : null,
        stargazersCount: repo.stargazers_count ?? null,
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
      repo: repo.name,
    });
    return { repo, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { repo, success: false, error: message };
  }
}
