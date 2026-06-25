import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type {
  StorageLayout,
  StorageLayoutResponse,
} from "../components/StorageLayoutViewer/types";

/**
 * Supplemental StorageLayoutViewer coverage — exercises branches the base
 * StorageLayoutViewer.test.tsx leaves uncovered: the not-verified error
 * message, the dynamic-array inspector, the simple-variable "Read Current
 * Value" button, and the heimdall-decompiled fall-through panel (banner,
 * slot rows, known-label, empty list, pseudo-source, slot read).
 *
 * Fixture: WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 (PulseChain 369)
 * https://scan.pulsechain.com/address/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

import StorageLayoutViewer from "../components/StorageLayoutViewer";

const ADDRESS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

interface Route {
  match: (url: string) => boolean;
  body: unknown;
  ok?: boolean;
}

function stubFetch(routes: Route[]): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: unknown) => {
    const url = String(input);
    const route = routes.find((r) => r.match(url));
    if (!route) throw new Error(`Unrouted: ${url}`);
    return {
      ok: route.ok ?? true,
      status: route.ok === false ? 404 : 200,
      json: async () => route.body,
    } as Response;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(spy as unknown as typeof fetch);
  return spy;
}

function arrayLayout(): StorageLayout {
  return {
    storage: [
      { label: "owner", slot: "0", offset: 0, type: "t_address", contract: "Token" },
      { label: "holders", slot: "1", offset: 0, type: "t_array", contract: "Token" },
    ],
    types: {
      t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
      t_array: {
        encoding: "dynamic_array",
        label: "address[]",
        numberOfBytes: "32",
        base: "t_address",
      },
    },
  };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("<StorageLayoutViewer /> — extra branches", () => {
  it("shows the backend error message when the layout response is not ok", async () => {
    stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: { ok: false, error: "Contract source not verified" } as StorageLayoutResponse,
      },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });
    expect(
      await screen.findByText(/Contract source not verified/i),
    ).toBeInTheDocument();
  });

  it("reads the on-chain value for a simple variable via the Read button", async () => {
    const spy = stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: { ok: true, storageLayout: arrayLayout() },
      },
      {
        match: (url) => url.includes("eth_getStorageAt"),
        body: { result: "0x" + "00".repeat(31) + "2a" }, // 42
      },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    fireEvent.click(await screen.findByText("owner"));
    fireEvent.click(await screen.findByRole("button", { name: /Read Current Value/ }));

    await waitFor(() =>
      expect(
        spy.mock.calls.some(([u]) => String(u).includes("eth_getStorageAt")),
      ).toBe(true),
    );
    // Decoded decimal of 0x..2a is 42
    expect(await screen.findByText(/Decimal: 42/)).toBeInTheDocument();
  });

  it("renders the dynamic-array index input and resolves the slot", async () => {
    const spy = stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: { ok: true, storageLayout: arrayLayout() },
      },
      {
        match: (url) => url.includes("eth_getStorageAt"),
        body: { result: "0x" + "00".repeat(32) },
      },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    fireEvent.click(await screen.findByText(/holders/));
    const idxInput = await screen.findByPlaceholderText("0");
    fireEvent.change(idxInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /^Read$/ }));

    await waitFor(() =>
      expect(
        spy.mock.calls.some(([u]) => String(u).includes("eth_getStorageAt")),
      ).toBe(true),
    );
  });

  it("renders the heimdall-decompiled panel with known + unknown slots", async () => {
    stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: {
          ok: true,
          decompiled: {
            slots: [
              {
                slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
                name: null,
                inferredType: "address",
                access: ["sload", "sstore"],
                known: { label: "EIP-1967 impl", hint: "implementation slot" },
              },
              {
                slot: "0x2",
                name: "counter",
                inferredType: "uint256",
                access: ["sload"],
              },
            ],
            pseudoSource: "function impl() { ... }",
          },
        },
      },
      {
        match: (url) => url.includes("eth_getStorageAt"),
        body: { result: "0x" + "00".repeat(31) + "07" },
      },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });

    expect(await screen.findByText(/Inferred Storage Slots/)).toBeInTheDocument();
    expect(screen.getByText("INFERRED")).toBeInTheDocument();
    expect(screen.getByText("EIP-1967 impl")).toBeInTheDocument();
    expect(screen.getByText("counter")).toBeInTheDocument();
    // pseudo-source visible until a slot is selected
    expect(screen.getByText(/function impl/)).toBeInTheDocument();

    // Click a slot row → read value
    fireEvent.click(screen.getByText("counter"));
    expect(await screen.findByText(/Decimal: 7/)).toBeInTheDocument();
  });

  it("typing a new address resets the selected entry", async () => {
    stubFetch([
      { match: (url) => url.includes("/storage-layout"), body: { ok: true, storageLayout: arrayLayout() } },
      { match: (url) => url.includes("eth_getStorageAt"), body: { result: "0x00" } },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });
    fireEvent.click(await screen.findByText("owner"));
    // Inspector populated
    expect(await screen.findByText("Computed Slot")).toBeInTheDocument();
    // Re-typing the address input clears the selection (setSelectedEntry(null)).
    const addrInput = screen.getByPlaceholderText(/0x\.\.\. contract address/i);
    fireEvent.change(addrInput, { target: { value: "0x1234" } });
    await waitFor(() =>
      expect(screen.queryByText("Computed Slot")).not.toBeInTheDocument(),
    );
  });

  it("pressing Enter in the mapping-key input reads the slot", async () => {
    const mappingLayout = {
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
    const spy = stubFetch([
      { match: (url) => url.includes("/storage-layout"), body: { ok: true, storageLayout: mappingLayout } },
      { match: (url) => url.includes("eth_getStorageAt"), body: { result: "0x" + "00".repeat(31) + "01" } },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });
    fireEvent.click(await screen.findByText(/balances/));
    const keyInput = await screen.findByPlaceholderText(/0x\.\.\. or number/i);
    fireEvent.change(keyInput, { target: { value: "1" } });
    fireEvent.keyDown(keyInput, { key: "Enter" });
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([u]) => String(u).includes("eth_getStorageAt")),
      ).toBe(true),
    );
  });

  it("renders the empty-slots message in the decompiled panel", async () => {
    stubFetch([
      {
        match: (url) => url.includes("/storage-layout"),
        body: {
          ok: true,
          decompiled: { slots: [], pseudoSource: null },
        },
      },
    ]);
    renderWithProviders(<StorageLayoutViewer />, {
      initialEntries: [`/?address=${ADDRESS}`],
    });
    expect(
      await screen.findByText(/No constant slot accesses found/i),
    ).toBeInTheDocument();
    // No pseudo-source → placeholder copy
    expect(
      screen.getByText(/Click a row to inspect the slot/i),
    ).toBeInTheDocument();
  });
});
