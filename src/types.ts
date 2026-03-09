export interface CliOptions {
  concurrency: number
  delay: number
  dryRun: boolean
  token: string
  yes: boolean
}

export interface StarredRepo {
  fullName: string
  language: null | string
  name: string
  owner: string
  stargazersCount: null | number
}

export interface UnstarResult {
  error?: string
  repo: StarredRepo
  success: boolean
}
