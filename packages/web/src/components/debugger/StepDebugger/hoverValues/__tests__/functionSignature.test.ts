import { describe, expect, it } from "vitest";
import { parseFunctionSignature } from "../functionSignature";

const names = (vars: { name: string | null }[]) => vars.map((v) => v.name);

describe("parseFunctionSignature", () => {
  it("reads parameters and named returns with their slot offsets", () => {
    // PulseXLibrary.getAmountOut, from the verified PulseXRouter02 source.
    const sig = parseFunctionSignature(
      "function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) internal pure returns (uint amountOut) {\n  amountOut = 1;\n}",
    )!;
    expect(sig.name).toBe("getAmountOut");
    expect(names(sig.params)).toEqual(["amountIn", "reserveIn", "reserveOut"]);
    expect(sig.params.map((p) => p.offset)).toEqual([0, 1, 2]);
    expect(sig.returns).toMatchObject([{ name: "amountOut", type: "uint", offset: 0, slots: 1, text: "uint amountOut" }]);
    expect(sig.paramSlots).toBe(3);
    expect(sig.returnSlots).toBe(1);
  });

  it("gives two slots to a dynamic calldata value", () => {
    // PulseXRouter02.swapExactTokensForTokens.
    const sig = parseFunctionSignature(
      "function swapExactTokensForTokens(\n uint amountIn,\n uint amountOutMin,\n address[] calldata path,\n address to,\n uint deadline\n) external virtual override ensure(deadline) returns (uint[] memory amounts) { }",
    )!;
    expect(sig.params.map((p) => [p.name, p.offset, p.slots, p.location])).toEqual([
      ["amountIn", 0, 1, null],
      ["amountOutMin", 1, 1, null],
      ["path", 2, 2, "calldata"],
      ["to", 4, 1, null],
      ["deadline", 5, 1, null],
    ]);
    expect(sig.paramSlots).toBe(6);
    expect(sig.returns[0]).toMatchObject({ name: "amounts", type: "uint[]", location: "memory", slots: 1 });
  });

  it("gives one slot to memory, storage, and static calldata values", () => {
    const sig = parseFunctionSignature(
      "function f(bytes memory a, string calldata b, uint[3] calldata c, S calldata d, uint[] storage e, mapping(address => uint256) storage m) internal {}",
    )!;
    expect(sig.params.map((p) => p.slots)).toEqual([1, 2, 1, 1, 1, 1]);
    expect(sig.params[5]).toMatchObject({ name: "m", type: "mapping(address=>uint256)", location: "storage" });
    expect(sig.params[2]!.type).toBe("uint[3]");
  });

  it("keeps unnamed variables, because they use slots", () => {
    const sig = parseFunctionSignature("function f(uint256, address who) public returns (bool, uint256 n) { }")!;
    expect(names(sig.params)).toEqual([null, "who"]);
    expect(sig.params[1]!.offset).toBe(1);
    expect(names(sig.returns)).toEqual([null, "n"]);
    expect(sig.returns[1]!.offset).toBe(1);
  });

  it("reads 'address payable' and qualified type names", () => {
    const sig = parseFunctionSignature("function f(address payable to, Lib.Kind kind, IERC20 token) internal { }")!;
    expect(sig.params.map((p) => p.type)).toEqual(["address payable", "Lib.Kind", "IERC20"]);
  });

  it("applies the location rules of Solidity before 0.5", () => {
    const ext = parseFunctionSignature("function f(bytes data, uint[] list, uint[2] pair) external { }")!;
    expect(ext.params.map((p) => [p.location, p.slots])).toEqual([["calldata", 2], ["calldata", 2], ["calldata", 1]]);
    const pub = parseFunctionSignature("function f(bytes data, string name) public { }")!;
    expect(pub.params.map((p) => [p.location, p.slots])).toEqual([["memory", 1], ["memory", 1]]);
  });

  it("ignores comments and finds the body after modifiers with arguments", () => {
    const sig = parseFunctionSignature(
      "function f(uint a /* first, */, uint b) // note (x)\n  public onlyRole(ADMIN) returns (uint r) { r = a; }",
    )!;
    expect(names(sig.params)).toEqual(["a", "b"]);
    expect(names(sig.returns)).toEqual(["r"]);
    expect(sig.stripped.slice(sig.bodyStart).trim()).toBe("r = a; }");
  });

  it("reads an empty parameter list", () => {
    const sig = parseFunctionSignature("function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) { }")!;
    expect(sig.paramSlots).toBe(0);
    expect(sig.returnSlots).toBe(3);
  });

  it("returns null when the slot count is not certain", () => {
    // A function-type parameter can use two slots.
    expect(parseFunctionSignature("function f(function (uint) external cb, uint a) internal { }")).toBeNull();
    expect(parseFunctionSignature("function f(uint a) internal returns (function (uint) internal g) { }")).toBeNull();
    // Not understood: three words after the type.
    expect(parseFunctionSignature("function f(uint memory a b) internal { }")).toBeNull();
  });

  it("returns null for text that is not a function with a body", () => {
    expect(parseFunctionSignature("function f(uint a) external;")).toBeNull();
    expect(parseFunctionSignature("modifier m(uint a) { _; }")).toBeNull();
    expect(parseFunctionSignature("constructor(uint a) { }")).toBeNull();
    expect(parseFunctionSignature("uint256 public total")).toBeNull();
    expect(parseFunctionSignature("function f(uint a")).toBeNull();
  });
});
