#!/usr/bin/env node
/**
 * Infra audit — probes every endpoint in infra/endpoints.json and diffs the
 * deployed build SHA against origin/main.
 *
 * Usage:
 *   node scripts/check-infra.mjs [--expected <sha>]
 *
 * Exit 0 when every endpoint meets its expectation and no SHA has drifted;
 * exit 1 otherwise (so a scheduled runner can alert on it).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(REPO_ROOT, "infra", "endpoints.json");
const TIMEOUT_MS = 12_000;

/** Decide whether a probe result satisfies an entry's `expect`. Pure. */
export function matchesExpectation(entry, probe) {
  const { expect } = entry;

  if (expect === "not-live") {
    return probe.error
      ? { ok: true, detail: "not live (expected)" }
      : { ok: false, detail: `now answering with ${probe.status} — update the manifest` };
  }

  if (probe.error) return { ok: false, detail: probe.error };

  if (typeof expect === "number") {
    return probe.status === expect
      ? { ok: true, detail: String(probe.status) }
      : { ok: false, detail: `got ${probe.status}, want ${expect}` };
  }

  if (expect === "grpc") {
    return probe.status === 200 || probe.status === 415
      ? { ok: true, detail: `grpc alive (${probe.status})` }
      : { ok: false, detail: `got ${probe.status}, want 200/415` };
  }

  if (expect === "auth-gated") {
    let parsed;
    try {
      parsed = JSON.parse(probe.body);
    } catch {
      return { ok: false, detail: "non-JSON body — expected an auth error" };
    }
    return parsed?.error
      ? { ok: true, detail: `auth-gated (${parsed.error.message})` }
      : { ok: false, detail: "no auth error in body" };
  }

  return { ok: false, detail: `unknown expect: ${String(expect)}` };
}

async function probe(entry) {
  try {
    const res = await fetch(entry.url, {
      method: entry.method,
      headers: entry.body ? { "content-type": "application/json" } : undefined,
      body: entry.body ? JSON.stringify(entry.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    return { error: err.cause?.code ?? err.message };
  }
}

function expectedSha(argv) {
  const flag = argv.indexOf("--expected");
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  try {
    const out = execSync("git ls-remote origin refs/heads/main", {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

async function main() {
  const { endpoints } = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const want = expectedSha(process.argv);
  let failures = 0;

  console.log(`\nInfra audit — ${endpoints.length} endpoints`);
  console.log(`Expected sha (origin/main): ${want ?? "unknown"}\n`);

  const results = await Promise.all(
    endpoints.map(async (entry) => ({ entry, verdict: matchesExpectation(entry, await probe(entry)) })),
  );

  for (const { entry, verdict } of results) {
    if (!verdict.ok) failures++;
    console.log(`${verdict.ok ? "PASS" : "FAIL"}  ${entry.name.padEnd(32)} ${verdict.detail}`);
  }

  // Deploy drift — only the endpoints that serve /health can answer this.
  const health = endpoints.filter((e) => e.url.endsWith("/health"));
  for (const entry of health) {
    const res = await probe(entry);
    let served = null;
    try {
      served = JSON.parse(res.body)?.version?.sha ?? null;
    } catch { /* falls through to the unknown branch below */ }

    if (!served || served === "unknown") {
      failures++;
      console.log(`\nFAIL  deploy drift: ${entry.name} reports no build sha`);
    } else if (want && served !== want) {
      failures++;
      console.log(`\nFAIL  deploy drift: ${entry.name} serves ${served.slice(0, 7)}, origin/main is ${want.slice(0, 7)}`);
    } else {
      console.log(`\nPASS  deploy in sync: ${served.slice(0, 7)}`);
    }
  }

  console.log(failures ? `\n${failures} problem(s).\n` : "\nAll good.\n");
  process.exit(failures ? 1 : 0);
}

// Only run the CLI when invoked directly — importing for tests must not probe.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
