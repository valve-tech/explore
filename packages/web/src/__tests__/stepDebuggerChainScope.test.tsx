import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import StepDebugger from "../components/debugger/StepDebugger";
import type { OpcodeStep, StepDetailResponse } from "../api/debugger";

/**
 * StepDebugger's lazy per-step state fetch must carry the active chain.
 *
 * Found live, in the browser console, right after the deploy that started
 * routing users to the chain their transaction is actually on: every
 * `/api/debug/tx/<hash>/opcodes/detail?from=…&to=…` request went out with NO
 * `chainid` and came back 503. This component read no chain at all, so the
 * request always went to the default (369) — meaning the stack, memory and
 * storage panels were dead for any transaction not on PulseChain. The bug
 * predates the deep-link fix; it was just unreachable while every user was
 * pinned to 369 regardless of where their transaction lived.
 */

const fetchOpcodeDetail = vi.hoisted(() => vi.fn());
vi.mock("../api/debugger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/debugger")>();
  return { ...actual, fetchOpcodeDetail };
});

const PULSECHAIN = 369;
const PULSECHAIN_TESTNET = 943;
const TX = "0x" + "a3".repeat(32);

function makeStep(overrides: Partial<OpcodeStep> = {}): OpcodeStep {
  return {
    pc: 0,
    op: "PUSH1",
    gas: 100000,
    gasCost: 3,
    depth: 1,
    stack: [],
    memory: [],
    storage: {},
    ...overrides,
  };
}

const STEPS: OpcodeStep[] = [
  makeStep({ pc: 0, op: "PUSH1" }),
  makeStep({ pc: 2, op: "PUSH1" }),
  makeStep({ pc: 4, op: "MSTORE" }),
];

beforeEach(() => {
  fetchOpcodeDetail.mockReset();
  fetchOpcodeDetail.mockResolvedValue({
    ok: true,
    detail: {},
    debugAvailable: true,
  } satisfies StepDetailResponse);
});

function renderAt(url: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={client}>
        <StepDebugger steps={STEPS} txHash={TX} callTrace={null} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The chainId argument fetchOpcodeDetail was called with. */
function chainArg(): unknown {
  return fetchOpcodeDetail.mock.calls[0]?.[3];
}

describe("StepDebugger per-step detail is chain-scoped", () => {
  it("sends the URL's chain, not the default", async () => {
    renderAt(`/debugger/${TX}?chainid=943`);

    await waitFor(() => expect(fetchOpcodeDetail).toHaveBeenCalled());
    expect(chainArg()).toBe(PULSECHAIN_TESTNET);
  });

  it("sends the default chain when the URL names none", async () => {
    renderAt(`/debugger/${TX}`);

    await waitFor(() => expect(fetchOpcodeDetail).toHaveBeenCalled());
    expect(chainArg()).toBe(PULSECHAIN);
  });

  it("never omits the chain argument entirely", async () => {
    // The regression shape: calling fetchOpcodeDetail(hash, from, to) with no
    // fourth argument silently defaults to 369 inside the api client, which is
    // exactly how this shipped chain-blind.
    renderAt(`/debugger/${TX}?chainid=11155111`);

    await waitFor(() => expect(fetchOpcodeDetail).toHaveBeenCalled());
    expect(chainArg()).toBeDefined();
    expect(chainArg()).toBe(11155111);
  });

  it("keys the cache by chain so two chains can't share one entry", async () => {
    // Same hash, same window, different chain — the second render must issue
    // its own request rather than reading the first chain's cached detail.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const tree = (chainid: number) => (
      <MemoryRouter initialEntries={[`/debugger/${TX}?chainid=${chainid}`]}>
        <QueryClientProvider client={client}>
          <StepDebugger steps={STEPS} txHash={TX} callTrace={null} />
        </QueryClientProvider>
      </MemoryRouter>
    );

    const { unmount } = render(tree(PULSECHAIN_TESTNET));
    await waitFor(() => expect(fetchOpcodeDetail).toHaveBeenCalledTimes(1));
    unmount();

    render(tree(PULSECHAIN));
    await waitFor(() => expect(fetchOpcodeDetail).toHaveBeenCalledTimes(2));
    expect(fetchOpcodeDetail.mock.calls.map((c) => c[3])).toEqual([
      PULSECHAIN_TESTNET,
      PULSECHAIN,
    ]);
  });
});
