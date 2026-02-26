export interface StarredRepo {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  language: string | null;
  starredAt: string | null;
}

export interface UnstarResult {
  repo: StarredRepo;
  success: boolean;
  error?: string;
}

export interface CliOptions {
  token: string;
  dryRun: boolean;
  yes: boolean;
  delay: number;
  concurrency: number;
}
