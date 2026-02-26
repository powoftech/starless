# star-sweeper

A CLI tool to unstar all GitHub repositories starred by the authenticated user.

## Prerequisites

- [Bun](https://bun.sh) v1.0+
- A [GitHub personal access token](https://github.com/settings/tokens) with the `repo` or `public_repo` scope

## Installation

```bash
bun install
```

## Usage

```text
Usage: star-sweeper [options]

Options:
  -t, --token <token>   GitHub personal access token (overrides GITHUB_TOKEN env var)
  --dry-run             List starred repos without unstarring them (default: false)
  -y, --yes             Skip confirmation prompt (default: false)
  --delay <ms>          Delay in ms between each unstar request, per worker (default: 0)
  --concurrency <n>     Number of parallel unstar requests (default: 5)
  -V, --version         output the version number
  -h, --help            display help for command
```

### Authentication

Provide your GitHub token in one of two ways:

**Environment variable (recommended):**

```bash
export GITHUB_TOKEN=ghp_yourtoken
bun start
```

**Inline flag:**

```bash
bun start -- --token ghp_yourtoken
```

### Examples

Preview all starred repos without making any changes:

```bash
GITHUB_TOKEN=ghp_yourtoken bun start -- --dry-run
```

Unstar everything, skipping the confirmation prompt:

```bash
GITHUB_TOKEN=ghp_yourtoken bun start -- --yes
```

Unstar with 10 parallel requests for maximum speed:

```bash
GITHUB_TOKEN=ghp_yourtoken bun start -- --yes --concurrency 10
```

Unstar with a 200ms delay between requests per worker (useful to avoid secondary rate limits):

```bash
GITHUB_TOKEN=ghp_yourtoken bun start -- --yes --delay 200
```

## Performance

The unstar loop runs requests concurrently rather than sequentially. With the default concurrency of 5 and ~200ms average network latency, 500 starred repos complete in roughly 20 seconds instead of ~100 seconds.

| Repos | Concurrency | Estimated time |
| ----- | ----------- | -------------- |
| 500   | 1           | ~100s          |
| 500   | 5 (default) | ~20s           |
| 500   | 10          | ~10s           |

GitHub's secondary rate limit allows up to ~10 concurrent requests safely. The default of 5 is conservative; raise it with `--concurrency` if needed.
