/**
 * Optional desktop notifications for fired watches.
 *
 * The watcher's baseline surface is an in-app toast (`WatchNotifications`) — it
 * needs no permission and works while the tab is focused. Desktop notifications
 * are the opt-in ESCALATION: when the user has enabled them AND the browser has
 * granted permission, a fired watch also raises an OS-level Notification, so a
 * user watching from a backgrounded tab still sees it.
 *
 * Two independent gates, kept separate on purpose:
 *   - the USER PREFERENCE — a localStorage flag this module owns, and
 *   - the BROWSER PERMISSION — owned by the platform; we can only request it.
 * Both must pass to fire. `shouldShowDesktop` is the pure predicate that ANDs
 * them, so the decision is fully testable without a real Notification API — the
 * only untestable line is the `new Notification` constructor itself.
 */

const ENABLED_KEY = "explore:watchDesktopNotify";

/** Browser permission states, plus a sentinel for "no Notification API here". */
export type NotifyPermission = NotificationPermission | "unsupported";

/** True when this browser exposes the Notification API at all. */
export function notificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

/** Current browser permission, or "unsupported" where there's no API. */
export function notificationPermission(): NotifyPermission {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

/** The user's stored preference. Default OFF — desktop notify is opt-in. */
export function isDesktopNotifyEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "true";
}

/** Persist the preference. */
export function setDesktopNotifyEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ENABLED_KEY, String(enabled));
}

/** Ask the browser for permission; resolves to the resulting permission. */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (!notificationsSupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    // Legacy Safari used a callback signature and can throw on the promise
    // form — fall back to reading whatever state it left us in.
    return Notification.permission;
  }
}

/**
 * Pure decision: should a fired watch raise a desktop notification, given the
 * user preference and the browser permission? Both gates must pass.
 */
export function shouldShowDesktop(
  enabled: boolean,
  permission: NotifyPermission,
): boolean {
  return enabled && permission === "granted";
}

export interface DesktopNotifyInput {
  title: string;
  body: string;
  /** Coalescing tag — re-firing the same id replaces rather than stacks. */
  tag?: string;
  /**
   * App-specific click action (e.g. route to the match's tx). Wired to the
   * notification's `onclick`; the platform-universal part — focusing the tab and
   * dismissing the toast — is handled here, so the caller's callback only has to
   * navigate. Built in React (where `useNavigate` lives) so the router builds
   * the URL.
   */
  onClick?: () => void;
}

/**
 * Raise a desktop notification IF both gates pass. Returns whether it fired, so
 * callers (and tests) can assert the gate without inspecting the platform. The
 * `new Notification` is the lone untestable line — every decision leading to it
 * lives in `shouldShowDesktop`.
 *
 * When `onClick` is supplied it's wrapped so a click first focuses this tab
 * (the whole point of a desktop notification is reaching a backgrounded one),
 * then runs the caller's navigation, then dismisses the notification.
 */
export function showDesktopNotification(input: DesktopNotifyInput): boolean {
  if (!shouldShowDesktop(isDesktopNotifyEnabled(), notificationPermission())) {
    return false;
  }
  try {
    const notification = new Notification(input.title, {
      body: input.body,
      tag: input.tag,
    });
    if (input.onClick) {
      const onClick = input.onClick;
      notification.onclick = () => {
        try {
          window.focus();
        } catch {
          // jsdom/headless contexts may not implement focus — ignore.
        }
        onClick();
        notification.close();
      };
    }
    return true;
  } catch {
    return false;
  }
}
