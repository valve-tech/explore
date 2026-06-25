import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TriggerTypePicker } from "../components/actions/ActionEditor/TriggerTypePicker";
import { TestResultPanel } from "../components/actions/ActionEditor/TestResultPanel";
import type { ExecutionResult } from "../api/actions";

describe("TriggerTypePicker", () => {
  it("renders a button per trigger type and fires onChange", () => {
    const onChange = vi.fn();
    render(<TriggerTypePicker triggerType="block" onChange={onChange} />);
    for (const t of ["block", "event", "periodic", "webhook"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText("webhook"));
    expect(onChange).toHaveBeenCalledWith("webhook");
  });
});

describe("TestResultPanel", () => {
  it("shows a passing result with stdout + duration", () => {
    const result: ExecutionResult = {
      success: true,
      stdout: "Block 26804492 has 2 txs",
      stderr: "",
      duration_ms: 42,
    };
    render(<TestResultPanel result={result} />);
    expect(screen.getByText("Test Passed")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
    expect(screen.getByText("Block 26804492 has 2 txs")).toBeInTheDocument();
  });

  it("shows a failing result with stderr + error", () => {
    const result: ExecutionResult = {
      success: false,
      stdout: "",
      stderr: "ReferenceError: foo is not defined",
      duration_ms: 7,
      error: "handler threw",
    };
    render(<TestResultPanel result={result} />);
    expect(screen.getByText("Test Failed")).toBeInTheDocument();
    expect(screen.getByText("ReferenceError: foo is not defined")).toBeInTheDocument();
    expect(screen.getByText("Error: handler threw")).toBeInTheDocument();
  });
});
