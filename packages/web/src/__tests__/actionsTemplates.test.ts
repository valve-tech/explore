import { describe, it, expect } from "vitest";
import { TEMPLATES } from "../components/actions/ActionEditor/templates";

/** Starter handler code per trigger type — must exist for every trigger the
 *  picker offers, and each must define an async `handler(context)`. */
describe("ActionEditor/templates", () => {
  it("provides a template for each trigger type", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([
      "block",
      "event",
      "periodic",
      "webhook",
    ]);
  });

  it("each template defines an async handler that destructures the context", () => {
    for (const code of Object.values(TEMPLATES)) {
      expect(code).toContain("async function handler(context)");
      expect(code).toContain("const { event, rpc, secrets, storage } = context;");
    }
  });
});
