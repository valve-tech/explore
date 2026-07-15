import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBuildInfo } from "./build-info.mjs";

const NOW = () => "2026-07-14T00:00:00.000Z";
const noGit = () => null;

test("env override wins over git", () => {
  const info = resolveBuildInfo({
    env: {
      BUILD_SHA: "abc1234def5678",
      BUILD_COMMIT_ISO: "2026-07-01T11:30:39-05:00",
      BUILD_BRANCH: "main",
    },
    now: NOW,
    runGit: () => assert.fail("git must not be called when BUILD_SHA is set"),
  });
  assert.equal(info.sha, "abc1234def5678");
  assert.equal(info.shortSha, "abc1234");
  assert.equal(info.commitISO, "2026-07-01T11:30:39-05:00");
  assert.equal(info.branch, "main");
  assert.equal(info.builtAtISO, "2026-07-14T00:00:00.000Z");
});

test("env override without optional vars degrades those fields only", () => {
  const info = resolveBuildInfo({ env: { BUILD_SHA: "abc1234def5678" }, now: NOW, runGit: noGit });
  assert.equal(info.sha, "abc1234def5678");
  assert.equal(info.commitISO, null);
  assert.equal(info.branch, "unknown");
});

test("falls back to git when no env override", () => {
  const answers = {
    "rev-parse HEAD": "9400775aaaabbbbccccdddd",
    "show -s --format=%cI HEAD": "2026-07-01T11:30:39-05:00",
    "rev-parse --abbrev-ref HEAD": "main",
  };
  const info = resolveBuildInfo({ env: {}, now: NOW, runGit: (args) => answers[args] ?? null });
  assert.equal(info.sha, "9400775aaaabbbbccccdddd");
  assert.equal(info.shortSha, "9400775");
  assert.equal(info.commitISO, "2026-07-01T11:30:39-05:00");
  assert.equal(info.branch, "main");
});

test("degrades to unknown when git is unavailable", () => {
  const info = resolveBuildInfo({ env: {}, now: NOW, runGit: noGit });
  assert.deepEqual(info, {
    sha: "unknown",
    shortSha: "unknown",
    commitISO: null,
    branch: "unknown",
    builtAtISO: "2026-07-14T00:00:00.000Z",
  });
});

test("resolveBuildInfo never throws when git throws", () => {
  const info = resolveBuildInfo({
    env: {},
    now: NOW,
    runGit: () => { throw new Error("git: command not found"); },
  });
  assert.equal(info.sha, "unknown");
});
