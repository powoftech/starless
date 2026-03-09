import type { StarredRepo, UnstarResult } from "./types.ts"

const RESET = "\x1b[0m"

export function fmt(color: string, text: string): string {
  return `${color}${text}${RESET}`
}

export async function runConcurrent(
  repos: StarredRepo[],
  concurrency: number,
  delay: number,
  worker: (repo: StarredRepo) => Promise<UnstarResult>,
  onDone: (completed: number) => void,
): Promise<UnstarResult[]> {
  const results: UnstarResult[] = new Array<UnstarResult>(repos.length)
  let nextIndex = 0
  let completed = 0

  async function runSlot(): Promise<void> {
    while (nextIndex < repos.length) {
      const index = nextIndex++
      const repo = repos[index]
      if (!repo) continue
      results[index] = await worker(repo)
      completed++
      onDone(completed)
      if (delay > 0 && nextIndex < repos.length) {
        await sleep(delay)
      }
    }
  }

  const slots = Math.min(concurrency, repos.length)
  await Promise.all(Array.from({ length: slots }, runSlot))
  return results
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
