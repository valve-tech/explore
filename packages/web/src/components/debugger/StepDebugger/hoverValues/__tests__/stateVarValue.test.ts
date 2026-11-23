import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import type { SourceFile } from "../../../../../api/source";
import { buildSolIndex } from "../../sourceNav/solIndex";
import type { HoverStorageLayout } from "../layoutTypes";
import { resolveStateVar } from "../resolveStateVar";
import { stateVarValueAt } from "../stateVarValue";
import pepe from "./fixtures/pepeToken.json";
import pool from "./fixtures/uniswapV3Pool.json";

/** (line, col) of `word` inside the first occurrence of `snippet`. */
function at(file: SourceFile, snippet: string, word: string) {
  const s = file.content.indexOf(snippet);
  if (s === -1) throw new Error("snippet not found: " + snippet);
  const w = file.content.indexOf(word, s);
  if (w === -1 || w > s + snippet.length) throw new Error("word not in snippet: " + word);
  const line = file.content.slice(0, w).split("\n").length;
  return { file: file.name, line, col: w - (file.content.lastIndexOf("\n", w - 1) + 1) };
}

/** A storage map as geth writes it: keys and values without "0x". */
const gethStorage = (slots: Record<string, string>) =>
  Object.fromEntries(Object.entries(slots).map(([k, v]) => [BigInt(k).toString(16).padStart(64, "0"), v.slice(2)]));

// ---------------------------------------------------------------------------
// PepeToken, Ethereum 0x6982508145454Ce325dDbE47a25d4ec3d2311933.
// Real verified source (flattened, CRLF line ends), real solc layout, and real
// slot words from eth_getStorageAt at block 21000000.
// `contract PepeToken is Ownable, ERC20`; solc tags every layout entry with
// "PepeToken.sol:PepeToken", also the inherited `_owner` and `_totalSupply`.
// ---------------------------------------------------------------------------
const pepeFile = pepe.files[0] as SourceFile;
const pepeIndex = buildSolIndex(pepe.files);
const pepeLayout = pepe.storageLayout as HoverStorageLayout;
const pepeStorage = gethStorage(pepe.slots);
const pepeAt = (snippet: string, word: string, storage: Record<string, string> | null = pepeStorage) =>
  stateVarValueAt({
    index: pepeIndex, layout: pepeLayout, contractName: pepe.contractName, storage, ...at(pepeFile, snippet, word),
  });

