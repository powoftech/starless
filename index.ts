#!/usr/bin/env bun

import { program } from "commander"
import { readSync } from "fs"

import type { CliOptions, StarredRepo } from "./src/types.ts"

import pkg from "./package.json"
import { createClient, fetchAllStarred, getAuthenticatedUser, unstarRepo } from "./src/github.ts"
import { fmt, runConcurrent } from "./src/utils.ts"

const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const CYAN = "\x1b[36m"

function clearLine(): void {
  process.stdout.write("\r\x1b[K")
}

function confirm(question: string): boolean {
  if (!process.stdin.isTTY) {
    console.log(fmt(DIM, "\n  (Non-interactive mode detected, aborting)"))
    return false
  }

  process.stdout.write(`${question} ${fmt(DIM, "[y/N]")} `)
  const buf = Buffer.alloc(64)
  const fd = process.stdin.fd
  try {
    const n = readSync(fd, buf, 0, buf.length, null)
    const answer = String(buf.subarray(0, n)).trim().toLowerCase()
    return answer === "y" || answer === "yes"
  } catch {
    return false
  }
}

function printProgress(current: number, total: number, label: string): void {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  const barWidth = 30
  const filled = Math.round((current / total) * barWidth)
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled)
  clearLine()
  process.stdout.write(
    `  ${fmt(CYAN, `[${bar}]`)} ${fmt(BOLD, `${String(pct)}%`)}  ${String(current)}/${String(total)}  ${fmt(DIM, label)}`,
  )
}

function printTable(repos: StarredRepo[]): void {
  let maxName = 0
  let maxLang = 8
  for (const r of repos) {
    if (r.fullName.length > maxName) maxName = r.fullName.length
    const langLen = (r.language ?? "—").length
    if (langLen > maxLang) maxLang = langLen
  }
  maxName = Math.min(50, maxName)

  const header = `  ${"Repository".padEnd(maxName)}  ${"Language".padEnd(maxLang)}  Stargazers`
  console.log(fmt(BOLD, header))
  console.log(fmt(DIM, "  " + "─".repeat(header.length - 2)))

  for (const repo of repos) {
    const name = repo.fullName.padEnd(maxName)
    const lang = (repo.language ?? "—").padEnd(maxLang)
    const stargazers = repo.stargazersCount !== null ? repo.stargazersCount.toLocaleString() : "—"
    console.log(`  ${fmt(CYAN, name)}  ${fmt(YELLOW, lang)}  ${fmt(DIM, stargazers)}`)
  }
}

program
  .name("starless")
  .description("Unstar all GitHub repositories starred by the authenticated user")
  .option("-t, --token <token>", "GitHub personal access token (overrides GITHUB_TOKEN env var)")
  .option("--dry-run", "List starred repos without unstarring them", false)
  .option("-y, --yes", "Skip confirmation prompt", false)
  .option("--delay <ms>", "Delay in ms between each unstar request (per worker)", "0")
  .option("--concurrency <n>", "Number of parallel unstar requests", "5")
  .version(pkg.version)

program.parse()

const opts = program.opts<{
  concurrency: string
  delay: string
  dryRun: boolean
  token?: string
  yes: boolean
}>()

const options: CliOptions = {
  concurrency: Math.max(1, parseInt(opts.concurrency, 10) || 5),
  delay: parseInt(opts.delay, 10) || 0,
  dryRun: opts.dryRun,
  token: opts.token ?? process.env.GITHUB_TOKEN ?? "",
  yes: opts.yes,
}

