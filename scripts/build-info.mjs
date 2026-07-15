/**
 * Build identity — the single source of truth for "what commit is this?".
 *
 * Resolution order (never throws): BUILD_SHA env override → git → "unknown".
 * The env override exists so a deploy without a .git dir can still stamp a
 * real SHA. `builtAtISO` is informational only — the drift check compares
 * `sha`, so a rebuild-without-change never registers as drift.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNKNOWN = "unknown";

/** Run a git command in the repo root. Returns trimmed stdout, or null on any failure. */
export function runGit(args) {
  try {
    const out = execSync(`git ${args}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function resolveBuildInfo({
  env = process.env,
  now = () => new Date().toISOString(),
  runGit: git = runGit,
} = {}) {
  const builtAtISO = now();

  const call = (args) => {
    try {
      return git(args);
    } catch {
      return null;
    }
  };

  if (env.BUILD_SHA) {
    const sha = env.BUILD_SHA;
    return {
      sha,
      shortSha: sha.slice(0, 7),
      commitISO: env.BUILD_COMMIT_ISO ?? null,
      branch: env.BUILD_BRANCH ?? UNKNOWN,
      builtAtISO,
    };
  }

  const sha = call("rev-parse HEAD");
  if (sha) {
    return {
      sha,
      shortSha: sha.slice(0, 7),
      commitISO: call("show -s --format=%cI HEAD"),
      branch: call("rev-parse --abbrev-ref HEAD") ?? UNKNOWN,
      builtAtISO,
    };
  }

  return { sha: UNKNOWN, shortSha: UNKNOWN, commitISO: null, branch: UNKNOWN, builtAtISO };
}
