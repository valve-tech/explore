import { describe, it, expect, beforeEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createWalletClient, http, type WalletClient } from "viem";
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

/**
 * Supplements workspaceSync.test.ts — covers:
 *  - getWorkspaceKey rejecting when the signer has no connected account, and
 *  - decryptStoreEnvelope returning EMPTY_STORE when the decrypted JSON decrypts
 *    cleanly but isn't a valid WorkspaceStore (shape guard fails).
 */

function makeSigner(): WalletClient {
  const account = privateKeyToAccount(generatePrivateKey());
  return createWalletClient({ account, chain: mainnet, transport: http() });
}

// Local copies of sync.ts's private base64url helper (matching byte-for-byte).
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

beforeEach(() => _resetKeyCacheForTests());

describe("getWorkspaceKey — no connected account", () => {
  it("rejects when the signer has no account", async () => {
    const signerNoAccount = { account: undefined } as unknown as WalletClient;
    await expect(getWorkspaceKey({ signer: signerNoAccount })).rejects.toThrow(
      /no connected account/,
    );
  });
});

describe("decryptStoreEnvelope — undecodable shape falls to EMPTY_STORE", () => {
  it("returns EMPTY_STORE when the decrypted JSON isn't a WorkspaceStore", async () => {
    const signer = makeSigner();
    const key = await getWorkspaceKey({ signer });

    // Encrypt a non-store payload with the SAME AAD the module binds, so it
    // decrypts cleanly but fails the isWorkspaceStore shape guard.
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, workspaces: "not-an-array" }),
    );
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
