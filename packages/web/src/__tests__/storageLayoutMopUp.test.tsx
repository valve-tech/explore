import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { useSearchParams } from "react-router-dom";
import { renderWithProviders } from "./_test-utils";
import type {
  StorageLayout,
  StorageLayoutResponse,
} from "../components/StorageLayoutViewer/types";

/**
 * StorageLayoutViewer coverage mop-up — the arms the base + .extra tests miss:
 *   - readStorageAt's catch → null (fetch throws on a slot read)
 *   - handleLookupMapping guard (Read clicked with an empty key)
 *   - resolveSlot → null early return (array index that won't parse)
 *   - handleLookupMapping catch (readStorageAt throws mid-lookup)
 *   - multi-contract grouping header (grouped.size > 1)
 *   - truncateSlot's short-slot branch (slot length <= 14)
 *   - DecompiledLayoutPanel.handleRead catch (slot read throws)
 *
 * Fixture: WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 (PulseChain 369).
 */

import StorageLayoutViewer from "../components/StorageLayoutViewer";

const ADDRESS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

interface Route {
  match: (url: string) => boolean;
  body?: unknown;
  ok?: boolean;
  throws?: boolean;
}

function stubFetch(routes: Route[]): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: unknown) => {
    const url = String(input);
    const route = routes.find((r) => r.match(url));
    if (!route) throw new Error(`Unrouted: ${url}`);
    if (route.throws) throw new Error("network down");
    return {
      ok: route.ok ?? true,
      status: route.ok === false ? 404 : 200,
      json: async () => route.body,
    } as Response;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(spy as unknown as typeof fetch);
  return spy;
}

function simpleLayout(): StorageLayout {
  return {
    storage: [
      { label: "owner", slot: "0", offset: 0, type: "t_address", contract: "Token" },
    ],
    types: {
      t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
    },
  };
}

function arrayLayout(): StorageLayout {
  return {
    storage: [
      { label: "holders", slot: "1", offset: 0, type: "t_array", contract: "Token" },
    ],
    types: {
      t_array: {
        encoding: "dynamic_array",
        label: "address[]",
        numberOfBytes: "32",
        base: "t_address",
      },
    },
  };
}

