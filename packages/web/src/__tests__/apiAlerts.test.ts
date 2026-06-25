import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for src/api/alerts.ts — alert CRUD + history + test endpoints. Each
 * function unwraps a {ok, ...} envelope and, on a non-ok response, throws the
 * server's `error` string (falling back to a per-function default). The
 * default-error fallback (when res.json() rejects) is the main uncovered path.
 *
 * Fixtures are synthetic alert records. Default chain 369 (PulseChain) → bare
 * /api/alerts URL; chain 1 = Ethereum asserts ?chainid scoping on list/create.
 */

import {
  listAlerts,
  getAlert,
  createAlert,
  updateAlert,
  deleteAlert,
  getAlertHistory,
  testAlert,
  type CreateAlertPayload,
} from "../api/alerts";

function okRes(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as Response;
}
function errRes(json: unknown, status = 500): Response {
  return { ok: false, status, json: async () => json } as Response;
}
/** A non-ok response whose body isn't JSON, so res.json() rejects. */
function errResBadJson(status = 500): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("not json");
    },
  } as unknown as Response;
}

const PAYLOAD: CreateAlertPayload = {
  name: "Whale watch",
  type: "address_activity",
  conditions: { address: "0xabc" },
  notifications: [{ type: "webhook", url: "https://example.com/hook" }],
  enabled: true,
  cooldown_seconds: 60,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("listAlerts", () => {
  it("returns alerts + stats on the default chain (bare URL)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, alerts: [{ id: 1 }], stats: { total: 1, active: 1, triggered_today: 0 } }),
    );
    const out = await listAlerts();
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/alerts");
    expect(out.alerts).toHaveLength(1);
    expect(out.stats.total).toBe(1);
  });

  it("scopes chainid for a non-default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, alerts: [], stats: {} }));
    await listAlerts(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/alerts?chainid=1");
  });

  it("throws the server error on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({ error: "db down" }));
    await expect(listAlerts()).rejects.toThrow("db down");
  });

  it("falls back to the default message when the error body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errResBadJson());
    await expect(listAlerts()).rejects.toThrow("Unknown error");
  });

  it("uses the per-function default when the JSON body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({}));
    await expect(listAlerts()).rejects.toThrow("Failed to list alerts");
  });
});

describe("getAlert", () => {
  it("returns alert + recent_history", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, alert: { id: 7 }, recent_history: [] }),
    );
    const out = await getAlert(7);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/alerts/7");
    expect(out.alert.id).toBe(7);
  });

  it("throws the server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({ error: "no such alert" }));
    await expect(getAlert(7)).rejects.toThrow("no such alert");
  });

  it("falls back to default on a non-JSON error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errResBadJson());
    await expect(getAlert(7)).rejects.toThrow("Unknown error");
  });

  it("uses the per-function default when the JSON body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({}));
    await expect(getAlert(7)).rejects.toThrow("Failed to get alert");
  });
});

describe("createAlert", () => {
  it("POSTs the payload and returns the new alert (default chain)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, alert: { id: 1, ...PAYLOAD } }));
    const out = await createAlert(PAYLOAD);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/alerts");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual(PAYLOAD);
    expect(out.id).toBe(1);
  });

  it("scopes chainid for a non-default chain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, alert: { id: 2 } }));
    await createAlert(PAYLOAD, 1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/alerts?chainid=1");
  });

  it("throws the validation error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errRes({ error: "invalid conditions" }, 400),
    );
    await expect(createAlert(PAYLOAD)).rejects.toThrow("invalid conditions");
  });

  it("falls back to default on a non-JSON error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errResBadJson(400));
    await expect(createAlert(PAYLOAD)).rejects.toThrow("Unknown error");
  });

  it("uses the per-function default when the JSON body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({}, 400));
    await expect(createAlert(PAYLOAD)).rejects.toThrow("Failed to create alert");
  });
});

describe("updateAlert", () => {
  it("PUTs to the id route and returns the alert", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true, alert: { id: 3 } }));
    const out = await updateAlert(3, PAYLOAD);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/alerts/3");
    expect(init!.method).toBe("PUT");
    expect(out.id).toBe(3);
  });

  it("throws the server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({ error: "conflict" }));
    await expect(updateAlert(3, PAYLOAD)).rejects.toThrow("conflict");
  });

  it("falls back to default on a non-JSON error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errResBadJson());
    await expect(updateAlert(3, PAYLOAD)).rejects.toThrow("Unknown error");
  });

  it("uses the per-function default when the JSON body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({}));
    await expect(updateAlert(3, PAYLOAD)).rejects.toThrow("Failed to update alert");
  });
});

describe("deleteAlert", () => {
  it("DELETEs the id route and resolves", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true }));
    await expect(deleteAlert(4)).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/alerts/4");
    expect(init!.method).toBe("DELETE");
  });

  it("throws the server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({ error: "in use" }));
    await expect(deleteAlert(4)).rejects.toThrow("in use");
  });

  it("falls back to default on a non-JSON error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errResBadJson());
    await expect(deleteAlert(4)).rejects.toThrow("Unknown error");
  });

  it("uses the per-function default when the JSON body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({}));
    await expect(deleteAlert(4)).rejects.toThrow("Failed to delete alert");
  });
});

describe("getAlertHistory", () => {
  it("builds the paginated URL and returns history + pagination", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({
        ok: true,
        history: [],
        pagination: { page: 2, limit: 5, total: 0, totalPages: 0 },
      }),
    );
    const out = await getAlertHistory(9, 2, 5);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/alerts/9/history?page=2&limit=5");
    expect(out.pagination.page).toBe(2);
  });

  it("uses default page/limit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okRes({ ok: true, history: [], pagination: {} }),
    );
    await getAlertHistory(9);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/alerts/9/history?page=1&limit=20");
  });

  it("throws the server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({ error: "boom" }));
    await expect(getAlertHistory(9)).rejects.toThrow("boom");
  });

  it("falls back to default on a non-JSON error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errResBadJson());
    await expect(getAlertHistory(9)).rejects.toThrow("Unknown error");
  });

  it("uses the per-function default when the JSON body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({}));
    await expect(getAlertHistory(9)).rejects.toThrow("Failed to get history");
  });
});

describe("testAlert", () => {
  it("POSTs to the test route and resolves", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRes({ ok: true }));
    await expect(testAlert(11)).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/alerts/11/test");
    expect(init!.method).toBe("POST");
  });

  it("throws the server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({ error: "no channels" }));
    await expect(testAlert(11)).rejects.toThrow("no channels");
  });

  it("falls back to default on a non-JSON error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errResBadJson());
    await expect(testAlert(11)).rejects.toThrow("Unknown error");
  });

  it("uses the per-function default when the JSON body has no error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errRes({}));
    await expect(testAlert(11)).rejects.toThrow("Failed to test alert");
  });
});
