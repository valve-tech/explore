import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorActions } from "../components/actions/ActionEditor/EditorActions";
import { SecretsEditor } from "../components/actions/ActionEditor/SecretsEditor";
import { TriggerConfigEditor } from "../components/actions/ActionEditor/TriggerConfigEditor";

/**
 * Supplemental coverage for ActionEditor sub-bits not reached by
 * actionsEditorBits.test.tsx: EditorActions in saving/testing states (and its
 * hover handlers), SecretsEditor add/remove hover handlers, and
 * TriggerConfigEditor's webhook-missing branch. Kept separate so the original
 * actionsEditorBits.test.tsx stays untouched.
 *
 * Trigger types are block/event/periodic/webhook. Chain explorer:
 * https://scan.pulsechain.com
 */

describe("EditorActions", () => {
  it("renders the create label and fires onSave + hover handlers", () => {
    const onSave = vi.fn();
    render(<EditorActions isEdit={false} saving={false} testing={false} onSave={onSave} onTest={vi.fn()} />);
    const save = screen.getByRole("button", { name: "Create Action" });
    fireEvent.mouseOver(save);
    fireEvent.mouseOut(save);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalled();
    // not edit → no Test Run button
    expect(screen.queryByText("Test Run")).not.toBeInTheDocument();
  });

  it("shows Saving… and skips the hover recolor while saving", () => {
    render(<EditorActions isEdit={true} saving={true} testing={false} onSave={vi.fn()} onTest={vi.fn()} />);
    const save = screen.getByRole("button", { name: "Saving..." });
    fireEvent.mouseOver(save); // guarded by !saving
    fireEvent.mouseOut(save);
    expect(save).toBeDisabled();
  });

  it("edit mode renders Test Run with hover handlers and fires onTest", () => {
    const onTest = vi.fn();
    render(<EditorActions isEdit={true} saving={false} testing={false} onSave={vi.fn()} onTest={onTest} />);
    const test = screen.getByRole("button", { name: "Test Run" });
    fireEvent.mouseOver(test);
    fireEvent.mouseOut(test);
    fireEvent.click(test);
    expect(onTest).toHaveBeenCalled();
  });

  it("shows Running… and disables Test while testing", () => {
    render(<EditorActions isEdit={true} saving={false} testing={true} onSave={vi.fn()} onTest={vi.fn()} />);
    const test = screen.getByRole("button", { name: "Running..." });
    fireEvent.mouseOver(test); // guarded by !testing
    fireEvent.mouseOut(test);
    expect(test).toBeDisabled();
  });
});

describe("SecretsEditor", () => {
  it("add-secret button hover handlers fire", () => {
    const setSecrets = vi.fn();
    render(<SecretsEditor secrets={[]} setSecrets={setSecrets} />);
    const add = screen.getByText("+ Add Secret");
    fireEvent.mouseOver(add);
    fireEvent.mouseOut(add);
    fireEvent.click(add);
    expect(setSecrets).toHaveBeenCalledWith([{ key: "", value: "" }]);
  });

  it("remove button hover handlers + key/value edits fire setSecrets", () => {
    const setSecrets = vi.fn();
    render(<SecretsEditor secrets={[{ key: "API_KEY", value: "x" }]} setSecrets={setSecrets} />);
    fireEvent.change(screen.getByPlaceholderText("KEY"), { target: { value: "K2" } });
    fireEvent.change(screen.getByPlaceholderText("value"), { target: { value: "v2" } });
    const remove = screen.getByText("Remove");
    fireEvent.mouseOver(remove);
    fireEvent.mouseOut(remove);
    fireEvent.click(remove);
    expect(setSecrets).toHaveBeenCalled();
  });
});

describe("TriggerConfigEditor", () => {
  it("renders the webhook 'save first' hint when no URL exists", () => {
    render(
      <TriggerConfigEditor
        triggerType="webhook"
        triggerConfig={{}}
        setTriggerConfig={vi.fn()}
        webhookUrl={undefined}
      />,
    );
    expect(screen.getByText(/Save this action to generate a webhook URL/)).toBeInTheDocument();
  });

  it("renders the webhook copy row + hover handlers when a URL exists", () => {
    render(
      <TriggerConfigEditor
        triggerType="webhook"
        triggerConfig={{}}
        setTriggerConfig={vi.fn()}
        webhookUrl="/api/actions/1/webhook"
      />,
    );
    const copy = screen.getByText("Copy");
    fireEvent.mouseOver(copy);
    fireEvent.mouseOut(copy);
    expect(copy).toBeInTheDocument();
  });
});
