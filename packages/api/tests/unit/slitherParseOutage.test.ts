import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isFailedSlitherRun,
  parseSlitherOutput,
} from "../../src/services/slither/parseOutput.js";

/**
 * "Slither found no issues" is a claim about a contract. "Slither produced
 * nothing we can read" is a claim about our server. The parser used to
 * answer `[]` to both, and the caller published the first.
 */

const CLEAN_RUN = JSON.stringify({
  success: true,
  error: null,
  results: { detectors: [] },
});

const ONE_FINDING = JSON.stringify({
  success: true,
  error: null,
  results: {
    detectors: [
      {
        check: "reentrancy-eth",
        impact: "High",
        confidence: "Medium",
        description: "Reentrancy in withdraw()",
        elements: [],
      },
    ],
  },
});

describe("parseSlitherOutput", () => {
  it("returns an empty list for a contract Slither cleared", () => {
    assert.deepEqual(parseSlitherOutput(CLEAN_RUN), []);
  });

  it("maps detectors when Slither found something", () => {
    const findings = parseSlitherOutput(ONE_FINDING);
    assert.equal(findings?.length, 1);
    assert.equal(findings?.[0]?.check, "reentrancy-eth");
  });

  it("skips a non-JSON prelude before the payload", () => {
    assert.deepEqual(parseSlitherOutput(`Switched to solc 0.8.20\n${CLEAN_RUN}`), []);
  });

  /**
   * The distinguishing case. Both of these end with zero findings; only the
   * null says the analysis never happened. A test asserting `length === 0`
   * would pass on both while the product handed out a clean bill of health.
   */
  it("separates a clean contract from an unreadable run", () => {
    assert.deepEqual(parseSlitherOutput(CLEAN_RUN), []);
    assert.equal(parseSlitherOutput("{not json"), null);
    assert.notDeepEqual(parseSlitherOutput(CLEAN_RUN), parseSlitherOutput("{not json"));
  });

  it("returns null when there is no JSON at all", () => {
    assert.equal(parseSlitherOutput(""), null);
    assert.equal(parseSlitherOutput("solc-select: version not installed"), null);
  });

  it("returns null when Slither's own envelope reports a failure", () => {
    assert.equal(
      parseSlitherOutput(
        JSON.stringify({ success: false, error: "compilation failed", results: {} }),
      ),
      null,
    );
  });
});

describe("isFailedSlitherRun", () => {
  it("is true when Slither says the run failed", () => {
    assert.equal(isFailedSlitherRun({ success: false, error: null }), true);
    assert.equal(isFailedSlitherRun({ success: true, error: "boom" }), true);
  });

  it("is false for a successful run with nothing to report", () => {
    assert.equal(isFailedSlitherRun({ success: true, error: null }), false);
  });

  /**
   * An older Slither omits `success`. Reading a missing field as a failure
   * would turn every working run into an error — the opposite mistake, and
   * just as wrong.
   */
  it("does not read a missing `success` field as a failure", () => {
    assert.equal(isFailedSlitherRun({}), false);
    assert.equal(isFailedSlitherRun({ error: null }), false);
  });
});
