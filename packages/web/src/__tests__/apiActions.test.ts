import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for src/api/actions.ts — Web3 Actions CRUD + test/execute + logs. All
 * funnel through `handleResponse`, which throws the server JSON `error` (or raw
 * text) on a non-ok response. create/list are chain-scoped (?chainid=N);
 * default chain 369 → bare URL.
 *
 * Fixtures are synthetic Action records (block-triggered serverless function).
 */

import {
  createAction,
  listActions,
  getAction,
  updateAction,
  deleteAction,
  testAction,
  getActionLogs,
} from "../api/actions";

const ACTION = {
  id: 1,
  name: "on-block",
  code: "export default async () => {}",
  chainid: 369,
  triggerType: "block" as const,
  triggerConfig: {},
  secretKeys: [],
  enabled: true,
  createdAt: "2026-06-24T00:00:00Z",
  updatedAt: "2026-06-24T00:00:00Z",
};

function okRes(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}
function errRes(text: string, status = 500): Response {
  return { ok: false, status, text: async () => text } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("createAction", () => {
  it("POSTs the data and returns the action (bare URL when chainId omitted)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, action: ACTION }));
    const data = { name: "on-block", code: "...", triggerType: "block", triggerConfig: {} };
    const out = await createAction(data);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/actions");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual(data);
    expect(out.id).toBe(1);
  });

  it("scopes chainid for a non-default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, action: ACTION }));
    await createAction(
      { name: "x", code: "y", triggerType: "block", triggerConfig: {} },
      1,
    );
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/actions?chainid=1");
  });

  it("throws the JSON error on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes(JSON.stringify({ error: "code too long" })),
    );
    await expect(
      createAction({ name: "x", code: "y", triggerType: "block", triggerConfig: {} }),
    ).rejects.toThrow("code too long");
  });

  it("throws raw text when the error body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes("boom"));
    await expect(
      createAction({ name: "x", code: "y", triggerType: "block", triggerConfig: {} }),
    ).rejects.toThrow("boom");
  });

  it("falls back to the raw text when the JSON error body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes('{"detail":"z"}'));
    await expect(
      createAction({ name: "x", code: "y", triggerType: "block", triggerConfig: {} }),
    ).rejects.toThrow('{"detail":"z"}');
  });
});

describe("listActions", () => {
  it("returns the actions + stats envelope (default chain)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, actions: [ACTION], stats: { total: 1, active: 1, todayExecutions: 0 } }),
    );
    const out = await listActions();
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/actions");
    expect(out.actions).toHaveLength(1);
    expect(out.stats.total).toBe(1);
  });

  it("scopes chainid", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, actions: [], stats: {} }));
    await listActions(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/actions?chainid=1");
  });
});

describe("getAction / updateAction / deleteAction", () => {
  it("getAction GETs the id route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, action: ACTION }));
    const out = await getAction(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/actions/1");
    expect(out.id).toBe(1);
  });

  it("updateAction PUTs the partial data", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, action: { ...ACTION, enabled: false } }));
    const out = await updateAction(1, { enabled: false });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/actions/1");
    expect(init!.method).toBe("PUT");
    expect(JSON.parse(init!.body as string)).toEqual({ enabled: false });
    expect(out.enabled).toBe(false);
  });

  it("deleteAction DELETEs the id route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true }));
    await expect(deleteAction(1)).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/actions/1");
    expect(init!.method).toBe("DELETE");
  });
});

describe("testAction", () => {
  it("POSTs the event and returns the execution result", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, result: { success: true, stdout: "", stderr: "", duration_ms: 5 } }),
    );
    const out = await testAction(1, { blockNumber: 100 });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/actions/1/test");
    expect(JSON.parse(init!.body as string)).toEqual({ event: { blockNumber: 100 } });
    expect(out.success).toBe(true);
  });

  it("defaults the event to {} when omitted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, result: { success: true, stdout: "", stderr: "", duration_ms: 1 } }),
    );
    await testAction(1);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)).toEqual({ event: {} });
  });
});

describe("getActionLogs", () => {
  it("builds the paginated URL and returns the rows envelope", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, rows: [], total: 0, page: 3, limit: 5 }),
    );
    const out = await getActionLogs(1, 3, 5);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/actions/1/logs?page=3&limit=5");
    expect(out.page).toBe(3);
  });

  it("uses default page/limit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, rows: [], total: 0, page: 1, limit: 20 }),
    );
    await getActionLogs(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/actions/1/logs?page=1&limit=20");
  });
});
