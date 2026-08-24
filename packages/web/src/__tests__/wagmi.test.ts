import { describe, it, expect } from "vitest";
import { wagmiConfig } from "../lib/wagmi";
import { VALVE_PUBLIC_RPC } from "../lib/rpcDefaults";

/**
 * Smoke test for the wagmi config, plus a guard on the endpoint each transport
 * actually points at.
 *
 * The endpoint assertion exists because the previous version of this file only
 * checked that a transport was `toBeDefined()`. That passed for months while
 * every transport was a bare `http()` — which does NOT mean "no endpoint", it
 * means viem substitutes the URL compiled into its own chain definition
 * (`https://eth.merkle.io` for Ethereum). A third party nobody chose was one
 * `useBalance` away from receiving our users' IPs, and no test could see it.
 * "A transport exists" is not the property worth asserting; "it points where
 * we said" is.
 */

/**
 * The URL a configured viem transport will actually call.
 *
 * `_internal.transports` is keyed by chain-id literals, so a `number` lookup
 * needs the widening cast; that is a typing detail, not a behavioural one.
 */
function urlOf(chainId: number): string | undefined {
  const transports = wagmiConfig._internal.transports as Record<
    number,
    ((args: Record<string, unknown>) => { value?: { url?: string } }) | undefined
  >;
  return transports[chainId]?.({}).value?.url;
}

describe("lib/wagmi — wagmiConfig", () => {
  it("registers every chain the app serves, Sepolia included", () => {
    expect(wagmiConfig.chains.map((c) => c.id).sort((a, b) => a - b)).toEqual([
      1, 369, 943, 11155111,
    ]);
  });

  it("exposes a transport per chain", () => {
    for (const chain of wagmiConfig.chains) {
      expect(wagmiConfig._internal.transports[chain.id]).toBeDefined();
    }
  });

  it("points every transport at Valve's own node, not a viem default", () => {
    for (const chain of wagmiConfig.chains) {
      expect(urlOf(chain.id), `chain ${chain.id}`).toBe(
        VALVE_PUBLIC_RPC[chain.id],
      );
    }
  });

  it("never falls through to a third-party default endpoint", () => {
    // The exact hosts viem would have supplied on its own. If any of these
    // reappears, a transport lost its explicit URL.
    const viemDefaults = [
      "eth.merkle.io",
      "rpc.pulsechain.com",
      "rpc.v4.testnet.pulsechain.com",
      "11155111.rpc.thirdweb.com",
    ];
    for (const chain of wagmiConfig.chains) {
      const url = urlOf(chain.id) ?? "";
      for (const host of viemDefaults) {
        expect(url, `chain ${chain.id} fell back to ${host}`).not.toContain(
          host,
        );
      }
    }
  });

  it("wires at least one connector (injected)", () => {
    expect(wagmiConfig.connectors.length).toBeGreaterThan(0);
  });
});
