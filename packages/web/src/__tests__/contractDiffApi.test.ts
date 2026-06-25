import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchDiff, shortAddr, ADDRESS_RE } from "../components/ContractDiff/api";

/**
 * Direct coverage for ContractDiff/api — the raw-fetch fetchDiff helper plus
 * the pure shortAddr / ADDRESS_RE exports. The component tests mock fetchDiff,
 * so this exercises the real POST body.
 *
 * Fixtures: WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27,
 *           PLSX 0x95B303987A60C71504D99Aa1b13B4DA07b0790ab (PulseChain 369)
 * https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const A = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const B = "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab";

afterEach(() => vi.restoreAllMocks());

describe("ContractDiff/api", () => {
  it("shortAddr abbreviates head…tail", () => {
    expect(shortAddr(A)).toBe("0xA107…9a27");
  });

  it("ADDRESS_RE matches 20-byte hex only", () => {
    expect(ADDRESS_RE.test(A)).toBe(true);
    expect(ADDRESS_RE.test("0xZZ")).toBe(false);
  });

  it("fetchDiff POSTs both addresses and returns the parsed body", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, diff: { files: [] } }),
    } as Response);

    const res = await fetchDiff(A, B);
    expect(res).toEqual({ ok: true, diff: { files: [] } });

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain("/api/diff");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ addressA: A, addressB: B });
  });
});
