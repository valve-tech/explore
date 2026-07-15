export interface BuildInfo {
  sha: string;
  shortSha: string;
  commitISO: string | null;
  branch: string;
  builtAtISO: string;
}

export interface ResolveBuildInfoOptions {
  env?: Record<string, string | undefined>;
  now?: () => string;
  runGit?: (args: string) => string | null;
}

export function runGit(args: string): string | null;
export function resolveBuildInfo(options?: ResolveBuildInfoOptions): BuildInfo;