async function main(): Promise<void> {
  console.log()
  console.log(fmt(BOLD, "★  Starless"))
  console.log(fmt(DIM, "   Bulk-unstar your GitHub repositories\n"))

  if (opts.token) {
    console.log(`${fmt(YELLOW, "⚠")}  Warning: Token provided via --token flag is visible in shell history.`)
    console.log(fmt(DIM, "   Consider using GITHUB_TOKEN environment variable for better security.\n"))
  }

  if (!options.token) {
    console.error(
      fmt(RED, "✖  No GitHub token found.") +
        "\n   Provide one via --token <token> or set the GITHUB_TOKEN environment variable.\n" +
        "   Create a token at: https://github.com/settings/tokens (needs 'repo' or 'public_repo' scope)\n",
    )
    process.exit(1)
  }

  const octokit = createClient(options.token)

  // Verify authentication
  process.stdout.write("  Authenticating…")
  let user: { login: string; name: null | string }
  try {
    user = await getAuthenticatedUser(octokit)
    clearLine()
    console.log(
      `  ${fmt(GREEN, "✔")} Authenticated as ${fmt(BOLD, user.login)}` + (user.name ? fmt(DIM, ` (${user.name})`) : ""),
    )
  } catch (err) {
    clearLine()
    const msg = err instanceof Error ? err.message : String(err)
    console.error(fmt(RED, `✖  Authentication failed: ${msg}\n`))
    process.exit(1)
  }

  // Fetch all starred repos
  console.log()
  process.stdout.write("  Fetching starred repositories…")
  let repos: StarredRepo[]
  try {
    repos = await fetchAllStarred(octokit, (count) => {
      clearLine()
      process.stdout.write(`  Fetching starred repositories… ${fmt(CYAN, String(count))} found`)
    })
    clearLine()
    console.log(`  ${fmt(GREEN, "✔")} Found ${fmt(BOLD, String(repos.length))} starred repositories`)
  } catch (err) {
    clearLine()
    const msg = err instanceof Error ? err.message : String(err)
    console.error(fmt(RED, `✖  Failed to fetch starred repos: ${msg}\n`))
    process.exit(1)
  }

  if (repos.length === 0) {
    console.log(fmt(DIM, "\n  Nothing to do — no starred repositories.\n"))
    process.exit(0)
  }

  // Dry-run: list and exit
  if (options.dryRun) {
    console.log(fmt(BOLD, `\n  Starred repositories (${String(repos.length)} total):\n`))
    printTable(repos)
    console.log(fmt(DIM, `\n  Dry-run mode: no repos were unstarred.\n`))
    process.exit(0)
  }

  // Confirmation
  console.log()
  const proceed =
    options.yes ||
    confirm(
      `  ${fmt(YELLOW, "⚠")}  About to unstar ${fmt(BOLD, String(repos.length))} repositories for ${fmt(BOLD, user.login)}. Continue?`,
    )

  if (!proceed) {
    console.log(fmt(DIM, "\n  Aborted. No repositories were unstarred.\n"))
    process.exit(0)
  }

  // Unstar loop
  console.log()
  if (options.concurrency > 1) {
    console.log(fmt(DIM, `  Running ${String(options.concurrency)} requests in parallel\n`))
  }
  const startTime = Date.now()
  let succeeded = 0
  const failures: { error: string; fullName: string }[] = []

  printProgress(0, repos.length, "starting…")

  const results = await runConcurrent(
    repos,
    options.concurrency,
    options.delay,
    (repo) => unstarRepo(octokit, repo),
    (completed) => {
      printProgress(completed, repos.length, `${String(completed)}/${String(repos.length)} done`)
    },
  )

  for (const result of results) {
    if (result.success) {
      succeeded++
    } else {
      failures.push({
        error: result.error ?? "unknown error",
        fullName: result.repo.fullName,
      })
    }
  }

  printProgress(repos.length, repos.length, "Done")
  console.log("\n")

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(
    `  ${fmt(GREEN, "✔")} Unstarred ${fmt(BOLD, String(succeeded))} of ${String(repos.length)} repositories in ${elapsed}s`,
  )

  if (failures.length > 0) {
    console.log(fmt(RED, `\n  ✖  ${String(failures.length)} failure(s):`))
    for (const f of failures) {
      console.log(`     ${fmt(BOLD, f.fullName)}: ${fmt(DIM, f.error)}`)
    }
  }

  console.log()
  process.exit(failures.length > 0 ? 1 : 0)
}

main().catch((err: unknown) => {
  console.error(fmt(RED, `\n  ✖  Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`))
  process.exit(1)
})
