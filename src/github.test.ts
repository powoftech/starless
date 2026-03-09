import type { Octokit } from "octokit"

import { describe, expect, it, mock } from "bun:test"

import type { StarredRepo } from "./types.ts"

import { createClient, fetchAllStarred, getAuthenticatedUser, unstarRepo } from "./github.ts"

interface RawRepo {
  full_name: string
  language: null | string
  name: string
  owner: { login: string }
  stargazers_count: number
}

function makePageIterator(pages: { data: RawRepo[] }[]) {
  return () =>
    (function* () {
      for (const page of pages) {
        yield page
      }
    })()
}

function makeRawRepo(overrides: Partial<RawRepo> = {}): RawRepo {
  return {
    full_name: "owner/repo",
    language: "TypeScript",
    name: "repo",
    owner: { login: "owner" },
    stargazers_count: 42,
    ...overrides,
  }
}

function makeRepo(overrides: Partial<StarredRepo> = {}): StarredRepo {
  return {
    fullName: "owner/repo",
    language: "TypeScript",
    name: "repo",
    owner: "owner",
    stargazersCount: 42,
    ...overrides,
  }
}

describe("createClient", () => {
  it("returns an object with octokit rest API", () => {
    const client = createClient("test-token")
    expect(client).toBeDefined()
    expect(typeof client.rest).toBe("object")
  })
})

describe("getAuthenticatedUser", () => {
  it("returns login and name", async () => {
    const mockOctokit = {
      rest: {
        users: {
          getAuthenticated: mock(() => Promise.resolve({ data: { login: "johndoe", name: "John Doe" } })),
        },
      },
    } as unknown as Octokit

    const user = await getAuthenticatedUser(mockOctokit)
    expect(user.login).toBe("johndoe")
    expect(user.name).toBe("John Doe")
  })

  it("returns null for missing name", async () => {
    const mockOctokit = {
      rest: {
        users: {
          getAuthenticated: mock(() => Promise.resolve({ data: { login: "johndoe", name: undefined } })),
        },
      },
    } as unknown as Octokit

    const user = await getAuthenticatedUser(mockOctokit)
    expect(user.name).toBeNull()
  })

  it("propagates errors from the API", async () => {
    const mockOctokit = {
      rest: {
        users: {
          getAuthenticated: mock(() => Promise.reject(new Error("Unauthorized"))),
        },
      },
    } as unknown as Octokit

    let caughtError: unknown
    try {
      await getAuthenticatedUser(mockOctokit)
    } catch (error) {
      caughtError = error
    }
    expect(caughtError).toBeInstanceOf(Error)
    expect((caughtError as Error).message).toBe("Unauthorized")
  })
})

describe("fetchAllStarred", () => {
  it("returns empty array when there are no starred repositories", async () => {
    const mockOctokit = {
      paginate: { iterator: makePageIterator([]) },
      rest: { activity: { listReposStarredByAuthenticatedUser: {} } },
    } as unknown as Octokit

    const repos = await fetchAllStarred(mockOctokit)
    expect(repos).toEqual([])
  })

  it("maps a single page of repositories to StarredRepo objects", async () => {
    const pages = [
      {
        data: [
          makeRawRepo({
            full_name: "alice/foo",
            language: "TypeScript",
            name: "foo",
            owner: { login: "alice" },
            stargazers_count: 10,
          }),
          makeRawRepo({
            full_name: "bob/bar",
            language: null,
            name: "bar",
            owner: { login: "bob" },
            stargazers_count: 5,
          }),
        ],
      },
    ]
    const mockOctokit = {
      paginate: { iterator: makePageIterator(pages) },
      rest: { activity: { listReposStarredByAuthenticatedUser: {} } },
    } as unknown as Octokit

    const repos = await fetchAllStarred(mockOctokit)
    expect(repos).toHaveLength(2)
    expect(repos[0]).toEqual({
      fullName: "alice/foo",
      language: "TypeScript",
      name: "foo",
      owner: "alice",
      stargazersCount: 10,
    })
    expect(repos[1]).toEqual({ fullName: "bob/bar", language: null, name: "bar", owner: "bob", stargazersCount: 5 })
  })

  it("accumulates repositories across multiple pages", async () => {
    const pages = [
      { data: [makeRawRepo({ full_name: "a/one", name: "one", owner: { login: "a" } })] },
      { data: [makeRawRepo({ full_name: "b/two", name: "two", owner: { login: "b" } })] },
      { data: [makeRawRepo({ full_name: "c/three", name: "three", owner: { login: "c" } })] },
    ]
    const mockOctokit = {
      paginate: { iterator: makePageIterator(pages) },
      rest: { activity: { listReposStarredByAuthenticatedUser: {} } },
    } as unknown as Octokit

    const repos = await fetchAllStarred(mockOctokit)
    expect(repos).toHaveLength(3)
    expect(repos.map((r) => r.fullName)).toEqual(["a/one", "b/two", "c/three"])
  })

  it("calls onPage with accumulated count per page", async () => {
    const pages = [{ data: [makeRawRepo(), makeRawRepo()] }, { data: [makeRawRepo()] }]
    const mockOctokit = {
      paginate: { iterator: makePageIterator(pages) },
      rest: { activity: { listReposStarredByAuthenticatedUser: {} } },
    } as unknown as Octokit

    const pageCounts: number[] = []
    await fetchAllStarred(mockOctokit, (count) => pageCounts.push(count))
    expect(pageCounts).toEqual([2, 3])
  })

  it("converts non-string language values to null", async () => {
    const pages = [{ data: [makeRawRepo({ language: null })] }]
    const mockOctokit = {
      paginate: { iterator: makePageIterator(pages) },
      rest: { activity: { listReposStarredByAuthenticatedUser: {} } },
    } as unknown as Octokit

    const repos = await fetchAllStarred(mockOctokit)
    expect(repos[0]?.language).toBeNull()
  })
})

describe("unstarRepo", () => {
  it("returns success result on successful API call", async () => {
    const repo = makeRepo()
    const mockOctokit = {
      rest: {
        activity: {
          unstarRepoForAuthenticatedUser: mock(() => Promise.resolve()),
        },
      },
    } as unknown as Octokit

    const result = await unstarRepo(mockOctokit, repo)
    expect(result.success).toBe(true)
    expect(result.repo).toBe(repo)
    expect(result.error).toBeUndefined()
  })

  it("passes owner and repo name to the API", async () => {
    const repo = makeRepo({ name: "my-repo", owner: "my-org" })
    const unstarMock = mock(() => Promise.resolve())
    const mockOctokit = {
      rest: { activity: { unstarRepoForAuthenticatedUser: unstarMock } },
    } as unknown as Octokit

    await unstarRepo(mockOctokit, repo)
    expect(unstarMock).toHaveBeenCalledWith({ owner: "my-org", repo: "my-repo" })
  })

  it("returns failure result when the API throws", async () => {
    const repo = makeRepo()
    const mockOctokit = {
      rest: {
        activity: {
          unstarRepoForAuthenticatedUser: mock(() => Promise.reject(new Error("Not Found"))),
        },
      },
    } as unknown as Octokit

    const result = await unstarRepo(mockOctokit, repo)
    expect(result.success).toBe(false)
    expect(result.error).toBe("Not Found")
    expect(result.repo).toBe(repo)
  })
})
