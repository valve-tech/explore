import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Coverage mop-up for pure lib modules — targets the SPECIFIC remaining
 * uncovered statements/branches, one assertion per branch. See each block.
 */

// ---------------------------------------------------------------------------
// bulkParse.ts:29 — the dedup `seen.has(key)` return arm (a genuine duplicate
// that the regex matches BOTH times, so add() is called twice for one key).
// ---------------------------------------------------------------------------
import { parseBulkPaste } from "../lib/workspace/bulkParse";

describe("parseBulkPaste — dedup branch (line 29)", () => {
  it("collapses an address pasted twice (both lowercase → regex matches both)", () => {
    const addr = "0xabc0000000000000000000000000000000000123";
    const out = parseBulkPaste(`${addr}\n${addr}`);
    expect(out).toEqual([{ kind: "address", value: addr }]);
  });

  it("collapses a tx hash pasted twice", () => {
    const tx = "0x" + "a".repeat(64);
    const out = parseBulkPaste(`${tx} ${tx}`);
    expect(out).toEqual([{ kind: "tx", value: tx }]);
  });
});

// ---------------------------------------------------------------------------
// recentEntityView.ts:28 — truncMid early-return for a short 0x value.
// ---------------------------------------------------------------------------
import { primaryLabel } from "../lib/recentEntityView";
import type { RecentEntity } from "../lib/recentEntities";

describe("primaryLabel — short 0x value isn't truncated (line 28)", () => {
  it("returns a sub-16-char 0x value verbatim", () => {
    const e: RecentEntity = {
      kind: "address",
      value: "0x1234",
      pinned: false,
      visits: 1,
      lastSeen: Date.now(),
    };
    expect(primaryLabel(e)).toBe("0x1234");
  });
});

// ---------------------------------------------------------------------------
// wellKnownSignatures.ts:142 (no-0x prefix branch) + 147 (getInterfaceName).
// ---------------------------------------------------------------------------
import {
  lookupWellKnown,
  getInterfaceName,
} from "../lib/wellKnownSignatures";

