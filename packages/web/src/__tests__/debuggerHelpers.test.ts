import { describe, it, expect } from "vitest";
import { isValidTxHash } from "../components/debugger/DebuggerView/validation";
import {
  formatWord,
  memoryToBytes,
  formatMemoryRow,
} from "../components/debugger/StepDebugger/format";
import {
  getCategoryColor,
  getCallTypeColor,
  truncateAddress,
  formatGas,
} from "../components/debugger/GasProfiler/colors";
import {
  extractSelector,
  walkCallTree,
  flattenCallTree,
  bestMatchSignature,
} from "../components/debugger/StepDebugger/callTreeHelpers";
import type { CallFrame, OpcodeStep } from "../api/debugger";
import type { SignatureMatch } from "../api/signatures";

describe("DebuggerView/validation — isValidTxHash", () => {
  it("accepts a 0x + 64-hex hash, rejects everything else", () => {
    expect(isValidTxHash("0x" + "a".repeat(64))).toBe(true);
    expect(isValidTxHash("0x" + "A1b2".repeat(16))).toBe(true);
    expect(isValidTxHash("0x" + "a".repeat(63))).toBe(false); // too short
    expect(isValidTxHash("a".repeat(64))).toBe(false); // no 0x
    expect(isValidTxHash("0x" + "g".repeat(64))).toBe(false); // non-hex
    expect(isValidTxHash("")).toBe(false);
  });
});

describe("StepDebugger/format", () => {
  it("formatWord left-pads to a full 32-byte word", () => {
    expect(formatWord("0x1")).toBe("0x" + "1".padStart(64, "0"));
    expect(formatWord("ff")).toBe("0x" + "ff".padStart(64, "0"));
  });

  it("memoryToBytes joins memory chunks", () => {
    expect(memoryToBytes(["aa", "bb", "cc"])).toBe("aabbcc");
  });

  it("formatMemoryRow renders hex bytes + printable ASCII", () => {
    // "Hello" = 48 65 6c 6c 6f
    const row = formatMemoryRow("48656c6c6f", 0);
    expect(row.hex).toBe("48 65 6c 6c 6f");
    expect(row.ascii).toBe("Hello");
  });

  it("formatMemoryRow maps non-printable bytes to '.'", () => {
    // 0x00 (null) and 0xff are non-printable → "."
    const row = formatMemoryRow("0041ff", 0);
    expect(row.ascii).toBe(".A.");
  });
});

describe("GasProfiler/colors", () => {
  it("maps known categories + call types, falls back for unknown", () => {
    expect(getCategoryColor("Storage")).toBe("#f97316");
    expect(getCategoryColor("Nonsense")).toBe("#8b949e");
    expect(getCallTypeColor("DELEGATECALL")).toBe("#fbbf24");
    expect(getCallTypeColor("WAT")).toBe("#8b949e");
  });

  it("truncateAddress + formatGas", () => {
    expect(truncateAddress("0xA1077a294dDE1B09bB078844df40758a5D0f9a27")).toBe(
      "0xA107...9a27",
    );
    expect(truncateAddress("0x1234")).toBe("0x1234");
    expect(formatGas(1234567)).toBe((1234567).toLocaleString());
  });
});

describe("StepDebugger/callTreeHelpers", () => {
  // A real ERC-20 transfer selector for the leaf call.
  const tree = {
    to: "0xroot",
    type: "CALL",
    input: "0x",
    calls: [
      {
        to: "0xa1077a294dde1b09bb078844df40758a5d0f9a27",
        type: "CALL",
        value: "0",
        input: "0xa9059cbb" + "0".repeat(128), // transfer(address,uint256)
        calls: [
          { to: "0xchild", type: "STATICCALL", input: "0x70a08231" + "0".repeat(64), calls: [] },
        ],
      },
    ],
  } as unknown as CallFrame;

  it("walkCallTree visits every frame pre-order", () => {
    const seen: string[] = [];
    walkCallTree(tree, (f) => seen.push(f.to ?? ""));
    expect(seen).toEqual(["0xroot", "0xa1077a294dde1b09bb078844df40758a5d0f9a27", "0xchild"]);
  });

  it("flattenCallTree skips the root and extracts selectors pre-order", () => {
    const flat = flattenCallTree(tree);
    expect(flat.map((c) => c.selector)).toEqual(["0xa9059cbb", "0x70a08231"]);
    expect(flat[0]!.to).toBe("0xa1077a294dde1b09bb078844df40758a5d0f9a27");
    expect(flat[1]!.type).toBe("STATICCALL");
  });

  it("extractSelector reads the 4-byte selector from CALL args memory", () => {
    const step = {
      op: "CALL",
      // bottom→top: [argsOffset, value, addr, gas]; argsOffset at len-4 = index 0
      stack: ["0x0", "0x0", "0x0", "0x0"],
      memory: ["a9059cbb" + "0".repeat(56)],
    } as unknown as OpcodeStep;
    expect(extractSelector(step)).toBe("0xa9059cbb");
  });

  it("bestMatchSignature: single candidate wins; collision resolved by param count", () => {
    const one: SignatureMatch[] = [{ textSignature: "transfer(address,uint256)" } as SignatureMatch];
    expect(bestMatchSignature(one, "0xa9059cbb")).toBe("transfer(address,uint256)");
    expect(bestMatchSignature([], "0x")).toBeUndefined();

    // Two candidates; calldata carries 2 params (4 + 64 bytes) → the 2-param sig.
    const collision: SignatureMatch[] = [
      { textSignature: "transfer(address,uint256)" } as SignatureMatch,
      { textSignature: "x(uint256,uint256,uint256)" } as SignatureMatch,
    ];
    const calldata = "0xa9059cbb" + "0".repeat(128); // 4 + 64 bytes
    expect(bestMatchSignature(collision, calldata)).toBe("transfer(address,uint256)");
  });
});
