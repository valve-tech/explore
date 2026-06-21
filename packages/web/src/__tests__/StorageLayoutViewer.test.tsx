import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { StorageLayout } from "../components/StorageLayoutViewer/types";

/**
 * Component-level tests for StorageLayoutViewer. Validates that the
 * extracted slot computation (StorageLayoutViewer/slots.ts) and the
 * groupByContract helper are wired through to the rendered table +
 * inspector pane.
 *
 * The component fetches via raw `fetch()` inside useQuery.queryFn
 * (rather than a wrapped api/* module), so we stub globalThis.fetch
 * directly. The /rpc eth_getStorageAt call is also raw fetch.
 */

import StorageLayoutViewer from "../components/StorageLayoutViewer";

const ADDRESS = "0x1234567890123456789012345678901234567890";

function layout(): StorageLayout {
  return {
    storage: [
      { label: "owner", slot: "0", offset: 0, type: "t_address", contract: "Token" },
      { label: "totalSupply", slot: "1", offset: 0, type: "t_uint256", contract: "Token" },
      { label: "balances", slot: "2", offset: 0, type: "t_mapping", contract: "Token" },
    ],
    types: {
      t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
      t_uint256: { encoding: "inplace", label: "uint256", numberOfBytes: "32" },
      t_mapping: {
        encoding: "mapping",
        label: "mapping(address => uint256)",
        numberOfBytes: "32",
      },
    },
  };
}

/**
 * Match a fetch call by URL substring + JSON-RPC method (for the /rpc
 * endpoint, the method lives in the body). Returns the canned response.
 */
interface Route {
  match: (url: string, init?: RequestInit) => boolean;
  body: unknown;
}

function stubFetch(routes: Route[]): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const route = routes.find((r) => r.match(url, init));
    if (!route) throw new Error(`Unrouted fetch: ${init?.method ?? "GET"} ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => route.body,
    } as Response;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(spy as unknown as typeof fetch);
  return spy;
}

describe("<StorageLayoutViewer />", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders only the address input when no address is supplied", () => {
    renderWithProviders(<StorageLayoutViewer />);
    expect(
      screen.getByPlaceholderText(/0x\.\.\. contract address/i),
    ).toBeInTheDocument();
    // No layout table is rendered yet
    expect(screen.queryByText(/Storage Variables/i)).not.toBeInTheDocument();
  });

  it("shows the 'Compiling' message while the layout query is in flight", async () => {
    let resolveLayout: (v: unknown) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLayout = (body) =>
            resolve({
              ok: true,
              status: 200,
              json: async () => body,
            } as Response);
        }),
    );
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });
    expect(
      await screen.findByText(/Compiling to extract storage layout/i),
    ).toBeInTheDocument();
    // Clean up: resolve the pending promise so React doesn't complain
    resolveLayout({ ok: true, storageLayout: layout() });
  });

  it("renders one row per storage variable after the layout loads", async () => {
    stubFetch([
      {
        match: (url) => url.includes("/api/source/") && url.endsWith("/storage-layout"),
        body: { ok: true, storageLayout: layout() },
      },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    expect(await screen.findByText("owner")).toBeInTheDocument();
    expect(screen.getByText("totalSupply")).toBeInTheDocument();
    // The "balances" mapping row gets a "[map]" badge from the encoding check
    expect(screen.getByText(/balances/)).toBeInTheDocument();
    expect(screen.getByText(/\[map\]/)).toBeInTheDocument();
  });

  it("clicking a simple variable populates the inspector with its base slot", async () => {
    stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: { ok: true, storageLayout: layout() },
      },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    const ownerRow = await screen.findByText("owner");
    fireEvent.click(ownerRow);

    // Inspector should now show the base slot, padded to 32 bytes.
    // resolveSlot("0") → 0x00...00 (64 hex chars after 0x).
    await waitFor(() => {
      const slot = "0x" + "00".repeat(32);
      expect(screen.getByText(slot)).toBeInTheDocument();
    });
  });

  it("looking up a mapping key calls eth_getStorageAt with the computed slot", async () => {
    const spy = stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: { ok: true, storageLayout: layout() },
      },
      {
        // Storage reads now go through the backend dispatcher (GET
        // ?module=proxy&action=eth_getStorageAt&position=<slot>), not the
        // removed /rpc proxy.
        match: (url) => url.includes("eth_getStorageAt"),
        body: { result: "0x" + "00".repeat(31) + "ff" },
      },
    ]);

    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    // Open the mapping inspector
    fireEvent.click(await screen.findByText(/balances/));

    // Type a key and hit Read
    const keyInput = await screen.findByPlaceholderText(/0x\.\.\. or number/i);
    fireEvent.change(keyInput, { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: /^Read$/ }));

    // The dispatcher call should have happened with eth_getStorageAt
    await waitFor(() => {
      const rpcCall = spy.mock.calls.find(([url]) =>
        String(url).includes("eth_getStorageAt"),
      );
      expect(rpcCall).toBeDefined();
      // The computed slot rides as the `position` query param — confirm it's
      // the mapping-resolved slot from computeMappingSlot, not the bare base
      // slot of "2".
      const slotParam = new URL(
        String(rpcCall![0]),
        "http://localhost",
      ).searchParams.get("position");
      expect(slotParam).not.toBe("0x" + "00".repeat(31) + "02");
      expect(slotParam).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});
