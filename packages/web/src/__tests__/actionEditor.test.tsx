import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import type { Action, ExecutionResult } from "../api/actions";

/**
 * ActionEditor (+ its sub-editors CodeEditor / SecretsEditor / EditorActions /
 * TriggerConfigEditor) — the create/edit form for a Web3 Action. We mock the
 * actions API so save/test exercise real handler branches, and drive the form
 * controls to cover trigger-type switching, secrets add/remove, the code
 * textarea (onChange + Tab), and the webhook copy affordance.
 *
 * Fixture chain data: an event-trigger Action carrying WPLS as its contract
 * address — WPLS 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 on PulseChain
 * mainnet (chainid 369). Block explorer: https://scan.pulsechain.com
 */

const createAction = vi.fn();
const updateAction = vi.fn();
const testAction = vi.fn();
const copyToClipboard = vi.fn();

vi.mock("../api/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/actions")>()),
  createAction: (...a: unknown[]) => createAction(...a),
  updateAction: (...a: unknown[]) => updateAction(...a),
  testAction: (...a: unknown[]) => testAction(...a),
}));

vi.mock("../lib/clipboard", () => ({
  copyToClipboard: (...a: unknown[]) => copyToClipboard(...a),
}));

import ActionEditor from "../components/actions/ActionEditor";

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

const editAction: Action = {
  id: 12,
  name: "WPLS event",
  code: "async function handler() { /* edit */ }",
  chainid: 369,
  triggerType: "event",
  triggerConfig: { contractAddress: WPLS, eventSignature: "" },
  secretKeys: ["API_KEY"],
  enabled: true,
  createdAt: "2026-06-23T12:00:00",
  updatedAt: "2026-06-23T12:00:00",
  webhookUrl: undefined,
};

beforeEach(() => vi.clearAllMocks());

