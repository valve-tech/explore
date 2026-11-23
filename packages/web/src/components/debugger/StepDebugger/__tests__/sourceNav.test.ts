import { describe, expect, it } from "vitest";
import type { SourceFile } from "../../../../api/source";
import { resolveSourceClick, type ClickInput, type NavAction } from "../sourceNav/resolveClick";
import { buildSolIndex } from "../sourceNav/solIndex";
import { linearize } from "../sourceNav/linearize";
import { describeAction, describeTarget } from "../sourceNav/describeAction";

const IERC20: SourceFile = {
  name: "contracts/IERC20.sol",
  content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}
`,
};

const ERC20: SourceFile = {
  name: "contracts/ERC20.sol",
  content: `pragma solidity ^0.8.20;

import {IERC20} from "./IERC20.sol";

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }
}

contract ERC20 is Context, IERC20 {
    mapping(address => uint256) private _balances;
    uint256 private _totalSupply;
    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);

    modifier nonZero(address a) {
        require(a != address(0), "zero { address");
        _;
    }

    function totalSupply() public view virtual returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 value) public virtual nonZero(to) returns (bool) {
        address owner = _msgSender();
        _update(owner, to, value);
        return true;
    }

    // _update moves value. function _update(fake) {
    function _update(address from, address to, uint256 value) internal virtual {
        uint256 fromBalance = _balances[from];
        if (fromBalance < value) {
            revert ERC20InsufficientBalance(from, fromBalance, value);
        }
        _balances[from] = fromBalance - value;
        _balances[to] += value;
        emit Transfer(from, to, value);
    }
}
`,
};

const MYTOKEN: SourceFile = {
  name: "contracts/MyToken.sol",
  content: `pragma solidity ^0.8.20;

import "./ERC20.sol";

contract MyToken is ERC20 {
    enum Mode { Open, Paused }
    Mode public mode;
    uint256 public fee;

    function _update(address from, address to, uint256 value) internal override {
        if (mode == Mode.Paused) revert("paused");
        super._update(from, to, value - fee);
    }

    function mint(address to) external { _mint(to); }
    function _mint(address to, uint256 amount) internal { _update(address(0), to, amount); }
    function _mint(address to) internal { _mint(to, 1); }
}
`,
};

const VAULT: SourceFile = {
  name: "contracts/Vault.sol",
  content: `pragma solidity ^0.8.20;

import "./IERC20.sol";

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        require(token.transfer(to, value), "fail");
    }
}

contract Vault {
    using SafeERC20 for IERC20;
    IERC20 public asset;

    function pay(address to, uint256 amt) external {
        asset.safeTransfer(to, amt);
        IERC20(address(asset)).transfer(to, amt);
    }
}
`,
};

const PROXY: SourceFile = {
  name: "Proxy.sol",
  content: `pragma solidity ^0.8.20;

