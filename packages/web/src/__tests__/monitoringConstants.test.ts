import { describe, it, expect } from "vitest";
import { ALERT_TYPES, CHANNEL_TYPES } from "../components/monitoring/AlertBuilder/constants";

/** The alert-builder option catalogues — keep label/value pairs in sync with
 *  the AlertType / NotificationChannel unions in api/alerts. */
describe("AlertBuilder/constants", () => {
  it("lists every alert type with a label", () => {
    expect(ALERT_TYPES.map((t) => t.value)).toEqual([
      "address_activity",
      "contract_event",
      "function_call",
      "balance_threshold",
      "failed_tx",
    ]);
    expect(ALERT_TYPES.every((t) => t.label.length > 0)).toBe(true);
  });

  it("lists the notification channel types with labels", () => {
    expect(CHANNEL_TYPES).toHaveLength(4);
    expect(CHANNEL_TYPES.map((c) => c.value)).toContain("webhook");
    expect(CHANNEL_TYPES.every((c) => c.label.length > 0)).toBe(true);
  });
});
