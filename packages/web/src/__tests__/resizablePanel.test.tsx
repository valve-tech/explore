import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ResizablePanel } from "../components/debugger/StepDebugger/ResizablePanel";

/**
 * ResizablePanel drag-to-resize. The drag handle is the only element with the
 * `bs-r-in` class; on pointerdown it wires window pointermove/pointerup
 * listeners that recompute width = clamp(start + dx). We dispatch the native
 * pointer events the component listens for and assert onResize fires with the
 * clamped value.
 */
describe("ResizablePanel", () => {
  function setup(props: Partial<Parameters<typeof ResizablePanel>[0]> = {}) {
    const onResize = vi.fn();
    const { container } = render(
      <ResizablePanel width={360} onResize={onResize} {...props}>
        <div>tree contents</div>
      </ResizablePanel>,
    );
    const handle = container.querySelector(".bs-r-in") as HTMLElement;
    return { onResize, handle, container };
  }

  it("renders children inside the panel at the given width", () => {
    const { container } = setup();
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.style.width).toBe("360px");
    expect(container.textContent).toContain("tree contents");
  });

  it("resizes on pointer drag, reporting the new (start + dx) width", () => {
    const { onResize, handle } = setup();
    expect(handle).toBeTruthy();
    // pointerdown captures startX=100, startW=360.
    fireEvent.pointerDown(handle, { clientX: 100 });
    // pointermove on window: dx = +120 → 480.
    fireEvent(window, new MouseEvent("pointermove", { clientX: 220 } as MouseEventInit));
    expect(onResize).toHaveBeenLastCalledWith(480);
    // Drag ends; listeners + body cursor styles are torn down.
    fireEvent(window, new MouseEvent("pointerup", {} as MouseEventInit));
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("clamps the reported width to the max bound", () => {
    const { onResize, handle } = setup({ max: 500 });
    fireEvent.pointerDown(handle, { clientX: 0 });
    // dx = +5000 → clamped to max 500.
    fireEvent(window, new MouseEvent("pointermove", { clientX: 5000 } as MouseEventInit));
    expect(onResize).toHaveBeenLastCalledWith(500);
    fireEvent(window, new MouseEvent("pointerup", {} as MouseEventInit));
  });

  it("clamps the reported width to the min bound", () => {
    const { onResize, handle } = setup({ min: 300 });
    fireEvent.pointerDown(handle, { clientX: 400 });
    // dx = -400 → 360 - 400 = -40 → clamped to min 300.
    fireEvent(window, new MouseEvent("pointermove", { clientX: 0 } as MouseEventInit));
    expect(onResize).toHaveBeenLastCalledWith(300);
    fireEvent(window, new MouseEvent("pointerup", {} as MouseEventInit));
  });

  it("stops resizing after pointerup (listeners removed)", () => {
    const { onResize, handle } = setup();
    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 150 } as MouseEventInit));
    onResize.mockClear();
    fireEvent(window, new MouseEvent("pointerup", {} as MouseEventInit));
    // Further moves are ignored — the listener was detached on pointerup.
    fireEvent(window, new MouseEvent("pointermove", { clientX: 999 } as MouseEventInit));
    expect(onResize).not.toHaveBeenCalled();
  });
});
