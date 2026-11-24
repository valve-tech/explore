import { describe, expect, it } from "vitest";
import { pathToHashUrl } from "../lib/hashRoute";

const TX = "0x63777697b115d4ba52cb148cc315737c20e902d88bd60a2e435c884b9bdaa798";

describe("pathToHashUrl", () => {
  it("moves an EIP-3091 path into the hash", () => {
    expect(pathToHashUrl(`/eip155/1/tx/${TX}`, "", "")).toBe(`/#/eip155/1/tx/${TX}`);
    expect(pathToHashUrl(`/tx/${TX}`, "", "")).toBe(`/#/tx/${TX}`);
  });

  it("moves the query in with the path", () => {
    expect(pathToHashUrl(`/tx/${TX}`, "?chainid=1", "")).toBe(`/#/tx/${TX}?chainid=1`);
    expect(pathToHashUrl("/", "?chainid=1", "")).toBe("/#/?chainid=1");
  });

  it("leaves the root and a hash route alone", () => {
    expect(pathToHashUrl("/", "", "")).toBeNull();
    expect(pathToHashUrl("/", "", "#/settings")).toBeNull();
  });

  it("keeps the hash route and drops a stray path or query", () => {
    expect(pathToHashUrl("/settings", "?x=1", "#/explorer")).toBe("/#/explorer");
  });

  it("ignores a hash that is not a route", () => {
    expect(pathToHashUrl("/settings", "", "#top")).toBe("/#/settings");
  });
});
