import { describe, expect, it } from "bun:test"
import { resolve } from "path"

const rootDir = resolve(import.meta.dir, "..")
const entryPoint = resolve(rootDir, "index.ts")

async function runCLI(args: string[], envOverrides: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", entryPoint, ...args], {
    cwd: rootDir,
    env: { ...process.env, ...envOverrides },
    stderr: "pipe",
    stdout: "pipe",
  })

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited
  return { exitCode, stderr, stdout }
}

describe("CLI", () => {
  describe("--help", () => {
    it("exits with code 0", async () => {
      const { exitCode } = await runCLI(["--help"])
      expect(exitCode).toBe(0)
    })

    it("prints the program name", async () => {
      const { stdout } = await runCLI(["--help"])
      expect(stdout).toContain("starless")
    })

    it("lists available options", async () => {
      const { stdout } = await runCLI(["--help"])
      expect(stdout).toContain("--dry-run")
      expect(stdout).toContain("--token")
      expect(stdout).toContain("--concurrency")
      expect(stdout).toContain("--delay")
    })
  })

  describe("--version", () => {
    it("exits with code 0", async () => {
      const { exitCode } = await runCLI(["--version"])
      expect(exitCode).toBe(0)
    })

    it("prints the version from package.json", async () => {
      const pkg = (await import("../package.json")) as { version: string }
      const { stdout } = await runCLI(["--version"])
      expect(stdout.trim()).toBe(pkg.version)
    })
  })

  describe("missing token", () => {
    it("exits with code 1", async () => {
      const { exitCode } = await runCLI(["--token", ""], { GITHUB_TOKEN: "" })
      expect(exitCode).toBe(1)
    })

    it("prints an error message to stderr", async () => {
      const { stderr } = await runCLI(["--token", ""], { GITHUB_TOKEN: "" })
      expect(stderr).toContain("No GitHub token found")
    })
  })
})
