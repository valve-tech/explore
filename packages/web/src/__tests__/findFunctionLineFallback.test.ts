import { describe, it, expect } from "vitest";

import { findFunctionLine } from "../components/debugger/StepDebugger/findFunctionLine";

/**
 * Regression: the ether entry point in pre-0.6 Solidity.
 *
 * Real failure — https://explore.valve.city/debugger/0x3c7e0d7e18742fdb1d4d4aac46357261d730202ccd51dce1d2876be2812b0f43
 * A plain ETH transfer into Lido's stETH proxy DELEGATECALLs the implementation
 * at 0x47ebab13b806773ec2a2d16873e2df770d130b50. The debugger labels that row
 * `receive()` (correct — modern EVM semantics for a value transfer with no
 * calldata) and asks the source pane to jump there. But Lido is compiled with
 * **Solidity 0.4.24**, where `receive`/`fallback` DO NOT EXIST as keywords —
 * they arrived in 0.6.0. Its entry point is the UNNAMED fallback, verbatim from
 * the verified source at contracts/0.4.24/Lido.sol:279:
 *
 *     function() external payable {
 *
 * The old pattern (`\breceive\s*\(\s*\)`) can never match that, so every value
 * transfer into any pre-0.6 contract raised "Couldn't locate `receive()`".
 *
 * NOT an inheritance problem: `contract Lido is ILido, StETH, AragonApp` and
 * inherited members resolve fine across the tree (`transfer` → StETH.sol,
 * `hasInitialized` → an Aragon base) precisely because this scans every file
 * rather than modelling inheritance.
 */

const f = (name: string, content: string) => ({ name, content });

describe("findFunctionLine — pre-0.6 unnamed fallback", () => {
  it("locates `function() external payable` when asked for receive (Lido, 0.4.24)", () => {
    const files = [
      f(
        "Lido.sol",
        [
          "pragma solidity 0.4.24;",
          "",
          "contract Lido is ILido, StETH, AragonApp {",
          "    /**",
          "     * @notice Send funds to the pool",
          "     */",
          "    function() external payable {",
          "        _submit(0);",
          "    }",
          "}",
        ].join("\n"),
      ),
    ];
    expect(findFunctionLine(files, "receive")).toEqual({ file: "Lido.sol", line: 7 });
  });

  it("locates the unnamed fallback when asked for fallback too", () => {
    // Pre-0.6 has ONE unnamed function serving both roles, so either label
    // must resolve to it.
    const files = [
      f(
        "Old.sol",
        ["contract Old {", "    function() public payable {", "    }", "}"].join("\n"),
      ),
    ];
    expect(findFunctionLine(files, "fallback")).toEqual({ file: "Old.sol", line: 2 });
  });

  it("still prefers a modern receive() over an unnamed fallback", () => {
    // A 0.6+ contract may declare BOTH. Asking for receive must land on
    // receive(), never on the fallback.
    const files = [
      f(
        "Modern.sol",
        [
          "pragma solidity ^0.8.0;",
          "contract Modern {",
          "    fallback() external payable {}",
          "    receive() external payable {}",
          "}",
        ].join("\n"),
      ),
    ];
    expect(findFunctionLine(files, "receive")).toEqual({ file: "Modern.sol", line: 4 });
    expect(findFunctionLine(files, "fallback")).toEqual({ file: "Modern.sol", line: 3 });
  });

  it("prefers a modern receive() in a later file over a legacy fallback in an earlier one", () => {
    // Precedence must be by SYNTAX, not by file order: the legacy pattern is
    // only a fallback for when no modern declaration exists anywhere.
    const files = [
      f("Base.sol", ["contract Base {", "    function() external payable {}", "}"].join("\n")),
      f("Impl.sol", ["contract Impl is Base {", "    receive() external payable {}", "}"].join("\n")),
    ];
    expect(findFunctionLine(files, "receive")).toEqual({ file: "Impl.sol", line: 2 });
  });

  it("does not mistake a named function for the unnamed fallback", () => {
    const files = [
      f(
        "Named.sol",
        ["contract Named {", "    function submit() external payable {}", "}"].join("\n"),
      ),
    ];
    expect(findFunctionLine(files, "receive")).toBeNull();
  });

  it("does not mistake a function-type parameter for the unnamed fallback", () => {
    // `function(...)` as a TYPE is not a declaration. The zero-arg type
    // `function()` is the risky lookalike.
    const files = [
      f(
        "Cb.sol",
        [
          "contract Cb {",
          "    function run(function() external cb) external {",
          "        cb();",
          "    }",
          "}",
        ].join("\n"),
      ),
    ];
    // The unnamed fallback is always payable/external at statement position;
    // a type-position lookalike must not win.
    expect(findFunctionLine(files, "receive")).toBeNull();
  });

  it("finds an inherited function in a base contract in another file", () => {
    // Pins the behaviour the extension-tree theory questioned.
    const files = [
      f("StETH.sol", ["contract StETH {", "    function transfer() public {}", "}"].join("\n")),
      f("Lido.sol", ["contract Lido is StETH {", "    function submit() public {}", "}"].join("\n")),
    ];
    expect(findFunctionLine(files, "transfer")).toEqual({ file: "StETH.sol", line: 2 });
  });
});
