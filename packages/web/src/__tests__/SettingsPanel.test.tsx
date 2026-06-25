import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import SettingsPanel from "../components/settings/SettingsPanel";
import { API_BASE_OVERRIDE_KEY } from "../lib/apiBase";

/**
 * Workspace-preferences panel: backend-origin override, per-chain BYO-RPC rows,
 * and the desktop-notifications opt-in. Each section gates its own state — this
 * drives the set/clear/validation branches and both notification-permission
 * paths (granted vs prompt-then-grant) by stubbing the platform Notification.
 */

function backendSection() {
  return screen
    .getByText("Backend API origin")
    .closest(".card") as HTMLElement;
}

describe("<SettingsPanel /> — backend API origin", () => {
  beforeEach(() => localStorage.clear());

  it("shows '(same origin)' and a disabled Clear with no override", () => {
    render(<SettingsPanel />);
    const section = within(backendSection());
    expect(section.getByText("(same origin)")).toBeInTheDocument();
    expect(section.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(section.getByText(/No override set\./)).toBeInTheDocument();
  });

  it("Set persists a valid origin and reflects it in the footer note", () => {
    render(<SettingsPanel />);
    const section = within(backendSection());
    fireEvent.change(section.getByRole("textbox"), {
      target: { value: "https://explore.valve.city" },
    });
    fireEvent.click(section.getByRole("button", { name: "Set" }));
    expect(localStorage.getItem(API_BASE_OVERRIDE_KEY)).toBe(
      "https://explore.valve.city",
    );
    expect(
      section.getByText(/Override set to https:\/\/explore\.valve\.city/),
    ).toBeInTheDocument();
  });

  it("Set on an empty draft surfaces the placeholder-origin error", () => {
    render(<SettingsPanel />);
    const section = within(backendSection());
    fireEvent.click(section.getByRole("button", { name: "Set" }));
    expect(
      section.getByText(/Enter an http\(s\) origin/),
    ).toBeInTheDocument();
  });

  it("Set on a non-http value surfaces the invalid-origin error", () => {
    render(<SettingsPanel />);
    const section = within(backendSection());
    fireEvent.change(section.getByRole("textbox"), {
      target: { value: "ftp://nope" },
    });
    fireEvent.click(section.getByRole("button", { name: "Set" }));
    expect(section.getByText("Not a valid http(s) origin.")).toBeInTheDocument();
    expect(localStorage.getItem(API_BASE_OVERRIDE_KEY)).toBeNull();
  });

  it("Enter applies, then Clear removes the override", () => {
    render(<SettingsPanel />);
    const section = within(backendSection());
    const input = section.getByRole("textbox");
    fireEvent.change(input, { target: { value: "https://api.example" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(localStorage.getItem(API_BASE_OVERRIDE_KEY)).toBe(
      "https://api.example",
    );

    fireEvent.click(section.getByRole("button", { name: "Clear" }));
    expect(localStorage.getItem(API_BASE_OVERRIDE_KEY)).toBeNull();
    expect(section.getByText(/No override set\./)).toBeInTheDocument();
  });

  it("a non-Enter keydown in the origin input does not apply", () => {
    render(<SettingsPanel />);
    const section = within(backendSection());
    const input = section.getByRole("textbox");
    fireEvent.change(input, { target: { value: "https://api.example" } });
    fireEvent.keyDown(input, { key: "a" });
    expect(localStorage.getItem(API_BASE_OVERRIDE_KEY)).toBeNull();
  });

  it("typing after an error clears the error", () => {
    render(<SettingsPanel />);
    const section = within(backendSection());
    fireEvent.click(section.getByRole("button", { name: "Set" }));
    expect(section.getByText(/Enter an http\(s\) origin/)).toBeInTheDocument();
    fireEvent.change(section.getByRole("textbox"), { target: { value: "h" } });
    expect(
      section.queryByText(/Enter an http\(s\) origin/),
    ).not.toBeInTheDocument();
  });
});

describe("<SettingsPanel /> — chain RPC + structure", () => {
  beforeEach(() => localStorage.clear());

  it("renders a BYO-RPC row for each registered chain", () => {
    render(<SettingsPanel />);
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(screen.getByText("PulseChain")).toBeInTheDocument();
    expect(screen.getByText("PulseChain Testnet v4")).toBeInTheDocument();
  });

  it("renders the section headers including the 'More' placeholder", () => {
    render(<SettingsPanel />);
    expect(screen.getByText("Workspace preferences")).toBeInTheDocument();
    expect(screen.getByText("Chain RPC endpoints")).toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
  });
});

describe("<SettingsPanel /> — notifications", () => {
  const origNotification = (
    globalThis as { Notification?: unknown }
  ).Notification;

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    if (origNotification === undefined) {
      delete (globalThis as { Notification?: unknown }).Notification;
    } else {
      (globalThis as { Notification?: unknown }).Notification =
        origNotification;
    }
  });

  function stubNotification(
    permission: NotificationPermission,
    request?: () => Promise<NotificationPermission>,
  ) {
    const ctor = function () {} as unknown as {
      permission: NotificationPermission;
      requestPermission: () => Promise<NotificationPermission>;
    };
    ctor.permission = permission;
    ctor.requestPermission =
      request ?? (() => Promise.resolve(permission));
    (globalThis as { Notification?: unknown }).Notification = ctor;
  }

  it("shows 'Not supported' when the Notification API is absent", () => {
    delete (globalThis as { Notification?: unknown }).Notification;
    render(<SettingsPanel />);
    expect(
      screen.getByText(/Not supported in this browser\./),
    ).toBeInTheDocument();
  });

  // The Toggle is the lone <button> inside the Notifications section card.
  function notifToggle(): HTMLButtonElement {
    const card = screen.getByText("Notifications").closest(".card")!;
    return card.querySelector("button")! as HTMLButtonElement;
  }

  it("toggling on with permission already granted persists the preference", () => {
    stubNotification("granted");
    render(<SettingsPanel />);
    expect(screen.getByText(/Permission granted\./)).toBeInTheDocument();
    fireEvent.click(notifToggle());
    expect(localStorage.getItem("explore:watchDesktopNotify")).toBe("true");
  });

  it("toggling on from 'default' requests permission then honors the grant", async () => {
    const request = vi.fn(() => Promise.resolve("granted" as const));
    stubNotification("default", request);
    render(<SettingsPanel />);
    expect(
      screen.getByText(/Permission not yet requested\./),
    ).toBeInTheDocument();

    fireEvent.click(notifToggle());

    await waitFor(() => expect(request).toHaveBeenCalled());
    await waitFor(() =>
      expect(localStorage.getItem("explore:watchDesktopNotify")).toBe("true"),
    );
  });

  it("toggling on from 'default' that ends in denial does NOT persist enabled", async () => {
    const request = vi.fn(() => Promise.resolve("denied" as const));
    stubNotification("default", request);
    render(<SettingsPanel />);
    fireEvent.click(notifToggle());
    await waitFor(() => expect(request).toHaveBeenCalled());
    // result !== "granted" → persist(false); the prompt-then-deny branch.
    await waitFor(() =>
      expect(localStorage.getItem("explore:watchDesktopNotify")).toBe("false"),
    );
  });

  it("toggling OFF from an enabled state persists false immediately", () => {
    localStorage.setItem("explore:watchDesktopNotify", "true");
    stubNotification("granted");
    render(<SettingsPanel />);
    // Currently on → clicking turns it off via the early persist(false) path.
    fireEvent.click(notifToggle());
    expect(localStorage.getItem("explore:watchDesktopNotify")).toBe("false");
  });

  it("renders the blocked state and ignores toggling when permission is denied", () => {
    stubNotification("denied");
    render(<SettingsPanel />);
    expect(screen.getByText(/Blocked —/)).toBeInTheDocument();
    fireEvent.click(notifToggle());
    // Denied → onChange is a no-op; nothing persisted.
    expect(localStorage.getItem("explore:watchDesktopNotify")).toBeNull();
  });
});
