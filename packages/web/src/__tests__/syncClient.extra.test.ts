import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getAddress, type WalletClient } from "viem";
import {
  authenticate,
  logout,
  pushSync,
  SyncTransportError,
} from "../lib/workspace/syncClient";

/**
 * Supplements syncClient.test.ts — covers authenticate() (nonce → SIWE sign →
 * verify), logout(), and the pushSync ok:false transport-error branch.
 * The SIWE message builder validates the EIP-55 checksum, so the test address
 * is checksummed.
 */

const ADDRESS = getAddress("0x155172653e94a7e5f0e04126803dcb6896796fbb");

function fakeSigner(over: Partial<WalletClient> = {}): WalletClient {
  return {
    account: { address: ADDRESS },
    chain: { id: 369 },
    signMessage: vi.fn(async () => "0xsignature"),
    ...over,
  } as unknown as WalletClient;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("syncClient — authenticate", () => {
  it("runs the nonce → sign → verify handshake and returns the verified result", async () => {
    const fetchMock = vi.fn(
      async (url: string, _init?: RequestInit): Promise<Response> => {
        if (url.endsWith("/api/auth/nonce")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, nonce: "abcdef1234567890", expiresAt: 1 }),
          } as Response;
        }
        // /api/auth/verify
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, address: ADDRESS, expiresAt: 99 }),
        } as Response;
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const signer = fakeSigner();
    const result = await authenticate(signer);

    expect(result).toEqual({ address: ADDRESS, expiresAt: 99 });
    expect(signer.signMessage).toHaveBeenCalledOnce();
    // Two calls: nonce (GET) then verify (POST).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const verifyCall = fetchMock.mock.calls.find((c) =>
      (c[0] as string).endsWith("/api/auth/verify"),
    )!;
    const init = verifyCall[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    const body = JSON.parse(init.body as string);
    expect(body.signature).toBe("0xsignature");
    expect(typeof body.message).toBe("string");
  });

  it("throws when the wallet client has no account", async () => {
    const signer = fakeSigner({ account: undefined });
    await expect(authenticate(signer)).rejects.toThrow(/no account/);
  });

  it("uses the fallback chain id when the signer exposes no chain", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
      if (url.endsWith("/api/auth/nonce")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, nonce: "noncevalue123", expiresAt: 1 }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, address: ADDRESS, expiresAt: 5 }),
      } as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const signer = fakeSigner({ chain: undefined });
    const result = await authenticate(signer);
    expect(result.address).toBe(ADDRESS);
  });

  it("throws SyncTransportError when verify returns ok:false", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
      if (url.endsWith("/api/auth/nonce")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, nonce: "noncevalue123", expiresAt: 1 }),
        } as Response;
      }
      return {
        ok: false,
        status: 401,
        json: async () => ({ ok: false, error: "bad signature" }),
      } as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(authenticate(fakeSigner())).rejects.toBeInstanceOf(
      SyncTransportError,
    );
  });
});

describe("syncClient — logout", () => {
  it("POSTs to the logout endpoint with credentials", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200 }) as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await logout();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/logout");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).credentials).toBe("include");
  });
});

describe("syncClient — pushSync ok:false", () => {
  it("throws SyncTransportError on a 200 ok:false / missing serverUpdatedAt", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ ok: false, error: "db write failed" }),
        }) as Response,
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      pushSync({
        envelopeFormat: 1,
        keyVersion: 1,
        ciphertext: "AAA",
        nonce: "BBB",
        updatedAt: 1,
      }),
    ).rejects.toBeInstanceOf(SyncTransportError);
  });
});