describe("stateVarValueAt on PepeToken (real source, layout and slots)", () => {
  it("reads a bool of the most derived contract", () => {
    expect(pepeAt("if (limited && from == uniswapV2Pair)", "limited")).toEqual({
      name: "limited", type: "bool", value: "false", source: "storage",
    });
  });

  it("reads an address with its checksum", () => {
    expect(pepeAt("if (limited && from == uniswapV2Pair)", "uniswapV2Pair")).toEqual({
      name: "uniswapV2Pair", type: "address", source: "storage",
      value: getAddress("0xa43fe16908251ee70ef74718545e4fe6c5ccec9f"),
    });
  });

  it("reads a private uint256 of base ERC20 as a plain decimal", () => {
    const v = pepeAt("return _totalSupply;", "_totalSupply");
    expect(v?.value).toBe("420689899999994793099999999997400");
    expect(v?.type).toBe("uint256");
  });

  it("reads the private _owner of base Ownable (renounced: the zero address)", () => {
    expect(pepeAt("return _owner;", "_owner")?.value).toBe("0x0000000000000000000000000000000000000000");
    expect(pepeAt("address private _owner;", "_owner")?.value).toBe("0x0000000000000000000000000000000000000000");
  });

  it("returns null where a constructor parameter has the name of a state variable", () => {
    // `constructor(uint256 _totalSupply) ERC20("Pepe", "PEPE") { _mint(msg.sender, _totalSupply); }`
    expect(pepeAt("_mint(msg.sender, _totalSupply);", "_totalSupply")).toBeNull();
    expect(pepeAt("constructor(uint256 _totalSupply)", "_totalSupply")).toBeNull();
  });

  it("separates the assigned state variable from the parameter", () => {
    expect(pepeAt("limited = _limited;", "limited")?.value).toBe("false");
    expect(pepeAt("limited = _limited;", "_limited")).toBeNull();
  });

  it("describes a mapping and a string, and reads nothing", () => {
    expect(pepeAt("mapping(address => bool) public blacklists;", "blacklists")).toEqual({
      name: "blacklists", type: "mapping(address => bool)", source: "storage",
      value: "mapping(address => bool) at slot 10",
    });
    expect(pepeAt("return _name;", "_name")?.value).toBe("string at slot 4");
    // A description needs no storage map.
    expect(pepeAt("return _name;", "_name", null)?.value).toBe("string at slot 4");
  });

  it("returns null for name[key] with an expression key", () => {
    expect(pepeAt("require(!blacklists[to] && !blacklists[from]", "blacklists")).toBeNull();
    expect(pepeAt("return _balances[account];", "_balances")).toBeNull();
  });

  it("returns null when the transaction has not touched the slot", () => {
    const { ["0000000000000000000000000000000000000000000000000000000000000006"]: _drop, ...rest } = pepeStorage;
    expect(pepeAt("if (limited && from == uniswapV2Pair)", "limited", rest)).toBeNull();
    expect(pepeAt("if (limited && from == uniswapV2Pair)", "limited", {})).toBeNull();
    expect(pepeAt("if (limited && from == uniswapV2Pair)", "limited", null)).toBeNull();
  });

  it("returns null for parameters, functions, keywords and types", () => {
    expect(pepeAt("if (limited && from == uniswapV2Pair)", "from")).toBeNull();
    expect(pepeAt("_mint(msg.sender, _totalSupply);", "_mint")).toBeNull();
    expect(pepeAt("_mint(msg.sender, _totalSupply);", "sender")).toBeNull();
    expect(pepeAt("address public uniswapV2Pair;", "address")).toBeNull();
    expect(pepeAt("contract PepeToken is Ownable, ERC20", "Ownable")).toBeNull();
  });

  it("returns null inside an interface", () => {
    expect(pepeAt("function totalSupply() external view returns (uint256);", "totalSupply")).toBeNull();
  });

  it("returns null when the layout belongs to a contract that does not inherit the shown one", () => {
    const pos = at(pepeFile, "if (limited && from == uniswapV2Pair)", "limited");
    const run = (contractName: string | null) =>
      stateVarValueAt({ index: pepeIndex, layout: pepeLayout, contractName, storage: pepeStorage, ...pos });
    expect(run("ERC20")).toBeNull();
    expect(run("NotInTheFiles")).toBeNull();
    expect(run(null)).toBeNull();
  });

  it("notes a write at this step with the old and the new value", () => {
    const pos = at(pepeFile, "limited = _limited;", "limited");
    const slot6 = "0x" + "6".padStart(64, "0");
    const v = stateVarValueAt({
      index: pepeIndex, layout: pepeLayout, contractName: "PepeToken", ...pos,
      storage: { [slot6]: "0x" + "0".repeat(64) },
      prevStorage: { [slot6]: "0x" + "1".padStart(64, "0") },
      writtenSlot: slot6,
    });
    expect(v).toEqual({
      name: "limited", type: "bool", value: "false", source: "storage",
      note: "written at this step: true → false",
    });
  });

  it("notes a first write when the trace does not hold the old value", () => {
    const pos = at(pepeFile, "limited = _limited;", "limited");
    const slot6 = "0x" + "6".padStart(64, "0");
    const input = { index: pepeIndex, layout: pepeLayout, contractName: "PepeToken", ...pos, storage: { [slot6]: "0x" + "1".padStart(64, "0") } };
    expect(stateVarValueAt({ ...input, prevStorage: {}, writtenSlot: slot6 })?.note)
      .toBe("slot written at this step; the trace does not hold the old value");
    // A read step (no written slot) and an unknown previous map give no note.
    expect(stateVarValueAt({ ...input, prevStorage: {}, writtenSlot: null })?.note).toBeUndefined();
    expect(stateVarValueAt({ ...input, prevStorage: null, writtenSlot: slot6 })?.note).toBeUndefined();
    expect(stateVarValueAt({ ...input, prevStorage: input.storage, writtenSlot: slot6 })?.note).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Uniswap V3 USDC/WETH 0.05% pool, Ethereum
// 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640. Real solc layout and real slot
// words at block 21000000. The source is a short EXCERPT of
// contracts/UniswapV3Pool.sol (v1.0.0) with the real state declarations.
// ---------------------------------------------------------------------------
const POOL_SRC: SourceFile = {
  name: "contracts/UniswapV3Pool.sol",
  content: `pragma solidity =0.7.6;

interface IUniswapV3Pool {}

abstract contract NoDelegateCall {
    address private immutable original;
    constructor() { original = address(this); }
}

contract UniswapV3Pool is IUniswapV3Pool, NoDelegateCall {
    address public immutable override factory;
    address public immutable override token0;
    address public immutable override token1;
    uint24 public immutable override fee;
    int24 public immutable override tickSpacing;
    uint128 public immutable override maxLiquidityPerTick;

    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        uint16 observationIndex;
        uint16 observationCardinality;
        uint16 observationCardinalityNext;
        uint8 feeProtocol;
        bool unlocked;
    }
    Slot0 public override slot0;

    uint256 public override feeGrowthGlobal0X128;
    uint256 public override feeGrowthGlobal1X128;

    struct ProtocolFees {
        uint128 token0;
        uint128 token1;
    }
    ProtocolFees public override protocolFees;

    uint128 public override liquidity;

    mapping(int24 => Tick.Info) public override ticks;
    mapping(int16 => uint256) public override tickBitmap;
    mapping(bytes32 => Position.Info) public override positions;
    Oracle.Observation[65535] public override observations;

    modifier lock() {
        require(slot0.unlocked, 'LOK');
        slot0.unlocked = false;
        _;
        slot0.unlocked = true;
    }

    function probe(int24 tick) external view returns (uint128 a, uint128 b, address c) {
        Slot0 memory slot0Start = slot0;
        a = liquidity + protocolFees.token0 + uint128(slot0Start.tick);
        b = ticks[tick].liquidityGross;
        c = token0;
        (uint256 x, int24 t) = (feeGrowthGlobal0X128, slot0.tick);
    }

    function peek() external view returns (int24, uint160, uint16) {
        return (slot0.tick, slot0.sqrtPriceX96, observations[0].blockTimestamp);
    }
}
`,
};
const poolIndex = buildSolIndex([POOL_SRC]);
const poolLayout = pool.storageLayout as unknown as HoverStorageLayout;
const poolAt = (snippet: string, word: string) =>
  stateVarValueAt({
    index: poolIndex, layout: poolLayout, contractName: pool.contractName, storage: pool.slots, ...at(POOL_SRC, snippet, word),
  });

describe("stateVarValueAt on a Uniswap V3 pool (real layout and slots)", () => {
  // slot 0 = 0x00 01 00 02d3 02d3 026d 0303ac 0000000000004c140e73c3c9dd86f542e3f76273
  it("reads the packed members of struct slot0", () => {
    expect(poolAt("return (slot0.tick,", "tick")).toEqual({
      name: "slot0.tick", type: "int24", value: "197548", source: "storage",
    });
    expect(poolAt("slot0.sqrtPriceX96, observations", "sqrtPriceX96")?.value)
      .toBe(BigInt("0x4c140e73c3c9dd86f542e3f76273").toString());
    expect(poolAt("require(slot0.unlocked, 'LOK');", "unlocked")).toEqual({
      name: "slot0.unlocked", type: "bool", value: "true", source: "storage",
    });
  });

  it("describes the struct itself, a mapping and a fixed array", () => {
    expect(poolAt("require(slot0.unlocked, 'LOK');", "slot0")?.value).toBe("struct UniswapV3Pool.Slot0 at slot 0");
    expect(poolAt("mapping(int24 => Tick.Info) public override ticks;", "ticks")?.value)
      .toBe("mapping(int24 => struct Tick.Info) at slot 5");
    expect(poolAt("public override observations;", "observations")?.value)
      .toBe("struct Oracle.Observation[65535] at slot 8");
  });

  it("reads a uint128 and a member of a second struct", () => {
    expect(poolAt("a = liquidity + protocolFees.token0", "liquidity")?.value)
      .toBe(BigInt("0x9056af32d6badf23").toString());
    expect(poolAt("a = liquidity + protocolFees.token0", "token0")).toEqual({
      name: "protocolFees.token0", type: "uint128", value: "0", source: "storage",
    });
  });

  it("returns null for an immutable, which has no storage slot", () => {
    expect(poolAt("c = token0;", "token0")).toBeNull();
    expect(poolAt("address public immutable override factory;", "factory")).toBeNull();
  });

  it("returns null for a member of a memory copy and for a parameter with a member's name", () => {
    expect(poolAt("uint128(slot0Start.tick)", "tick")).toBeNull();
    expect(poolAt("b = ticks[tick].liquidityGross;", "tick")).toBeNull();
    expect(poolAt("b = ticks[tick].liquidityGross;", "ticks")).toBeNull();
    expect(poolAt("b = ticks[tick].liquidityGross;", "liquidityGross")).toBeNull();
    expect(poolAt("observations[0].blockTimestamp", "observations")).toBeNull();
  });

  it("reads state inside a tuple expression of a function with other locals", () => {
    // `probe` declares the locals `x`, `t` and `slot0Start`; `slot0.tick` is still the state struct.
    expect(poolAt("(feeGrowthGlobal0X128, slot0.tick);", "tick")?.value).toBe("197548");
    expect(poolAt("(feeGrowthGlobal0X128, slot0.tick);", "feeGrowthGlobal0X128")?.value)
      .toBe(BigInt("0x9f3beb23cb71ce6c05f492ff715f").toString());
  });

  it("returns null on a field inside the struct definition", () => {
    expect(poolAt("int24 tick;", "tick")).toBeNull();
    expect(poolAt("bool unlocked;", "unlocked")).toBeNull();
    expect(poolAt("struct Slot0 {", "Slot0")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Synthetic cases: layouts written by hand in the shape solc emits.
// ---------------------------------------------------------------------------
const T = {
  t_uint256: { encoding: "inplace", label: "uint256", numberOfBytes: "32" },
  t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
  t_bool: { encoding: "inplace", label: "bool", numberOfBytes: "1" },
  t_uint8: { encoding: "inplace", label: "uint8", numberOfBytes: "1" },
  t_int16: { encoding: "inplace", label: "int16", numberOfBytes: "2" },
  t_bytes4: { encoding: "inplace", label: "bytes4", numberOfBytes: "4" },
  "t_contract(IERC20)1": { encoding: "inplace", label: "contract IERC20", numberOfBytes: "20" },
  "t_enum(State)2": { encoding: "inplace", label: "enum Vault.State", numberOfBytes: "1" },
  "t_mapping(t_uint256,t_uint256)": {
    encoding: "mapping", label: "mapping(uint256 => uint256)", numberOfBytes: "32", key: "t_uint256", value: "t_uint256",
  },
  "t_array(t_uint256)dyn_storage": { encoding: "dynamic_array", label: "uint256[]", numberOfBytes: "32", base: "t_uint256" },
};
const entry = (label: string, slot: number, offset: number, type: string) =>
  ({ label, slot: String(slot), offset, type, contract: "V.sol:Vault" });

const VAULT: SourceFile = {
  name: "V.sol",
  content: `pragma solidity ^0.8.20;
interface IERC20 { function balanceOf(address a) external view returns (uint256); }
library Lib { function f(uint256 nonces) internal pure returns (uint256) { return nonces; } }
contract Base {
    uint256 private x;
    function baseX() public view returns (uint256) { return x; }
}
contract Vault is Base {
    enum State { Idle, Active, Closed }
    event Paused(bool paused);
    error Bad(uint8 fee);
    struct Cfg { bool paused; uint8 fee; }
    uint256 public constant MAX = 10;
    uint256 private x;
    mapping(uint256 => uint256) public nonces;
    address public owner;
    bool public paused;
    uint8 public fee;
    int16 public delta;
    bytes4 public tag;
    IERC20 public token;
    State public state;
    uint256[] public list;

    function read() external view returns (uint256 r) {
        r = x + nonces[0] + nonces[fee] + MAX + list.length + uint256(state);
        r += token.balanceOf(owner) + uint16(delta) + uint32(tag);
        if (paused) { r = 0; }
    }
    function later() external view returns (uint256) {
        uint256 a = fee;
        uint8 fee = 3;
        return a + fee;
    }
    function named() external {
        emit Paused(paused);
        this.cfg({paused: true, fee: fee});
    }
    function cfg(bool paused, uint8 fee) external {}
    modifier whenLive() { require(!paused); _; }
}
`,
};
const vaultIndex = buildSolIndex([VAULT]);
const vaultLayout: HoverStorageLayout = {
  storage: [
    entry("x", 0, 0, "t_uint256"),
    entry("x", 1, 0, "t_uint256"),
    entry("nonces", 2, 0, "t_mapping(t_uint256,t_uint256)"),
    entry("owner", 3, 0, "t_address"),
    entry("paused", 3, 20, "t_bool"),
    entry("fee", 3, 21, "t_uint8"),
    entry("delta", 3, 22, "t_int16"),
    entry("tag", 3, 24, "t_bytes4"),
    entry("token", 4, 0, "t_contract(IERC20)1"),
    entry("state", 4, 20, "t_enum(State)2"),
    entry("list", 5, 0, "t_array(t_uint256)dyn_storage"),
  ],
  types: T,
};
const word = (hex: string) => "0x" + hex.padStart(64, "0");
// slot 3, from the high end: tag deadbeef | delta fffe (-2) | fee 07 | paused 01 | owner 11…11
const SLOT3 = word("deadbeef" + "fffe" + "07" + "01" + "11".repeat(20));
const vaultStorage: Record<string, string> = {
  [word("0")]: word("aa"),
  [word("1")]: word("bb"),
  [word("3")]: SLOT3,
  [word("4")]: word("01" + "22".repeat(20)),
  // nonces[0] lives at keccak256(pad32(0) ++ pad32(2)), the well-known slot of key 0 in a mapping at slot 2.
  ["0xac33ff75c19e70fe83507db0d683fd3465c996598dc972688b7ace676c89077b"]: word("2a"),
};
const vaultAt = (snippet: string, w: string, storage: Record<string, string> | null = vaultStorage, layout = vaultLayout) =>
  stateVarValueAt({ index: vaultIndex, layout, contractName: "Vault", storage, ...at(VAULT, snippet, w) });

describe("stateVarValueAt: packing, types and inheritance (synthetic)", () => {
  it("reads every packed variable of one slot", () => {
    expect(vaultAt("token.balanceOf(owner)", "owner")?.value).toBe(getAddress("0x" + "11".repeat(20)));
    expect(vaultAt("if (paused)", "paused")?.value).toBe("true");
    expect(vaultAt("uint256 a = fee;", "a")).toBeNull();
    expect(vaultAt("uint16(delta)", "delta")).toEqual({ name: "delta", type: "int16", value: "-2", source: "storage" });
    expect(vaultAt("uint32(tag)", "tag")?.value).toBe("0xdeadbeef");
  });

  it("shows a contract-typed variable as an address and an enum with its member name", () => {
    expect(vaultAt("token.balanceOf(owner)", "token")).toEqual({
      name: "token", type: "contract IERC20", value: getAddress("0x" + "22".repeat(20)), source: "storage",
    });
    expect(vaultAt("uint256(state)", "state")?.value).toBe("Active (1)");
    expect(vaultAt("token.balanceOf(owner)", "balanceOf")).toBeNull();
  });

  it("shows only the number when the enum value is out of range", () => {
    const s = { ...vaultStorage, [word("4")]: word("09" + "22".repeat(20)) };
    expect(vaultAt("uint256(state)", "state", s)?.value).toBe("9");
  });

  it("returns null for a bool byte that is not 0 or 1", () => {
    const s = { ...vaultStorage, [word("3")]: word("02" + "11".repeat(20)) };
    expect(vaultAt("if (paused)", "paused", s)).toBeNull();
  });

  it("gives each contract its own private variable of a repeated name", () => {
    expect(vaultAt("function baseX() public view returns (uint256) { return x; }", "x")?.value).toBe("170");
    expect(vaultAt("r = x + nonces[0]", "x")?.value).toBe("187");
  });

  it("returns null for a repeated name when the source order does not match the layout", () => {
    const extra = { ...vaultLayout, storage: [...vaultLayout.storage, entry("gap", 6, 0, "t_uint256")] };
    expect(vaultAt("r = x + nonces[0]", "x", vaultStorage, extra)).toBeNull();
    const one = { ...vaultLayout, storage: vaultLayout.storage.slice(1) };
    expect(vaultAt("r = x + nonces[0]", "x", vaultStorage, one)).toBeNull();
  });

  it("returns null for a constant", () => {
    expect(vaultAt("+ MAX +", "MAX")).toBeNull();
  });

  it("reads a mapping element with a literal key and refuses an expression key", () => {
    expect(vaultAt("nonces[0] +", "nonces")).toEqual({
      name: "nonces[0]", type: "uint256", value: "42", source: "storage",
    });
    expect(vaultAt("nonces[fee]", "nonces")).toBeNull();
    expect(vaultAt("nonces[fee]", "fee")?.value).toBe("7");
  });

  it("describes a dynamic array", () => {
    expect(vaultAt("list.length", "list")?.value).toBe("uint256[] at slot 5");
    expect(vaultAt("list.length", "length")).toBeNull();
  });

  it("returns null when the function declares a local of that name, also below the use", () => {
    expect(vaultAt("uint256 a = fee;", "fee")).toBeNull();
    expect(vaultAt("return a + fee;", "fee")).toBeNull();
  });

  it("returns null for parameters, named arguments, events, errors and struct fields", () => {
    expect(vaultAt("function cfg(bool paused, uint8 fee)", "paused")).toBeNull();
    expect(vaultAt("this.cfg({paused: true, fee: fee});", "paused")).toBeNull();
    expect(vaultAt("{paused: true, fee: fee}", "fee")).toBeNull();
    expect(vaultAt("event Paused(bool paused);", "paused")).toBeNull();
    expect(vaultAt("error Bad(uint8 fee);", "fee")).toBeNull();
    expect(vaultAt("struct Cfg { bool paused; uint8 fee; }", "paused")).toBeNull();
    expect(vaultAt("emit Paused(paused);", "Paused")).toBeNull();
  });

  it("reads the argument of an emit and the condition of a modifier", () => {
    expect(vaultAt("Paused(paused);", "paused);")?.value).toBe("true");
    expect(vaultAt("require(!paused); _;", "paused")?.value).toBe("true");
  });

  it("reads the value in a named argument position", () => {
    expect(vaultAt("fee: fee});", "fee});")?.value).toBe("7");
  });

  it("returns null in a library and for an unknown file", () => {
    expect(vaultAt("return nonces; }", "nonces")).toBeNull();
    expect(stateVarValueAt({
      index: vaultIndex, layout: vaultLayout, contractName: "Vault", storage: vaultStorage, file: "Other.sol", line: 1, col: 0,
    })).toBeNull();
  });

  it("returns null when two contracts in the files have one name", () => {
    const twice = buildSolIndex([VAULT, { name: "W.sol", content: "contract Base { uint256 private x; }" }]);
    expect(stateVarValueAt({
      index: twice, layout: vaultLayout, contractName: "Vault", storage: vaultStorage, ...at(VAULT, "if (paused)", "paused"),
    })).toBeNull();
  });

  it("does not note a write that leaves this packed variable as it was", () => {
    const prev = { ...vaultStorage, [word("3")]: word("deadbeef" + "fffe" + "07" + "00" + "11".repeat(20)) };
    const run = (snippet: string, w: string) => stateVarValueAt({
      index: vaultIndex, layout: vaultLayout, contractName: "Vault", ...at(VAULT, snippet, w),
      storage: vaultStorage, prevStorage: prev, writtenSlot: word("3"),
    });
    expect(run("token.balanceOf(owner)", "owner")?.note).toBeUndefined();
    expect(run("if (paused)", "paused")?.note).toBe("written at this step: false → true");
  });

  it("resolves the slot without a storage map", () => {
    const ref = resolveStateVar({ index: vaultIndex, layout: vaultLayout, contractName: "Vault", ...at(VAULT, "uint16(delta)", "delta") });
    expect(ref).toMatchObject({ name: "delta", slot: 3n, offset: 22, numberOfBytes: 2, kind: "value" });
  });
});
