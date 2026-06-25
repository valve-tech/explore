import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  requestNotificationPermission,
  showDesktopNotification,
  setDesktopNotifyEnabled,
} from "../lib/watcher/desktopNotify";

/**
 * Supplements watcherDesktopNotify.test.ts — covers the two catch fallbacks:
 *  - requestNotificationPermission when the promise form throws (legacy Safari)
 *  - showDesktopNotification when the `new Notification` constructor throws.
 */

const NOTIF = globalThis as unknown as { Notification?: unknown };
const original = NOTIF.Notification;

afterEach(() => {
  if (original === undefined) delete NOTIF.Notification;
  else NOTIF.Notification = original;
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

describe("requestNotificationPermission — promise rejection fallback", () => {
  it("falls back to the current permission when requestPermission throws", async () => {
    class ThrowingNotification {
      static permission: NotificationPermission = "denied";
      static requestPermission = vi.fn(() => {
        throw new Error("legacy callback signature");
      });
    }
    NOTIF.Notification = ThrowingNotification;
    expect(await requestNotificationPermission()).toBe("denied");
    expect(ThrowingNotification.requestPermission).toHaveBeenCalledOnce();
  });
});

describe("showDesktopNotification — constructor throw fallback", () => {
  it("returns false (not throw) when `new Notification` throws despite both gates passing", () => {
    class ExplodingNotification {
      static permission: NotificationPermission = "granted";
      constructor() {
        throw new Error("Illegal constructor");
      }
    }
    NOTIF.Notification = ExplodingNotification;
    setDesktopNotifyEnabled(true);

    expect(showDesktopNotification({ title: "x", body: "y" })).toBe(false);
  });
});