function mappingLayout(): StorageLayout {
  return {
    storage: [
      { label: "balances", slot: "2", offset: 0, type: "t_map", contract: "Token" },
    ],
    types: {
      t_map: {
        encoding: "mapping",
        label: "mapping(address => uint256)",
        numberOfBytes: "32",
        key: "t_address",
        value: "t_uint256",
      },
    },
  };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("<StorageLayoutViewer /> — extra mop-up branches", () => {
  it("returns null (no value) when the slot read fetch throws", async () => {
    stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: { ok: true, storageLayout: simpleLayout() } as StorageLayoutResponse,
      },
      { match: (url) => url.includes("eth_getStorageAt"), throws: true },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    fireEvent.click(await screen.findByText("owner"));
    fireEvent.click(
      await screen.findByRole("button", { name: /Read Current Value/ }),
    );

    // readStorageAt's catch swallows the throw → no "Current Value" panel.
    await waitFor(() =>
      expect(screen.queryByText("Current Value")).not.toBeInTheDocument(),
    );
  });

  it("no-ops when Read is clicked on a mapping with an empty key (guard)", async () => {
    const spy = stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: { ok: true, storageLayout: mappingLayout() },
      },
      { match: (url) => url.includes("eth_getStorageAt"), body: { result: "0x00" } },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    fireEvent.click(await screen.findByText(/balances/));
    // Click Read with the key input left empty → handleLookupMapping guard
    // (`!lookupKey`) returns before any fetch.
    fireEvent.click(screen.getByRole("button", { name: /^Read$/ }));
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([u]) => String(u).includes("eth_getStorageAt")),
      ).toBe(false),
    );
  });

  it("no-ops on an unparseable array index (resolveSlot → null)", async () => {
    const spy = stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: { ok: true, storageLayout: arrayLayout() },
      },
      { match: (url) => url.includes("eth_getStorageAt"), body: { result: "0x00" } },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    fireEvent.click(await screen.findByText(/holders/));
    const idxInput = await screen.findByPlaceholderText("0");
    fireEvent.change(idxInput, { target: { value: "not-a-number" } });
    fireEvent.click(screen.getByRole("button", { name: /^Read$/ }));

    // resolveSlot returns null for the NaN index → early return, no read.
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([u]) => String(u).includes("eth_getStorageAt")),
      ).toBe(false),
    );
  });

  it("reads an array slot when Enter is pressed in the index input", async () => {
    const spy = stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: { ok: true, storageLayout: arrayLayout() },
      },
      { match: (url) => url.includes("eth_getStorageAt"), body: { result: "0x" + "00".repeat(31) + "09" } },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    fireEvent.click(await screen.findByText(/holders/));
    const idxInput = await screen.findByPlaceholderText("0");
    fireEvent.change(idxInput, { target: { value: "0" } });
    // Enter on the array-index input fires handleLookupMapping (line 296).
    fireEvent.keyDown(idxInput, { key: "Enter" });
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([u]) => String(u).includes("eth_getStorageAt")),
      ).toBe(true),
    );
    expect(await screen.findByText(/Decimal: 9/)).toBeInTheDocument();
  });

  it("swallows a thrown slot read during a mapping lookup (handleLookupMapping catch)", async () => {
    stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: { ok: true, storageLayout: mappingLayout() },
      },
      { match: (url) => url.includes("eth_getStorageAt"), throws: true },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    fireEvent.click(await screen.findByText(/balances/));
    const keyInput = await screen.findByPlaceholderText(/0x\.\.\. or number/i);
    fireEvent.change(keyInput, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Read$/ }));

    // The computed slot still renders; the value stays empty (catch → null).
    expect(await screen.findByText("Computed Slot")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Current Value")).not.toBeInTheDocument(),
    );
  });

  it("renders per-contract group headers when storage spans >1 contract", async () => {
    const multi: StorageLayout = {
      storage: [
        { label: "a", slot: "0", offset: 0, type: "t_uint", contract: "Base" },
        { label: "b", slot: "1", offset: 0, type: "t_uint", contract: "Derived" },
      ],
      types: { t_uint: { encoding: "inplace", label: "uint256", numberOfBytes: "32" } },
    };
    stubFetch([
      { match: (url) => url.includes("/storage-layout"), body: { ok: true, storageLayout: multi } },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    // grouped.size > 1 → a header row per contract.
    expect(await screen.findByText("Base")).toBeInTheDocument();
    expect(screen.getByText("Derived")).toBeInTheDocument();
  });

  it("truncates only long slots in the decompiled panel (short slot stays whole)", async () => {
    stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: {
          ok: true,
          decompiled: {
            slots: [
              {
                slot: "0x2", // <= 14 chars → truncateSlot returns it unchanged
                name: "counter",
                inferredType: "uint256",
                access: ["sload"],
              },
            ],
            pseudoSource: null,
          },
        },
      },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    // The short slot renders verbatim (no "…" ellipsis in the slot cell).
    expect(await screen.findByText("0x2")).toBeInTheDocument();
  });

  it("swallows a thrown slot read in the decompiled panel (handleRead catch)", async () => {
    stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: {
          ok: true,
          decompiled: {
            slots: [
              { slot: "0x5", name: "x", inferredType: "uint256", access: ["sload"] },
            ],
            pseudoSource: null,
          },
        },
      },
      { match: (url) => url.includes("eth_getStorageAt"), throws: true },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    fireEvent.click(await screen.findByText("x"));
    // handleRead catch → slotValue stays null, the slot is selected but no value.
    await waitFor(() =>
      expect(screen.queryByText("Current Value")).not.toBeInTheDocument(),
    );
  });

  it("re-syncs the address input when ?address changes after mount", async () => {
    const OTHER = "0x1111111111111111111111111111111111111111";
    stubFetch([
      { match: (url) => url.includes("/storage-layout"), body: { ok: true, storageLayout: simpleLayout() } },
    ]);
    // A sibling control flips the ?address query while the viewer stays mounted,
    // so the effect's `fromUrl !== contractAddress` branch runs and syncs.
    renderWithProviders(<Harness other={OTHER} />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });
    const input = (await screen.findByPlaceholderText(
      /0x\.\.\. contract address/i,
    )) as HTMLInputElement;
    expect(input.value).toBe(ADDRESS);

    fireEvent.click(screen.getByRole("button", { name: "swap-address" }));
    await waitFor(() => expect(input.value).toBe(OTHER));
  });
});

function Harness({ other }: { other: string }) {
  const [params, setParams] = useSearchParams();
  return (
    <>
      <button onClick={() => setParams({ address: other })}>swap-address</button>
      <span data-testid="cur">{params.get("address")}</span>
      <StorageLayoutViewer />
    </>
  );
}
