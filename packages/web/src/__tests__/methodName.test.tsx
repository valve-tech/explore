import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { MethodName } from "../components/explorer/MethodName";

/**
 * A method name resolved through 4byte is often a guess. The directory holds
 * every signature anyone registered, so one selector routinely carries
 * several. These tests pin the two halves of the fix: a settled name reads as
 * plain text, and a name still in doubt is marked and reveals its
 * alternatives on hover.
 *
 * `ijekfhacdgb` is the real first candidate production returns for selector
 * 0x00000012 on chain 1 — a gas-token-era name someone brute-forced so its
 * selector had leading zero bytes.
 *
 * `candidates` counts the candidates still IN DOUBT, not 4byte registrations.
 * Marking on the raw count marked 77% of named Ethereum rows and every one of
 * them was `transfer`, `transferFrom`, or a Uniswap V2 swap — see
 * `services/signatures/vouched.ts`. The component's threshold never moved;
 * the number feeding it did.
 */
vi.mock("../api/signatures", () => ({
  lookupSignature: vi.fn(),
}));

import { lookupSignature } from "../api/signatures";

const mockLookup = lookupSignature as ReturnType<typeof vi.fn>;

function candidates(...names: string[]) {
  return names.map((textSignature) => ({
    selector: "0x00000012",
    textSignature,
    sigType: "function" as const,
  }));
}

beforeEach(() => {
  mockLookup.mockReset();
  mockLookup.mockResolvedValue(
    candidates("ijekfhacdgb()", "uncheckedIncrement(uint256)", "nine_hundred()"),
  );
});

describe("<MethodName />", () => {
  it("shows a settled name as plain text", () => {
    // 4byte holds SIX signatures for 0xa9059cbb, five of them mined spam. The
    // server vouches for the ERC-20 one and sends 1, so the most common call
    // on Ethereum reads as a fact — which is what it is.
    renderWithProviders(
      <MethodName label="transfer(address,uint256)" selector="0xa9059cbb" candidates={1} />,
    );
    expect(screen.getByText("transfer(address,uint256)")).toBeInTheDocument();
    // Nothing extra to read past: no count, no caveat.
    expect(screen.queryByText(/candidate signatures/)).not.toBeInTheDocument();
    expect(screen.queryByText("6")).not.toBeInTheDocument();
  });

  it("shows an unresolved selector (0 candidates) as plain text too", () => {
    renderWithProviders(<MethodName label="0xa9059cbb" selector="0xa9059cbb" candidates={0} />);
    expect(screen.queryByText(/candidate signatures/)).not.toBeInTheDocument();
  });

  it("does not mark a row whose cached response predates the count", () => {
    // TanStack Query persists responses to IndexedDB with staleTime: Infinity,
    // so a browser can hand this component a row with no count at all.
    renderWithProviders(
      <MethodName
        label="transfer(address,uint256)"
        selector="0xa9059cbb"
        candidates={undefined as unknown as number}
      />,
    );
    expect(screen.getByText("transfer(address,uint256)")).toBeInTheDocument();
    expect(screen.queryByText(/candidate signatures/)).not.toBeInTheDocument();
  });

  it("marks a name that came from several candidates, and says how many", () => {
    renderWithProviders(
      <MethodName label="ijekfhacdgb()" selector="0x00000012" candidates={3} />,
    );
    expect(screen.getByText("ijekfhacdgb()")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // The caveat reaches a reader who cannot hover.
    expect(
      screen.getByText(/one of 3 candidate signatures for 0x00000012/),
    ).toBeInTheDocument();
  });

  it("fetches nothing until the reader hovers", () => {
    renderWithProviders(
      <MethodName label="ijekfhacdgb()" selector="0x00000012" candidates={3} />,
    );
    // The whole reason the list is off the wire: one integer per row costs
    // nothing, and the signatures behind it cost nothing until someone asks.
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("lists the alternatives on hover, marking the one shown", async () => {
    renderWithProviders(
      <MethodName label="ijekfhacdgb()" selector="0x00000012" candidates={3} />,
    );
    fireEvent.mouseEnter(screen.getByText("ijekfhacdgb()").parentElement!);

    await waitFor(() => expect(mockLookup).toHaveBeenCalledWith("0x00000012"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("3 signatures share 0x00000012");
    expect(tooltip).toHaveTextContent("uncheckedIncrement(uint256)");
    expect(tooltip).toHaveTextContent("shown");
  });

  it("says so when the alternatives cannot be loaded", async () => {
    mockLookup.mockRejectedValue(new Error("offline"));
    renderWithProviders(
      <MethodName label="ijekfhacdgb()" selector="0x00000012" candidates={3} />,
    );
    fireEvent.mouseEnter(screen.getByText("ijekfhacdgb()").parentElement!);

    const tooltip = await screen.findByRole("tooltip");
    await waitFor(() =>
      expect(tooltip).toHaveTextContent("Could not load the alternatives."),
    );
  });

  it("caps the list and counts the remainder", async () => {
    mockLookup.mockResolvedValue(
      candidates(...Array.from({ length: 12 }, (_, i) => `mined_${i}()`)),
    );
    renderWithProviders(
      <MethodName label="mined_0()" selector="0x00000012" candidates={12} />,
    );
    fireEvent.mouseEnter(screen.getByText("mined_0()").parentElement!);

    const tooltip = await screen.findByRole("tooltip");
    await waitFor(() => expect(tooltip).toHaveTextContent("+4 more"));
    expect(tooltip).not.toHaveTextContent("mined_11()");
  });
});
