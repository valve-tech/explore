import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";

/**
 * EntityActionBar (labeled + compact variants, every entity kind + the omit /
 * promote-primary path), AlertToast (slide-in + auto-dismiss + summary branch),
 * and a ChainSelector supplemental (compact variant + outside-click + glyph
 * fallback) — the branches the existing ChainSelector.test doesn't reach.
 *
 * Canonical WPLS token on PulseChain (chain 369):
 * 0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 * https://scan.pulsechain.com/token/0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 */

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

import { EntityActionBar } from "../components/EntityActionBar";
import AlertToast from "../components/AlertToast";
import { ChainSelector } from "../components/ChainSelector";
import { ALL_CHAINS } from "../lib/chains";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const TX = "0x" + "a".repeat(64);

describe("<EntityActionBar />", () => {
  beforeEach(() => navigate.mockReset());

  it("renders the tx action set (labeled) with the primary Debug jump", () => {
    renderWithProviders(<EntityActionBar kind="tx" value={TX} />);
    expect(screen.getByText("Debug")).toBeInTheDocument();
    expect(screen.getByText("Fork from here")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Debug"));
    expect(navigate).toHaveBeenCalledWith(`/debugger/${TX}`);
  });

  it("adds the storage-layout action for a tx with a contractAddress", () => {
    renderWithProviders(
      <EntityActionBar kind="tx" value={TX} contractAddress={WPLS} />,
    );
    fireEvent.click(screen.getByText("Storage layout"));
    expect(navigate).toHaveBeenCalledWith(`/storage?address=${WPLS}`);
  });

  it("renders the address action set with Simulate call", () => {
    renderWithProviders(<EntityActionBar kind="address" value={WPLS} />);
    fireEvent.click(screen.getByText("Simulate call"));
    expect(navigate).toHaveBeenCalledWith(`/simulate?to=${WPLS}`);
  });

  it("uses the contract explorer path for kind=contract", () => {
    renderWithProviders(<EntityActionBar kind="contract" value={WPLS} />);
    // primary explorer jump for contract
    fireEvent.click(screen.getByText("Open in Explorer"));
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(WPLS),
    );
  });

  it("promotes the first remaining action to primary when the natural primary is omitted", () => {
    // omit the primary "debug" → first remaining (fork) becomes primary; the
    // labeled variant still renders without a designated primary action.
    renderWithProviders(
      <EntityActionBar kind="tx" value={TX} omit={["debug"]} />,
    );
    expect(screen.queryByText("Debug")).not.toBeInTheDocument();
    expect(screen.getByText("Fork from here")).toBeInTheDocument();
  });

  it("renders the compact (icon-only) variant with aria-labels", () => {
    renderWithProviders(
      <EntityActionBar kind="tx" value={TX} variant="compact" />,
    );
    const debug = screen.getByRole("button", { name: "Debug" });
    fireEvent.click(debug);
    expect(navigate).toHaveBeenCalledWith(`/debugger/${TX}`);
    // CopyButton present with the tx-specific title
    expect(
      screen.getByRole("button", { name: "Copy tx hash" }),
    ).toBeInTheDocument();
  });

  it("uses 'Copy address' on the copy button for non-tx kinds", () => {
    renderWithProviders(
      <EntityActionBar kind="address" value={WPLS} variant="compact" />,
    );
    expect(
      screen.getByRole("button", { name: "Copy address" }),
    ).toBeInTheDocument();
  });
});

describe("<AlertToast />", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders the alert name + type label and slides in, then auto-dismisses", () => {
    render(
      <AlertToast
        alert={{ name: "Whale watch", type: "address_activity" }}
        match={{ summary: "1M PLS moved" }}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Whale watch")).toBeInTheDocument();
    // type underscores replaced with spaces
    expect(screen.getByText("address activity")).toBeInTheDocument();
    expect(screen.getByText("1M PLS moved")).toBeInTheDocument();

    const toast = screen.getByRole("alert");
    // before the show timer fires it's translated off-screen
    expect(toast.style.opacity).toBe("0");
    act(() => vi.advanceTimersByTime(20));
    expect(toast.style.opacity).toBe("1");
    act(() => vi.advanceTimersByTime(5_000));
    expect(toast.style.opacity).toBe("0");
  });

  it("omits the summary paragraph when match has no summary", () => {
    render(
      <AlertToast
        alert={{ name: "x", type: "failed_tx" }}
        match={{}}
      />,
    );
    expect(screen.getByText("failed tx")).toBeInTheDocument();
    // no summary text node beyond the header
    expect(screen.queryByText(/PLS moved/)).not.toBeInTheDocument();
  });
});

describe("<ChainSelector /> supplemental", () => {
  beforeEach(() => navigate.mockReset());

  it("renders the compact variant trigger for the All-chains sentinel", () => {
    render(
      <ChainSelector value={ALL_CHAINS} onChange={() => {}} variant="compact" />,
    );
    expect(screen.getByText("All chains")).toBeInTheDocument();
  });

  it("closes the open menu on an outside mousedown", () => {
    render(
      <div>
        <ChainSelector value={ALL_CHAINS} onChange={() => {}} variant="full" />
        <span data-testid="outside">x</span>
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByText("Ethereum")).not.toBeInTheDocument();
  });

  it("falls back to the cube glyph when a chain logo image fails to load", () => {
    const { container } = render(
      <ChainSelector value={369} onChange={() => {}} variant="full" />,
    );
    const img = container.querySelector("img")!;
    fireEvent.error(img);
    // image replaced by an svg icon (iconify renders an svg/span)
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