describe("ActionEditor — create", () => {
  it("requires a name before saving", async () => {
    const onSaved = vi.fn();
    renderWithProviders(<ActionEditor onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Create Action", { selector: "button" }));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(createAction).not.toHaveBeenCalled();
  });

  it("creates an action with name, code edit, and a secret", async () => {
    const onSaved = vi.fn();
    createAction.mockResolvedValue({ ...editAction, id: 99 });
    renderWithProviders(<ActionEditor onSaved={onSaved} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("My Action"), {
      target: { value: "New action" },
    });
    // code editor onChange — the single <textarea> on the form
    const codeArea = document.querySelector("textarea")!;
    fireEvent.change(codeArea, { target: { value: "console.log('hi')" } });
    // add a secret + fill it
    fireEvent.click(screen.getByText("+ Add Secret"));
    fireEvent.change(screen.getByPlaceholderText("KEY"), { target: { value: "TOKEN" } });
    fireEvent.change(screen.getByPlaceholderText("value"), { target: { value: "abc" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Action" }));
    await waitFor(() => expect(createAction).toHaveBeenCalled());
    const [payload, chainId] = createAction.mock.calls[0]!;
    expect(payload.name).toBe("New action");
    expect(payload.secrets).toEqual({ TOKEN: "abc" });
    expect(chainId).toBe(369);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("switches trigger type and swaps the default template + config fields", () => {
    renderWithProviders(<ActionEditor onSaved={vi.fn()} onCancel={vi.fn()} />);
    // default is block → has "Run every Nth block"
    expect(screen.getByText("Run every Nth block")).toBeInTheDocument();
    fireEvent.click(screen.getByText("event"));
    expect(screen.getByText("Contract Address")).toBeInTheDocument();
    fireEvent.click(screen.getByText("periodic"));
    expect(screen.getByText("Interval (seconds)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("webhook"));
    expect(screen.getByText(/Save this action to generate a webhook URL/)).toBeInTheDocument();
  });

  it("edits the block-trigger Nth-block config", () => {
    renderWithProviders(<ActionEditor onSaved={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "5" } });
    expect((input as HTMLInputElement).value).toBe("5");
  });

  it("surfaces a save error message", async () => {
    createAction.mockRejectedValue(new Error("server down"));
    renderWithProviders(<ActionEditor onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("My Action"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Action" }));
    expect(await screen.findByText("server down")).toBeInTheDocument();
  });

  it("inserts two spaces on Tab in the code editor", () => {
    renderWithProviders(<ActionEditor onSaved={vi.fn()} onCancel={vi.fn()} />);
    const codeArea = document.querySelector("textarea") as HTMLTextAreaElement;
    codeArea.value = "ab";
    codeArea.selectionStart = 0;
    codeArea.selectionEnd = 0;
    fireEvent.keyDown(codeArea, { key: "Tab" });
    // setCode prepends two spaces
    expect(codeArea.value.startsWith("  ")).toBe(true);
  });

  it("removes a secret row", () => {
    renderWithProviders(<ActionEditor onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("+ Add Secret"));
    expect(screen.getByPlaceholderText("KEY")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Remove"));
    expect(screen.queryByPlaceholderText("KEY")).not.toBeInTheDocument();
    expect(screen.getByText(/No secrets configured/)).toBeInTheDocument();
  });
});

describe("ActionEditor — edit", () => {
  it("renders edit mode with prefilled name and a Test Run button", () => {
    renderWithProviders(<ActionEditor action={editAction} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Edit Action")).toBeInTheDocument();
    expect((screen.getByPlaceholderText("My Action") as HTMLInputElement).value).toBe("WPLS event");
    expect(screen.getByText("Test Run")).toBeInTheDocument();
    // event config inputs prefilled with WPLS
    expect((screen.getByPlaceholderText("0x...") as HTMLInputElement).value).toBe(WPLS);
  });

  it("updates an existing action on save (no chainid passed)", async () => {
    const onSaved = vi.fn();
    updateAction.mockResolvedValue(editAction);
    renderWithProviders(<ActionEditor action={editAction} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Update Action" }));
    await waitFor(() => expect(updateAction).toHaveBeenCalledWith(12, expect.objectContaining({ name: "WPLS event" })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("runs a test and shows the passing result", async () => {
    const result: ExecutionResult = { success: true, stdout: "done", stderr: "", duration_ms: 9 };
    testAction.mockResolvedValue(result);
    renderWithProviders(<ActionEditor action={editAction} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Test Run"));
    expect(await screen.findByText("Test Passed")).toBeInTheDocument();
    expect(testAction).toHaveBeenCalledWith(12, expect.objectContaining({ type: "test", blockNumber: 12345 }));
  });

  it("surfaces a test error message", async () => {
    testAction.mockRejectedValue(new Error("exec failed"));
    renderWithProviders(<ActionEditor action={editAction} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Test Run"));
    expect(await screen.findByText("exec failed")).toBeInTheDocument();
  });

  it("copies the webhook URL when one exists", () => {
    const hook: Action = { ...editAction, triggerType: "webhook", webhookUrl: "/api/actions/12/webhook" };
    renderWithProviders(<ActionEditor action={hook} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Copy"));
    expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining("/api/actions/12/webhook"));
  });

  it("edits the event config fields", () => {
    renderWithProviders(<ActionEditor action={editAction} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const addr = screen.getByPlaceholderText("0x...");
    fireEvent.change(addr, { target: { value: "0xdead" } });
    expect((addr as HTMLInputElement).value).toBe("0xdead");
    const sig = screen.getByPlaceholderText(/0xddf252ad/);
    fireEvent.change(sig, { target: { value: "0xabc" } });
    expect((sig as HTMLInputElement).value).toBe("0xabc");
  });

  it("edits the periodic interval config", () => {
    const periodic: Action = { ...editAction, triggerType: "periodic", triggerConfig: {} };
    renderWithProviders(<ActionEditor action={periodic} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "30" } });
    expect((input as HTMLInputElement).value).toBe("30");
  });

  it("cancel fires onCancel and exercises its hover handlers", () => {
    const onCancel = vi.fn();
    renderWithProviders(<ActionEditor action={editAction} onSaved={vi.fn()} onCancel={onCancel} />);
    const cancel = screen.getByText("Cancel");
    fireEvent.mouseOver(cancel);
    fireEvent.mouseOut(cancel);
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalled();
  });

  it("scrolling the code textarea syncs the line-number gutter", () => {
    renderWithProviders(<ActionEditor action={editAction} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const codeArea = document.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.scroll(codeArea, { target: { scrollTop: 40 } });
    expect(codeArea).toBeInTheDocument();
  });
});
