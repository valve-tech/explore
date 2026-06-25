import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { createElement } from "react";

// @iconify/react's <Icon> schedules an internal setTimeout to load icon data
// from its API. Under jsdom that timer can fire *after* a test unmounts,
// calling setState on a torn-down component — surfacing as an unhandled
// "Uncaught Exception" that fails the run even though every test passed.
// Stub it with a synchronous, timer-free span; no test asserts on Iconify's
// internal SVG markup (chart <svg>s are rendered directly by app components).
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon?: string }) =>
    createElement("span", { "data-icon": icon, "aria-hidden": true }),
}));
