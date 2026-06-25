import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import VerifyContract from "../components/VerifyContract";

/**
 * Supplemental VerifyContract coverage — the network-throw catch branch and
 * the in-flight StatusBadge copy ("Forwarding to Sourcify…"). Base flow lives
 * in VerifyContract.test.tsx.
 */

const ADDRESS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const STANDARD_JSON = JSON.stringify({
  language: "Solidity",
  sources: { "Foo.sol": { content: "contract Foo {}" } },
  settings: {},
});

function renderForm() {
  return render(
    <MemoryRouter initialEntries={[`/verify?address=${ADDRESS}`]}>
      <VerifyContract />
    </MemoryRouter>,
  );
}

function fill() {
  const sourceTextarea = document.querySelector("textarea") as HTMLTextAreaElement;
  fireEvent.change(sourceTextarea, { target: { value: STANDARD_JSON } });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("VerifyContract — extra branches", () => {
  it("edits the address and compiler-version fields", () => {
    render(
      <MemoryRouter initialEntries={["/verify"]}>
        <VerifyContract />
      </MemoryRouter>,
    );
    const addr = screen.getByPlaceholderText("0x…") as HTMLInputElement;
    fireEvent.change(addr, { target: { value: ADDRESS } });
    expect(addr.value).toBe(ADDRESS);

    const compiler = screen.getByDisplayValue(/v0\.8\.20\+commit/) as HTMLInputElement;
    fireEvent.change(compiler, { target: { value: "v0.8.24+commit.e11b9ed9" } });
    expect(compiler.value).toBe("v0.8.24+commit.e11b9ed9");
  });

  it("shows a failure with the thrown error message when the submit fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unreachable"));
    renderForm();
    fill();
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/ }));
    await waitFor(() =>
      expect(screen.getByText(/Verification failed/)).toBeInTheDocument(),
    );
    expect(screen.getByText("network unreachable")).toBeInTheDocument();
  });

  it("shows the in-flight 'Forwarding to Sourcify…' badge while submitting", async () => {
    let resolveSubmit: (v: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => (resolveSubmit = resolve)),
    );
    renderForm();
    fill();
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));

    expect(await screen.findByText(/Forwarding to Sourcify/)).toBeInTheDocument();
    // Button label flips to "Submitting…"
    expect(screen.getByRole("button", { name: /Submitting/ })).toBeInTheDocument();

    // Resolve to let the component settle.
    resolveSubmit({
      ok: true,
      status: 200,
      json: async () => ({ status: "0", result: "rejected" }),
    } as Response);
    await waitFor(() =>
      expect(screen.getByText(/Verification failed/)).toBeInTheDocument(),
    );
  });
});