describe("wellKnownSignatures", () => {
  it("looks up a selector supplied WITHOUT a 0x prefix (line 142)", () => {
    // transfer(address,uint256) → ERC20
    const hit = lookupWellKnown("a9059cbb");
    expect(hit?.interface).toBe("ERC20");
  });

  it("getInterfaceName returns the interface name (line 147)", () => {
    expect(getInterfaceName("0xa9059cbb")).toBe("ERC20");
    expect(getInterfaceName("0xdeadbeef")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// debuggerTreeState.ts:66 — the `continue` for a foreign localStorage key.
// ---------------------------------------------------------------------------
import { pruneStaleTreeState } from "../lib/debuggerTreeState";

describe("pruneStaleTreeState — skips foreign keys (line 66)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("leaves keys that don't carry our prefix untouched", () => {
    localStorage.setItem("some:other:key", "anything");
    pruneStaleTreeState();
    expect(localStorage.getItem("some:other:key")).toBe("anything");
  });
});

// ---------------------------------------------------------------------------
// desktopNotify.ts:35,41 — the `typeof localStorage === "undefined"` guards in
// isDesktopNotifyEnabled / setDesktopNotifyEnabled. Force by removing the global.
// ---------------------------------------------------------------------------
import {
  isDesktopNotifyEnabled,
  setDesktopNotifyEnabled,
} from "../lib/watcher/desktopNotify";

describe("desktopNotify — no-localStorage guards (lines 35,41)", () => {
  const g = globalThis as unknown as { localStorage?: Storage };
  let original: Storage | undefined;

  beforeEach(() => {
    original = g.localStorage;
  });
  afterEach(() => {
    if (original === undefined) delete g.localStorage;
    else g.localStorage = original;
  });

  it("isDesktopNotifyEnabled returns false when localStorage is absent", () => {
    delete g.localStorage;
    expect(isDesktopNotifyEnabled()).toBe(false);
  });

  it("setDesktopNotifyEnabled is a no-op when localStorage is absent", () => {
    delete g.localStorage;
    expect(() => setDesktopNotifyEnabled(true)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// byoTransfers.ts:82 — eth_blockNumber returns an RPC error → throw.
// ---------------------------------------------------------------------------
const sendRpcRequest = vi.fn();
vi.mock("../api/rpc", () => ({
  sendRpcRequest: (...args: unknown[]) => sendRpcRequest(...args),
}));

import { fetchTransfersViaRpc } from "../lib/byoTransfers";
import {
  fetchBlockLadderViaRpc,
} from "../lib/byoNetworkHealth";

const hex = (n: number) => "0x" + n.toString(16);
const ok = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });

describe("byoTransfers — head error throws (line 82)", () => {
  beforeEach(() => sendRpcRequest.mockReset());

  it("rejects when eth_blockNumber returns an error", async () => {
    sendRpcRequest.mockResolvedValueOnce({
      jsonrpc: "2.0",
      id: 1,
      error: { message: "head unavailable" },
    });
    await expect(
      fetchTransfersViaRpc("0xtoken", "24h", 369),
    ).rejects.toThrow(/head unavailable/);
  });
});

// ---------------------------------------------------------------------------
// byoNetworkHealth.ts:47 (numericType number branch) + 281 (string tx skip).
// Both reached via fetchBlockLadderViaRpc.
// ---------------------------------------------------------------------------
describe("byoNetworkHealth — fetchBlockLadderViaRpc edge branches (47,281)", () => {
  beforeEach(() => sendRpcRequest.mockReset());

  it("accepts a numeric receipt type and skips string-only block txs", async () => {
    sendRpcRequest.mockImplementation((req: { method?: string }) => {
      if (req?.method === "eth_getBlockByNumber") {
        return Promise.resolve(
          ok({
            number: hex(100),
            timestamp: hex(1_700_000_000),
            baseFeePerGas: hex(1_000_000_000),
            gasUsed: hex(21_000),
            gasLimit: hex(30_000_000),
            miner: "0xminer",
            // A bare tx-hash string alongside a full tx object: the string is
            // skipped (line 281), the full tx is indexed.
            transactions: [
              "0x" + "f".repeat(64),
              {
                hash: "0x" + "a".repeat(64),
                transactionIndex: "0x0",
                input: "0x",
                to: "0xto",
                value: hex(0),
              },
            ],
          }),
        );
      }
      // eth_getBlockReceipts — numeric `type` exercises numericType line 47.
      return Promise.resolve(
        ok([
          {
            transactionIndex: "0x0",
            type: 2,
            from: "0xaaa",
            gasUsed: hex(21_000),
            effectiveGasPrice: hex(2_000_000_000),
          },
        ]),
      );
    });

    const ladder = await fetchBlockLadderViaRpc(369, "100", true);
    // The string tx was skipped (line 281); only the full tx survives the
    // receipt join, and its numeric `type: 2` flowed through numericType (47).
    expect(ladder.txs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// workspace/sync.ts:91 (cache cleared on derivation rejection) + 226 (shape
// guard falsy/non-object arm).
// ---------------------------------------------------------------------------
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  createWalletClient,
  http,
  type WalletClient,
} from "viem";
import { mainnet } from "viem/chains";
import { encryptEnvelope } from "@valve-tech/wallet-crypto";
import {
  CURRENT_ENVELOPE_FORMAT,
  CURRENT_KEY_VERSION,
  _resetKeyCacheForTests,
  decryptStoreEnvelope,
  getWorkspaceKey,
  type WorkspaceSyncEnvelope,
} from "../lib/workspace/sync";
import { EMPTY_STORE } from "../lib/workspace/types";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1)
    binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("workspace/sync — getWorkspaceKey drops a rejected cache entry (line 91)", () => {
  beforeEach(() => _resetKeyCacheForTests());

  it("re-derives after a rejection (the cached rejected promise is deleted)", async () => {
    const signMessage = vi.fn(() => Promise.reject(new Error("user rejected")));
    const signer = {
      account: { address: "0x1111111111111111111111111111111111111111" },
      signMessage,
    } as unknown as WalletClient;

    await expect(getWorkspaceKey({ signer })).rejects.toThrow();
    // The .catch arm deleted the cache, so a second call re-prompts (signs again)
    // rather than returning the same rejected promise.
    await expect(getWorkspaceKey({ signer })).rejects.toThrow();
    expect(signMessage).toHaveBeenCalledTimes(2);
  });
});

describe("workspace/sync — isWorkspaceStore rejects a non-object payload (line 226)", () => {
  beforeEach(() => _resetKeyCacheForTests());

  it("returns EMPTY_STORE when the decrypted JSON is null (falsy/non-object)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signer = createWalletClient({
      account,
      chain: mainnet,
      transport: http(),
    });
    const key = await getWorkspaceKey({ signer });

    const plaintext = new TextEncoder().encode(JSON.stringify(null));
    const aad = new TextEncoder().encode(
      `${CURRENT_ENVELOPE_FORMAT}|${CURRENT_KEY_VERSION}`,
    );
    const { ciphertext, nonce } = await encryptEnvelope({ key, plaintext, aad });

    const envelope: WorkspaceSyncEnvelope = {
      envelopeFormat: CURRENT_ENVELOPE_FORMAT,
      keyVersion: CURRENT_KEY_VERSION,
      ciphertext: bytesToBase64Url(ciphertext),
      nonce: bytesToBase64Url(nonce),
      updatedAt: 1_717_200_000_000,
    };

    expect(await decryptStoreEnvelope({ envelope, key })).toEqual(EMPTY_STORE);
  });
});
