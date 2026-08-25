import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RpcAlternatives } from "../components/settings/RpcAlternatives";
import type { RpcChoice } from "../lib/rpcSuggestions";

/**
 * The suggestion list, and the rule that we never state as measured what we
 * only have on a provider's word.
 */
const CHOICES: RpcChoice[] = [
  { url: "https://one.valve.city/rpc/vk_demo/evm/369", tracking: "none", isValve: true },
  { url: "https://pulsechain-rpc.publicnode.com", tracking: "none", isValve: false },
];

/** Answer the archive probe per URL: archive for Valve, pruned for the rest. */
function stubProbe() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            url.includes("valve.city")
              ? { result: "0x0" }
              : { error: { code: -32000, message: "missing trie node" } },
          ),
      }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("<RpcAlternatives />", () => {
  it("calls nothing on mount", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<RpcAlternatives choices={CHOICES} effective={CHOICES[0]!.url} onPick={vi.fn()} />);
    // Probing on render would open a connection to every third party on the
    // list the moment someone opened Settings. The button is the consent.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the no-log claim is the provider's until Test is pressed", () => {
    render(<RpcAlternatives choices={CHOICES} effective={undefined} onPick={vi.fn()} />);
    expect(screen.getByText(/their claim, not our measurement/)).toBeInTheDocument();
  });

  it("reports how many endpoints can actually read history", async () => {
    stubProbe();
    render(<RpcAlternatives choices={CHOICES} effective={undefined} onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() =>
      expect(
        screen.getByText(/1 of 2 can read state at block 1/),
      ).toBeInTheDocument(),
    );
  });

  it("labels the endpoint that refused history, and leaves the other alone", async () => {
    stubProbe();
    render(<RpcAlternatives choices={CHOICES} effective={undefined} onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    const pruned = await screen.findByRole("button", { name: /recent blocks only/ });
    expect(pruned.className).toContain("line-through");
    expect(screen.getByRole("button", { name: "Valve" }).className).not.toContain(
      "line-through",
    );
  });

  it("still lets the user pick a struck-off endpoint", async () => {
    // Their node, their call — a recent-only node is a fine choice for
    // someone reading latest state. The verdict informs; it does not forbid.
    stubProbe();
    const onPick = vi.fn();
    render(<RpcAlternatives choices={CHOICES} effective={undefined} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    const pruned = await screen.findByRole("button", { name: /recent blocks only/ });
    fireEvent.click(pruned);
    expect(onPick).toHaveBeenCalledWith(CHOICES[1]!.url);
  });

  it("renders nothing when there is nothing to suggest", () => {
    const { container } = render(
      <RpcAlternatives choices={[]} effective={undefined} onPick={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
