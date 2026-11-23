import { describe, it, expect } from "vitest";
import { toCallExpression } from "../components/explorer/TxDetail/callExpression";
import {
  amountArgumentIndex,
  decimalsByToken,
  returnsAmount,
  scaledAmount,
} from "../components/explorer/TxDetail/tokenAmountArgs";

const TOKEN = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const word = (n: bigint) => n.toString(16).padStart(64, "0");
const addrWord = "0".repeat(24) + "ab".repeat(20);
// 1,234,567.891234567891234567 tokens at 18 decimals — 25 raw digits.
const RAW = 1234567891234567891234567n;

const base = {
  to: TOKEN,
  value: "0",
  valuePLS: "0",
  type: "CALL",
  input: "0x",
  isError: "0",
  errCode: "",
};
const transfer = {
  ...base,
  input: "0xa9059cbb" + addrWord + word(RAW),
  methodId: "0xa9059cbb",
  methodSignature: "transfer(address,uint256)",
  methodCandidates: 1,
};

describe("scaledAmount", () => {
  it("scales exactly and trims the row text to three groups", () => {
    expect(scaledAmount(RAW, 18)).toEqual({
      display: "1,234,567",
      full: "1,234,567.891234567891234567",
    });
    expect(scaledAmount(1500000n, 6)).toEqual({ display: "1.5", full: "1.5" });
  });
});

describe("amount positions", () => {
  it("claims an amount only for the ERC-20 signatures", () => {
    expect(amountArgumentIndex("transfer(address,uint256)")).toBe(1);
    expect(amountArgumentIndex("transferFrom(address,address,uint256)")).toBe(2);
    expect(amountArgumentIndex("swap(uint256,uint256,address,bytes)")).toBeNull();
    expect(returnsAmount("balanceOf(address)")).toBe(true);
    expect(returnsAmount("decimals()")).toBe(false);
  });
});

describe("decimalsByToken", () => {
  it("keys by lowercased address and skips an unknown scale", () => {
    const map = decimalsByToken([
      { contractAddress: TOKEN, tokenDecimal: "18" },
      { contractAddress: "0x" + "11".repeat(20), tokenDecimal: "" },
    ]);
    expect(map.get(TOKEN.toLowerCase())).toBe(18);
    expect(map.size).toBe(1);
  });
});

describe("toCallExpression with token decimals", () => {
  it("prints a transfer amount at the token's scale, not in base units", () => {
    const expr = toCallExpression(transfer, "PLS", 18);
    expect(expr.args?.[1]).toBe("1,234,567");
    expect(expr.argsFull?.[1]).toBe("1,234,567.891234567891234567");
  });

  it("keeps the raw integer when the decimals are not known", () => {
    const expr = toCallExpression(transfer, "PLS");
    expect(expr.args?.[1]).toBe("1,234,567,891,234,567,891,234,567");
    expect(expr.argsFull).toEqual(expr.args);
  });

  it("scales a balanceOf return and leaves a non-amount return alone", () => {
    const balance = toCallExpression(
      {
        ...base,
        input: "0x70a08231" + addrWord,
        output: "0x" + word(RAW),
        methodSignature: "balanceOf(address)",
      },
      "PLS",
      18,
    );
    expect(balance.returns).toBe("1,234,567");
    expect(balance.returnsFull).toBe("1,234,567.891234567891234567");

    const decimals = toCallExpression(
      { ...base, input: "0x313ce567", output: "0x" + word(18n), methodSignature: "decimals()" },
      "PLS",
      18,
    );
    expect(decimals.returns).toBe("18");
  });

  it("does not scale a uint256 of a signature no standard fixes", () => {
    const expr = toCallExpression(
      {
        ...base,
        input: "0x12345678" + word(RAW),
        methodSignature: "stake(uint256)",
      },
      "PLS",
      18,
    );
    expect(expr.args?.[0]).toBe("1,234,567,891,234,567,891,234,567");
  });
});