contract Proxy {
    address internal _impl;
    function _delegate(address impl) internal { assembly { let r := delegatecall(gas(), impl, 0, 0, 0, 0) } }
    fallback() external payable { _delegate(_impl); }
}
`,
};

const TOKEN = [IERC20, ERC20, MYTOKEN];
const VAULT_SET = [IERC20, VAULT];

/** Line (1-based) of the first line that holds `snippet`. */
function lineOf(f: SourceFile, snippet: string): number {
  const i = f.content.split("\n").findIndex((l) => l.includes(snippet));
  if (i === -1) throw new Error("fixture has no " + snippet);
  return i + 1;
}

/** Click `word` inside the first line that holds `snippet`. */
function click(files: SourceFile[], f: SourceFile, snippet: string, word: string, extra: Partial<ClickInput> = {}): NavAction {
  const line = lineOf(f, snippet);
  const text = f.content.split("\n")[line - 1]!;
  const col = text.indexOf(snippet) + snippet.indexOf(word) + 1;
  return resolveSourceClick({ files, file: f.name, line, col, modifier: "plain", ...extra });
}

const goto = (a: NavAction) => {
  if (a.type !== "goto") throw new Error("expected goto, got " + a.type);
  return a;
};

describe("linearize", () => {
  it("puts the rightmost base first after the contract (C3)", () => {
    const index = buildSolIndex([{ name: "d.sol", content: "contract A {} contract B is A {} contract C is A {} contract D is B, C {}" }]);
    expect(linearize(index, "D")).toEqual(["D", "C", "B", "A"]);
  });
  it("survives an inheritance cycle", () => {
    const index = buildSolIndex([{ name: "c.sol", content: "contract A is B {} contract B is A {}" }]);
    expect(linearize(index, "A")).toEqual(["A", "B"]);
  });
});

describe("function call → implementation", () => {
  it("goes to the most-derived override of the executing contract", () => {
    const a = goto(click(TOKEN, ERC20, "_update(owner, to, value)", "_update", { contractName: "MyToken" }));
    expect(a.target).toMatchObject({ file: MYTOKEN.name, line: lineOf(MYTOKEN, "function _update"), owner: "MyToken", hasBody: true });
  });
  it("finds the most-derived contract without a name hint", () => {
    expect(goto(click(TOKEN, ERC20, "_update(owner, to, value)", "_update")).target.owner).toBe("MyToken");
  });
  it("stays in the base when the base itself is the executing contract", () => {
    const a = goto(click(TOKEN, ERC20, "_update(owner, to, value)", "_update", { contractName: "ERC20" }));
    expect(a.target).toMatchObject({ file: ERC20.name, line: lineOf(ERC20, "function _update(address from"), owner: "ERC20" });
  });
  it("ignores a declaration that sits in a comment", () => {
    const index = buildSolIndex(TOKEN);
    const decls = index.byName.get("ERC20")!.members.filter((d) => d.name === "_update");
    expect(decls).toHaveLength(1);
  });
  it("goes from an interface declaration to the body, never the reverse", () => {
    const a = goto(click(TOKEN, IERC20, "function transfer(", "transfer"));
    expect(a.target).toMatchObject({ file: ERC20.name, line: lineOf(ERC20, "function transfer("), hasBody: true });
    expect(a.interfaceOnly).toBeUndefined();
  });
  it("resolves super.f() to the next base", () => {
    const a = goto(click(TOKEN, MYTOKEN, "super._update(", "_update"));
    expect(a.target).toMatchObject({ file: ERC20.name, owner: "ERC20", line: lineOf(ERC20, "function _update(address from") });
  });
  it("chooses an overload by argument count", () => {
    expect(goto(click(TOKEN, MYTOKEN, "{ _mint(to); }", "_mint")).target.line).toBe(lineOf(MYTOKEN, "function _mint(address to) internal"));
    expect(goto(click(TOKEN, MYTOKEN, "{ _mint(to, 1); }", "_mint")).target.line).toBe(lineOf(MYTOKEN, "function _mint(address to, uint256 amount)"));
  });
  it("does nothing on a declaration that is already the implementation", () => {
    expect(click(TOKEN, MYTOKEN, "function _update(", "_update").type).toBe("none");
  });
});

describe("calls through an interface type", () => {
  const callee = [{ addr: "0xIMPL", files: TOKEN }];
  it("goes to the implementation in the callee contract of the trace", () => {
    const a = goto(click(VAULT_SET, VAULT, "IERC20(address(asset)).transfer(", "transfer", { callee }));
    expect(a.target).toMatchObject({ addr: "0xIMPL", file: ERC20.name, line: lineOf(ERC20, "function transfer("), hasBody: true });
    expect(a.interfaceOnly).toBeUndefined();
  });
  it("skips a proxy callee and never lands on its fallback", () => {
    const viaProxy = [{ addr: "0xIMPL", files: TOKEN }, { addr: "0xPROXY", files: [PROXY] }];
    const a = goto(click(VAULT_SET, VAULT, "token.transfer(to, value)", "transfer", { callee: viaProxy }));
    expect(a.target).toMatchObject({ addr: "0xIMPL", file: ERC20.name, kind: "function" });
    const onlyProxy = goto(click(VAULT_SET, VAULT, "token.transfer(to, value)", "transfer", { callee: [viaProxy[1]!] }));
    expect(onlyProxy.target.file).toBe(IERC20.name);
    expect(onlyProxy.interfaceOnly).toBe(true);
  });
  it("uses an implementation of the file set when the trace has no callee", () => {
    const a = goto(click([...VAULT_SET, ERC20], VAULT, "token.transfer(to, value)", "transfer"));
    expect(a.target).toMatchObject({ file: ERC20.name, hasBody: true });
    expect(a.target.addr).toBeUndefined();
  });
  it("falls back to the interface and says so", () => {
    const a = goto(click(VAULT_SET, VAULT, "token.transfer(to, value)", "transfer"));
    expect(a.target).toMatchObject({ file: IERC20.name, hasBody: false, line: lineOf(IERC20, "function transfer(") });
    expect(a.interfaceOnly).toBe(true);
    expect(a.note).toMatch(/interface declaration/);
    expect(describeAction(a)).toMatch(/no implementation source/);
  });
  it("resolves a using-for library call to the library function", () => {
    const a = goto(click(VAULT_SET, VAULT, "asset.safeTransfer(", "safeTransfer", { callee }));
    expect(a.target).toMatchObject({ file: VAULT.name, owner: "SafeERC20", line: lineOf(VAULT, "function safeTransfer(") });
  });
});

describe("identifiers", () => {
  const cases: Array<[string, SourceFile, string, string, SourceFile, string, string]> = [
    ["local variable", ERC20, "if (fromBalance < value)", "fromBalance", ERC20, "uint256 fromBalance =", "local"],
    ["parameter", ERC20, "_balances[from] = fromBalance", "from", ERC20, "function _update(address from", "local"],
    ["state variable", ERC20, "return _balances[account]", "_balances", ERC20, "private _balances;", "state-var"],
    ["modifier name", ERC20, "nonZero(to) returns", "nonZero", ERC20, "modifier nonZero", "modifier"],
    ["event in emit", ERC20, "emit Transfer(", "Transfer", IERC20, "event Transfer(", "event"],
    ["error in revert", ERC20, "revert ERC20InsufficientBalance(", "ERC20InsufficientBalance", ERC20, "error ERC20InsufficientBalance", "error"],
    ["enum type", MYTOKEN, "Mode public mode", "Mode", MYTOKEN, "enum Mode", "enum"],
    ["enum member", MYTOKEN, "Mode.Paused", "Paused", MYTOKEN, "enum Mode", "enum"],
    ["base contract name", MYTOKEN, "is ERC20 {", "ERC20", ERC20, "contract ERC20 is", "contract"],
    ["interface name", ERC20, "is Context, IERC20", "IERC20", IERC20, "interface IERC20", "interface"],
  ];
  it.each(cases)("%s → its declaration", (_n, f, snippet, word, tf, tsnippet, kind) => {
    const a = goto(click(TOKEN, f, snippet, word));
    expect(a.target).toMatchObject({ file: tf.name, line: lineOf(tf, tsnippet), kind });
  });
  it("opens the file of an import path", () => {
    expect(click(TOKEN, MYTOKEN, 'import "./ERC20.sol"', "ERC20.sol")).toEqual({ type: "open-file", file: ERC20.name });
    expect(click(TOKEN, ERC20, '"./IERC20.sol"', "IERC20.sol")).toEqual({ type: "open-file", file: IERC20.name });
  });
  it.each([
    ["a global", ERC20, "return msg.sender", "msg"],
    ["a member of a global", ERC20, "return msg.sender", "sender"],
    ["a keyword", ERC20, "return true", "return"],
    ["a literal", ERC20, "return true", "true"],
    ["a comment", ERC20, "// _update moves value", "_update"],
    ["a string", ERC20, '"zero { address"', "address"],
  ])("does nothing on %s", (_n, f, snippet, word) => {
    const a = click(TOKEN, f as SourceFile, snippet as string, word as string);
    expect(a).toEqual({ type: "none" });
    expect(describeAction(a)).toBeNull();
  });
});

describe("token class hint", () => {
  it("resolves nothing for a class that cannot navigate", () => {
    // Without the hint, the name alone resolves; the builtin class stops it.
    expect(click(TOKEN, ERC20, "_update(owner, to, value)", "_update").type).toBe("goto");
    expect(click(TOKEN, ERC20, "_update(owner, to, value)", "_update", { tokenType: "builtin" })).toEqual({ type: "none" });
    expect(click(TOKEN, ERC20, "_update(owner, to, value)", "_update", { tokenType: "keyword" })).toEqual({ type: "none" });
  });
  it("treats a function-class token as a callable name, not a local", () => {
    const files = [{ name: "s.sol", content: "contract S {\n  function run() public {}\n  function go(uint256 run) public {\n    this\n      .run\n      ();\n    run;\n  }\n}\n" }];
    const at = (line: number, tokenType: string) => resolveSourceClick({ files, file: "s.sol", line, col: 5, modifier: "plain", tokenType });
    // Line 7: the bare word. As an identifier it is the parameter (line 3);
    // as a function-class token it is the function (line 2).
    expect(at(7, "identifier")).toMatchObject({ type: "goto", target: { line: 3, kind: "local" } });
    expect(at(7, "function")).toMatchObject({ type: "goto", target: { line: 2, kind: "function" } });
  });
});

describe("modifiers", () => {
  it("alt lists every definition, implementation first", () => {
    const a = click(TOKEN, ERC20, "_update(owner, to, value)", "_update", { modifier: "alt" });
    if (a.type !== "list") throw new Error("expected list");
    expect(a.targets.map((t) => t.owner)).toEqual(["MyToken", "ERC20"]);
    const t = click(TOKEN, ERC20, "function transfer(", "transfer", { modifier: "alt" });
    if (t.type !== "list") throw new Error("expected list");
    expect(t.targets.map((x) => [x.owner, x.hasBody])).toEqual([["ERC20", true], ["IERC20", false]]);
    expect(describeTarget(t.targets[1]!)).toMatch(/declaration only/);
  });
  it("meta on a call goes to the step of that line; elsewhere it acts as a plain click", () => {
    const line = lineOf(ERC20, "_update(owner, to, value)");
    expect(click(TOKEN, ERC20, "_update(owner, to, value)", "_update", { modifier: "meta" })).toEqual({ type: "step", label: "_update", line });
    expect(click(TOKEN, ERC20, "return _balances[account]", "_balances", { modifier: "meta" }).type).toBe("goto");
    expect(click(TOKEN, IERC20, "function transfer(", "transfer", { modifier: "meta" }).type).toBe("goto");
  });
});
