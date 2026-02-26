#!/usr/bin/env bun
import { program } from "commander";
import { createClient, fetchAllStarred, getAuthenticatedUser, unstarRepo } from "./src/github.ts";
import type { CliOptions, StarredRepo, UnstarResult } from "./src/types.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function fmt(color: string, text: string): string {
  return `${color}${text}${RESET}`;
}

function clearLine(): void {
  process.stdout.write("\r\x1b[K");
}

function printProgress(current: number, total: number, label: string): void {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const barWidth = 30;
  const filled = Math.round((current / total) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  clearLine();
  process.stdout.write(`  ${fmt(CYAN, `[${bar}]`)} ${fmt(BOLD, `${pct}%`)}  ${current}/${total}  ${fmt(DIM, label)}`);
}

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} ${fmt(DIM, "[y/N]")} `);
  const buf = Buffer.alloc(64);
  const fd = process.stdin.fd;
  try {
    const n = require("fs").readSync(fd, buf, 0, buf.length, null);
    const answer = buf.slice(0, n).toString().trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runConcurrent(
  repos: StarredRepo[],
  concurrency: number,
  delay: number,
  worker: (repo: StarredRepo) => Promise<UnstarResult>,
  onDone: (completed: number) => void,
): Promise<UnstarResult[]> {
  const results: UnstarResult[] = new Array(repos.length);
  let nextIndex = 0;
  let completed = 0;

  async function runSlot(): Promise<void> {
    while (nextIndex < repos.length) {
      const index = nextIndex++;
      const repo = repos[index]!;
      results[index] = await worker(repo);
      completed++;
      onDone(completed);
      if (delay > 0 && nextIndex < repos.length) {
        await sleep(delay);
      }
    }
  }

  const slots = Math.min(concurrency, repos.length);
  await Promise.all(Array.from({ length: slots }, runSlot));
  return results;
}

function printTable(repos: StarredRepo[]): void {
  const maxName = Math.min(
    50,
    repos.reduce((m, r) => Math.max(m, r.fullName.length), 0),
  );
  const maxLang = repos.reduce((m, r) => Math.max(m, (r.language ?? "—").length), 8);

  const header = `  ${"Repository".padEnd(maxName)}  ${"Language".padEnd(maxLang)}  Starred At`;
  console.log(fmt(BOLD, header));
  console.log(fmt(DIM, "  " + "─".repeat(header.length - 2)));

  for (const repo of repos) {
    const name = repo.fullName.padEnd(maxName);
    const lang = (repo.language ?? "—").padEnd(maxLang);
    const date = repo.starredAt ? repo.starredAt.slice(0, 10) : "—";
    console.log(`  ${fmt(CYAN, name)}  ${fmt(YELLOW, lang)}  ${fmt(DIM, date)}`);
  }
}

program
  .name("star-sweeper")
  .description("Unstar all GitHub repositories starred by the authenticated user")
  .option("-t, --token <token>", "GitHub personal access token (overrides GITHUB_TOKEN env var)")
  .option("--dry-run", "List starred repos without unstarring them", false)
  .option("-y, --yes", "Skip confirmation prompt", false)
  .option("--delay <ms>", "Delay in ms between each unstar request (per worker)", "0")
  .option("--concurrency <n>", "Number of parallel unstar requests", "5")
  .version("1.0.0");

program.parse();

const opts = program.opts<{
  token?: string;
  dryRun: boolean;
  yes: boolean;
  delay: string;
  concurrency: string;
}>();

const options: CliOptions = {
  token: opts.token ?? process.env["GITHUB_TOKEN"] ?? "",
  dryRun: opts.dryRun,
  yes: opts.yes,
  delay: parseInt(opts.delay, 10) || 0,
  concurrency: Math.max(1, parseInt(opts.concurrency, 10) || 5),
};

async function main(): Promise<void> {
  console.log();
  console.log(fmt(BOLD, "★  Star Sweeper"));
  console.log(fmt(DIM, "   Bulk-unstar your GitHub repositories\n"));

  if (!options.token) {
    console.error(
      fmt(RED, "✖  No GitHub token found.") +
        "\n   Provide one via --token <token> or set the GITHUB_TOKEN environment variable.\n" +
        "   Create a token at: https://github.com/settings/tokens (needs 'repo' or 'public_repo' scope)\n",
    );
    process.exit(1);
  }

  const octokit = createClient(options.token);

  // Verify authentication
  process.stdout.write("  Authenticating…");
  let user: { login: string; name: string | null };
  try {
    user = await getAuthenticatedUser(octokit);
    clearLine();
    console.log(
      `  ${fmt(GREEN, "✔")} Authenticated as ${fmt(BOLD, user.login)}` + (user.name ? fmt(DIM, ` (${user.name})`) : ""),
    );
  } catch (err) {
    clearLine();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(fmt(RED, `✖  Authentication failed: ${msg}\n`));
    process.exit(1);
  }

  // Fetch all starred repos
  console.log();
  process.stdout.write("  Fetching starred repositories…");
  let repos: StarredRepo[];
  try {
    repos = await fetchAllStarred(octokit, count => {
      clearLine();
      process.stdout.write(`  Fetching starred repositories… ${fmt(CYAN, String(count))} found`);
    });
    clearLine();
    console.log(`  ${fmt(GREEN, "✔")} Found ${fmt(BOLD, String(repos.length))} starred repositories`);
  } catch (err) {
    clearLine();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(fmt(RED, `✖  Failed to fetch starred repos: ${msg}\n`));
    process.exit(1);
  }

  if (repos.length === 0) {
    console.log(fmt(DIM, "\n  Nothing to do — no starred repositories.\n"));
    process.exit(0);
  }

  // Dry-run: list and exit
  if (options.dryRun) {
    console.log(fmt(BOLD, `\n  Starred repositories (${repos.length} total):\n`));
    printTable(repos);
    console.log(fmt(DIM, `\n  Dry-run mode: no repos were unstarred.\n`));
    process.exit(0);
  }

  // Confirmation
  console.log();
  const proceed =
    options.yes ||
    (await confirm(
      `  ${fmt(YELLOW, "⚠")}  About to unstar ${fmt(BOLD, String(repos.length))} repositories for ${fmt(BOLD, user.login)}. Continue?`,
    ));

  if (!proceed) {
    console.log(fmt(DIM, "\n  Aborted. No repositories were unstarred.\n"));
    process.exit(0);
  }

  // Unstar loop
  console.log();
  if (options.concurrency > 1) {
    console.log(fmt(DIM, `  Running ${options.concurrency} requests in parallel\n`));
  }
  const startTime = Date.now();
  let succeeded = 0;
  const failures: Array<{ fullName: string; error: string }> = [];

  printProgress(0, repos.length, "starting…");

  const results = await runConcurrent(
    repos,
    options.concurrency,
    options.delay,
    repo => unstarRepo(octokit, repo),
    completed => printProgress(completed, repos.length, `${completed}/${repos.length} done`),
  );

  for (const result of results) {
    if (result.success) {
      succeeded++;
    } else {
      failures.push({
        fullName: result.repo.fullName,
        error: result.error ?? "unknown error",
      });
    }
  }

  printProgress(repos.length, repos.length, "Done");
  console.log("\n");

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `  ${fmt(GREEN, "✔")} Unstarred ${fmt(BOLD, String(succeeded))} of ${repos.length} repositories in ${elapsed}s`,
  );

  if (failures.length > 0) {
    console.log(fmt(RED, `\n  ✖  ${failures.length} failure(s):`));
    for (const f of failures) {
      console.log(`     ${fmt(BOLD, f.fullName)}: ${fmt(DIM, f.error)}`);
    }
  }

  console.log();
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(fmt(RED, `\n  ✖  Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(1);
});
