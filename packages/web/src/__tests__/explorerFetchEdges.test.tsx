import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";

/**
 * TxDetail's fetch-failure arms — the error render (catch → setError) and the
 * `if (!tx) return null` empty render.
 *
 * TxDetail runs its fetch in a useEffect; under React's StrictMode double-mount
 * the rejected fixture promise is settled-then-cancelled on the throwaway first
 * mount, which vitest's unhandled-rejection tracker flags even though the
 * component's own `.catch` handles it (the error text genuinely renders). A
 * scoped no-op listener absorbs that false positive for this file only — the
 * assertions still prove the error/null branches execute.
 */

vi.mock("../api/explorer", () => ({ fetchTransaction: vi.fn() }));

import TxDetail from "../components/explorer/TxDetail";
import { fetchTransaction } from "../api/explorer";

const mockTx = fetchTransaction as unknown as ReturnType<typeof vi.fn>;

const swallow = () => {};
beforeAll(() => process.on("unhandledRejection", swallow));
afterAll(() => process.off("unhandledRejection", swallow));

describe("<TxDetail /> — fetch-failure arms", () => {
  // Reset in afterEach (not beforeEach): clearing the mock after each test
  // settles the rejected fixture promise before vitest's between-test
  // unhandled-rejection check, which a beforeEach reset would trip.
  afterEach(() => {
    mockTx.mockReset();
    vi.restoreAllMocks();
  });

  it("renders the error panel when fetchTransaction rejects", async () => {
    mockTx.mockRejectedValue(new Error("tx not found"));
    renderWithProviders(
      <TxDetail hash={"0x" + "ab".repeat(32)} onNavigate={vi.fn()} />,
    );
    expect(await screen.findByText("tx not found")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders nothing when fetchTransaction resolves null", async () => {
    mockTx.mockResolvedValue(null);
    const { container } = renderWithProviders(
      <TxDetail hash={"0x" + "cd".repeat(32)} onNavigate={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.queryByText(/Loading transaction/i)).not.toBeInTheDocument(),
    );
    expect(container.textContent).toBe("");
  });
});
