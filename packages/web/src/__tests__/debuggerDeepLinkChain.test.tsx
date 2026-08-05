import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import DebuggerView from "../components/debugger/DebuggerView";

/**
 * The reported bug, pinned end to end.
 *
 * `https://explore.valve.city/debugger/0x6623…484d` showed no usable data. The
 * transaction is real — chain 943, block 25057713 — but a shared debugger link
 * carries no `?chainid`, and chain selection lives entirely in that param, so
 * every fetch went to PulseChain (369) where the hash does not exist.
 *
 * These tests assert the fix at the level that matters: the URL is pointed at
 * the chain the hash actually lives on BEFORE the three heavy per-chain fetches
 * run, and an explicit `?chainid` is never second-guessed.
 */

vi.mock("../components/debugger/StepDebugger", () => ({
  default: ({ txHash }: { txHash: string | null }) => (
    <div data-testid="step-debugger">step-debugger:{txHash}</div>
  ),
}));
vi.mock("../components/debugger/GasProfiler", () => ({
  default: () => <div data-testid="gas-profiler" />,
}));
vi.mock("@valve-tech/trace-sdk", () => ({
  CallTree: () => <div data-testid="call-tree" />,
  GasFlamegraph: () => <div data-testid="gas-flamegraph" />,
  OpcodeViewer: () => <div data-testid="opcode-viewer" />,
  normalizeCallFrame: (f: unknown) => f,
  normalizeStructLogs: (s: unknown) => s,
}));

const fetchTrace = vi.hoisted(() => vi.fn());
const fetchGasProfile = vi.hoisted(() => vi.fn());
const fetchOpcodes = vi.hoisted(() => vi.fn());
vi.mock("../api/debugger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/debugger")>();
  return { ...actual, fetchTrace, fetchGasProfile, fetchOpcodes };
});

const fetchTransaction = vi.hoisted(() => vi.fn());
vi.mock("../api/explorer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/explorer")>();
  return { ...actual, fetchTransaction };
});

const resolveEntity = vi.hoisted(() => vi.fn());
vi.mock("../api/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/resolve")>();
  return { ...actual, resolveEntity };
});

vi.mock("../lib/recentDebuggerTxs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/recentDebuggerTxs")>();
  return { ...actual, recordDebuggerTx: vi.fn() };
});
vi.mock("../lib/recentEntities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/recentEntities")>();
  return { ...actual, recordVisit: vi.fn() };
});

/** The transaction from the bug report — mined on chain 943, not 369. */
const TX_943 =
  "0x6623746f47780374bef46e4b5a1f35f4404ceabf42b4e435109e2f8547fb484d";
const PULSECHAIN = 369;
const PULSECHAIN_TESTNET = 943;

beforeEach(() => {
  fetchTrace.mockReset();
  fetchGasProfile.mockReset();
  fetchOpcodes.mockReset();
  fetchTransaction.mockReset();
  resolveEntity.mockReset();

  fetchTransaction.mockResolvedValue({ blockHash: "0x" + "b".repeat(64) });
  fetchTrace.mockResolvedValue({ ok: true, trace: { to: "0xb815" } });
  fetchGasProfile.mockResolvedValue({ ok: false });
  fetchOpcodes.mockResolvedValue({ ok: true, steps: [{ pc: 0, op: "PUSH1" }] });
});

/** Renders the current search string so tests can assert on the URL. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <LocationProbe />
        <Routes>
          <Route path="/debugger/:txHash" element={<DebuggerView />} />
          <Route path="/debugger/:txHash/:tab" element={<DebuggerView />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Every chainId the three trace fetches were called with. */
function fetchedChains(): number[] {
  return [
    ...fetchTrace.mock.calls.map((c) => c[1]),
    ...fetchGasProfile.mock.calls.map((c) => c[1]),
    // fetchOpcodes(hash, limit, chainId)
    ...fetchOpcodes.mock.calls.map((c) => c[2]),
  ];
}

