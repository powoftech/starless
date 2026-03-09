import { describe, expect, it, mock } from "bun:test"

import type { StarredRepo, UnstarResult } from "./types.ts"

import { fmt, runConcurrent, sleep } from "./utils.ts"

function makeRepo(fullName = "owner/repo"): StarredRepo {
  return {
    fullName,
    language: "TypeScript",
    name: fullName.split("/")[1] ?? "repo",
    owner: fullName.split("/")[0] ?? "owner",
    stargazersCount: 0,
  }
}

function noop(): void {
  // intentionally empty
}

describe("fmt", () => {
  it("wraps text with the given color code and a reset sequence", () => {
    expect(fmt("\x1b[31m", "hello")).toBe("\x1b[31mhello\x1b[0m")
  })

  it("works with empty text", () => {
    expect(fmt("\x1b[32m", "")).toBe("\x1b[32m\x1b[0m")
  })

  it("always appends the ANSI reset code", () => {
    const result = fmt("\x1b[1m", "bold text")
    expect(result.endsWith("\x1b[0m")).toBe(true)
  })
})

describe("sleep", () => {
  it("resolves after the given number of milliseconds", async () => {
    const start = Date.now()
    await sleep(50)
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)
  })

  it("resolves without throwing for 0ms", async () => {
    await sleep(0)
  })
})

describe("runConcurrent", () => {
  it("returns an empty array for empty input", async () => {
    const worker = mock((_repo: StarredRepo) => Promise.resolve({ repo: _repo, success: true }))
    const results = await runConcurrent([], 5, 0, worker, noop)
    expect(results).toHaveLength(0)
    expect(worker).not.toHaveBeenCalled()
  })

  it("processes all repos and returns a result for each", async () => {
    const repos = [makeRepo("a/one"), makeRepo("b/two"), makeRepo("c/three")]
    const worker = mock((repo: StarredRepo): Promise<UnstarResult> => Promise.resolve({ repo, success: true }))

    const results = await runConcurrent(repos, 1, 0, worker, noop)
    expect(results).toHaveLength(3)
    expect(worker).toHaveBeenCalledTimes(3)
  })

  it("preserves result order matching input order", async () => {
    const repos = [makeRepo("a/one"), makeRepo("b/two"), makeRepo("c/three")]

    const results = await runConcurrent(
      repos,
      3,
      0,
      (repo): Promise<UnstarResult> => Promise.resolve({ repo, success: true }),
      noop,
    )

    expect(results[0]?.repo.fullName).toBe("a/one")
    expect(results[1]?.repo.fullName).toBe("b/two")
    expect(results[2]?.repo.fullName).toBe("c/three")
  })

  it("calls onDone once per completed repo with an incrementing count", async () => {
    const repos = [makeRepo("a/one"), makeRepo("b/two"), makeRepo("c/three")]
    const counts: number[] = []

    await runConcurrent(
      repos,
      1,
      0,
      (repo): Promise<UnstarResult> => Promise.resolve({ repo, success: true }),
      (n) => counts.push(n),
    )

    expect(counts).toEqual([1, 2, 3])
  })

  it("caps concurrency at the number of repos", async () => {
    const repos = [makeRepo("a/one"), makeRepo("b/two")]
    const concurrentlyRunning = { current: 0, max: 0 }

    await runConcurrent(
      repos,
      10,
      0,
      async (repo): Promise<UnstarResult> => {
        concurrentlyRunning.current++
        concurrentlyRunning.max = Math.max(concurrentlyRunning.max, concurrentlyRunning.current)
        await sleep(10)
        concurrentlyRunning.current--
        return { repo, success: true }
      },
      noop,
    )

    expect(concurrentlyRunning.max).toBeLessThanOrEqual(2)
  })

  it("surfaces worker errors as failure results without throwing", async () => {
    const repos = [makeRepo("a/failing")]

    const results = await runConcurrent(
      repos,
      1,
      0,
      (repo): Promise<UnstarResult> => Promise.resolve({ error: "API error", repo, success: false }),
      noop,
    )

    expect(results[0]?.success).toBe(false)
    expect(results[0]?.error).toBe("API error")
  })

  it("handles a mix of successful and failed results", async () => {
    const repos = [makeRepo("a/ok"), makeRepo("b/fail"), makeRepo("c/ok")]

    const results = await runConcurrent(
      repos,
      2,
      0,
      (repo): Promise<UnstarResult> =>
        Promise.resolve({
          error: repo.fullName.includes("fail") ? "failed" : undefined,
          repo,
          success: !repo.fullName.includes("fail"),
        }),
      noop,
    )

    expect(results[0]?.success).toBe(true)
    expect(results[1]?.success).toBe(false)
    expect(results[2]?.success).toBe(true)
  })
})
