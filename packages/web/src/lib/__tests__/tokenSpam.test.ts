import { describe, it, expect } from "vitest";
import {
  isLikelySpamToken,
  tokenSpamSignals,
  spamSignalReason,
  MAX_PLAUSIBLE_NAME,
} from "../tokenSpam";

/**
 * The live sample that prompted this: four real tokens and one lure, on
 * 0x5182…22E2 / chain 369. The real ones must NOT trip — a false positive
 * marks a genuine holding as untrustworthy, which is the failure that matters.
 */
describe("tokenSpamSignals — the live sample", () => {
  const real = [
    ["Dai Stablecoin from Ethereum", "DAI"],
    ["PulseX", "PLSX"],
    ["Wrapped Pulse", "WPLS"],
    ["FuckTheVC", "FTVC"],
  ] as const;

  for (const [name, symbol] of real) {
    it(`leaves "${name}" alone`, () => {
      expect(tokenSpamSignals(name, symbol)).toEqual([]);
      expect(isLikelySpamToken(name, symbol)).toBe(false);
    });
  }

  it("flags the phishing airdrop", () => {
    const s = tokenSpamSignals("Claim 50k $pDAI on dai.free.nf", "pDAI");
    expect(s).toContain("url");
    expect(s).toContain("lure");
    expect(isLikelySpamToken("Claim 50k $pDAI on dai.free.nf", "pDAI")).toBe(true);
  });
});

describe("tokenSpamSignals — individual signals", () => {
  it("catches a bare domain", () => {
    expect(tokenSpamSignals("visit token.xyz")).toContain("url");
    expect(tokenSpamSignals("https://evil.example/claim")).toContain("url");
    expect(tokenSpamSignals("www.evil.top")).toContain("url");
  });

  it("catches a call to action without a domain", () => {
    expect(tokenSpamSignals("Claim your reward")).toContain("lure");
    expect(tokenSpamSignals("Airdrop voucher")).toContain("lure");
  });

  it("catches invisible characters used to disguise a name", () => {
    expect(tokenSpamSignals("Wrapped\u200BPulse")).toContain("hidden-characters");
    expect(tokenSpamSignals("USDC\u202E")).toContain("hidden-characters");
  });

  it("catches a sentence pretending to be a name", () => {
    expect(tokenSpamSignals("a".repeat(MAX_PLAUSIBLE_NAME + 1))).toContain("overlong");
  });

  it("gives 'Dai Stablecoin from Ethereum' real headroom on length", () => {
    expect("Dai Stablecoin from Ethereum".length).toBeLessThan(MAX_PLAUSIBLE_NAME);
    expect(tokenSpamSignals("Dai Stablecoin from Ethereum")).toEqual([]);
  });

  it("does not fire on ordinary punctuation or a ticker in the name", () => {
    expect(tokenSpamSignals("Wrapped Ether", "WETH")).toEqual([]);
    expect(tokenSpamSignals("Curve USD", "crvUSD")).not.toContain("lure");
  });

  it("handles missing name and symbol without throwing", () => {
    expect(tokenSpamSignals(null)).toEqual([]);
    expect(tokenSpamSignals(undefined, null)).toEqual([]);
    expect(isLikelySpamToken("")).toBe(false);
  });
});

describe("spamSignalReason", () => {
  it("is empty when nothing tripped", () => {
    expect(spamSignalReason([])).toBe("");
  });

  it("names the signal and warns against acting on the text", () => {
    const r = spamSignalReason(["url", "lure"]);
    expect(r).toMatch(/web address/);
    expect(r).toMatch(/call to action/);
    expect(r).toMatch(/untrusted/);
  });
});