describe("chain-less debugger deep link", () => {
  it("rewrites the URL to the chain the tx actually lives on", async () => {
    resolveEntity.mockResolvedValue({
      kind: "tx",
      query: TX_943,
      matches: [{ chainId: PULSECHAIN_TESTNET }],
    });

    renderAt(`/debugger/${TX_943}`);

    await waitFor(() =>
      expect(screen.getByTestId("search").textContent).toBe("?chainid=943"),
    );
    expect(resolveEntity).toHaveBeenCalledWith(TX_943);
  });

  it("never fetches against the wrong chain first", async () => {
    // The heart of the bug: three heavy fetches went to 369, all failed, and the
    // page reported no data. Not one request may carry the default chain here.
    resolveEntity.mockResolvedValue({
      kind: "tx",
      query: TX_943,
      matches: [{ chainId: PULSECHAIN_TESTNET }],
    });

    renderAt(`/debugger/${TX_943}`);

    await waitFor(() => expect(fetchTrace).toHaveBeenCalled());
    const chains = fetchedChains();
    expect(chains.length).toBeGreaterThan(0);
    expect(chains).not.toContain(PULSECHAIN);
    expect(new Set(chains)).toEqual(new Set([PULSECHAIN_TESTNET]));
  });

  it("gates the cheap tx-context fetch on the resolve too", async () => {
    let release: (v: unknown) => void = () => {};
    resolveEntity.mockReturnValue(
      new Promise((res) => {
        release = res;
      }),
    );

    renderAt(`/debugger/${TX_943}`);

    // Resolve still in flight — nothing may have been requested yet.
    await waitFor(() => expect(resolveEntity).toHaveBeenCalled());
    expect(fetchTransaction).not.toHaveBeenCalled();

    release({
      kind: "tx",
      query: TX_943,
      matches: [{ chainId: PULSECHAIN_TESTNET }],
    });
    await waitFor(() =>
      expect(fetchTransaction).toHaveBeenCalledWith(TX_943, PULSECHAIN_TESTNET),
    );
  });

  it("renders the trace once pointed at the right chain", async () => {
    resolveEntity.mockResolvedValue({
      kind: "tx",
      query: TX_943,
      matches: [{ chainId: PULSECHAIN_TESTNET }],
    });

    renderAt(`/debugger/${TX_943}`);

    await waitFor(() =>
      expect(screen.getByTestId("step-debugger")).toBeInTheDocument(),
    );
  });

  it("leaves the URL param-free when the tx is on the default chain", async () => {
    // `scoped()` omits chainid for 369, so adding it here would churn the URL
    // and make otherwise-identical requests miss the query cache.
    resolveEntity.mockResolvedValue({
      kind: "tx",
      query: TX_943,
      matches: [{ chainId: PULSECHAIN }],
    });

    renderAt(`/debugger/${TX_943}`);

    await waitFor(() => expect(fetchTrace).toHaveBeenCalled());
    expect(screen.getByTestId("search").textContent).toBe("");
    expect(fetchedChains()).toEqual([PULSECHAIN, PULSECHAIN, PULSECHAIN]);
  });

  it("falls through to the default chain when the tx resolves nowhere", async () => {
    resolveEntity.mockResolvedValue({ kind: "tx", query: TX_943, matches: [] });

    renderAt(`/debugger/${TX_943}`);

    await waitFor(() => expect(fetchTrace).toHaveBeenCalled());
    expect(screen.getByTestId("search").textContent).toBe("");
    expect(fetchedChains()).not.toContain(PULSECHAIN_TESTNET);
  });

  it("a failed resolve does not strand the page in loading", async () => {
    resolveEntity.mockRejectedValue(new Error("resolve unavailable"));

    renderAt(`/debugger/${TX_943}`);

    await waitFor(() =>
      expect(fetchTrace).toHaveBeenCalledWith(TX_943, PULSECHAIN),
    );
  });

  it("preserves the tab segment across the redirect", async () => {
    resolveEntity.mockResolvedValue({
      kind: "tx",
      query: TX_943,
      matches: [{ chainId: PULSECHAIN_TESTNET }],
    });

    renderAt(`/debugger/${TX_943}/gas`);

    await waitFor(() =>
      expect(screen.getByTestId("search").textContent).toBe("?chainid=943"),
    );
    // The redirect writes only the query string; the /gas path segment stands.
    await waitFor(() =>
      expect(screen.getByTestId("gas-flamegraph")).toBeInTheDocument(),
    );
  });
});

describe("explicit ?chainid on a debugger deep link", () => {
  it("is taken at face value — no resolve, no redirect", async () => {
    renderAt(`/debugger/${TX_943}?chainid=369`);

    await waitFor(() => expect(fetchTrace).toHaveBeenCalled());
    expect(resolveEntity).not.toHaveBeenCalled();
    expect(screen.getByTestId("search").textContent).toBe("?chainid=369");
    expect(new Set(fetchedChains())).toEqual(new Set([PULSECHAIN]));
  });

  it("honors an explicit non-default chain without probing", async () => {
    renderAt(`/debugger/${TX_943}?chainid=943`);

    await waitFor(() => expect(fetchTrace).toHaveBeenCalled());
    expect(resolveEntity).not.toHaveBeenCalled();
    expect(new Set(fetchedChains())).toEqual(new Set([PULSECHAIN_TESTNET]));
  });
});
