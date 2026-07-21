import { describe, it, expect } from "vitest";
import { buildImplByProxy, locateProxyAwareFunction } from "../proxyImpl";
import type { CallFrame } from "../../../../api/debugger";
import type { SourceFile } from "../../../../api/source";

/** Minimal CallFrame factory — only the fields the resolver reads. */
function frame(
  type: string,
  to: string | undefined,
  calls: CallFrame[] = [],
): CallFrame {
  return {
    type,
    from: "0x0000000000000000000000000000000000000000",
    to,
    gas: "0x0",
    gasUsed: "0x0",
    input: "0x",
    calls,
  } as CallFrame;
}

const PROXY = "0x0fd542ff87cd22db5402c92decb13d2bdfb995b7";
const IMPL = "0x708ca176559a8aa87badcad8bc6a72539d0e3cbb";

describe("buildImplByProxy", () => {
  it("maps a proxy to the implementation it DELEGATECALLs", () => {
    const root = frame("CALL", PROXY, [frame("DELEGATECALL", IMPL)]);
    const map = buildImplByProxy(root);
    expect(map.get(PROXY)).toBe(IMPL);
  });

  it("lower-cases both proxy and implementation keys", () => {
    const root = frame("CALL", PROXY.toUpperCase(), [
      frame("DELEGATECALL", IMPL.toUpperCase()),
    ]);
    const map = buildImplByProxy(root);
    expect(map.get(PROXY)).toBe(IMPL);
  });

  it("does not map a plain CALL with no delegate child", () => {
    const root = frame("CALL", PROXY, [frame("CALL", IMPL)]);
    expect(buildImplByProxy(root).has(PROXY)).toBe(false);
  });

  it("learns a proxy→impl mapping trace-wide (a sibling call without its own delegate child still resolves)", () => {
    // Two calls to the same validator proxy: the first (requiredSignatures) had
    // no captured delegate child, the second (isValidator) delegatecalls to the
    // impl. The map must know PROXY→IMPL so the childless call resolves too.
    const root = frame("DELEGATECALL", "0xd346c53c659d9d1dae7a915dd2e6bfeab5cb50b8", [
      frame("STATICCALL", PROXY), // no delegate child captured
      frame("STATICCALL", PROXY, [frame("DELEGATECALL", IMPL)]),
    ]);
    const map = buildImplByProxy(root);
    expect(map.get(PROXY)).toBe(IMPL);
  });

  it("recurses into nested frames", () => {
    const inner = "0xaaaa000000000000000000000000000000000000";
    const innerImpl = "0xbbbb000000000000000000000000000000000000";
    const root = frame("CALL", PROXY, [
      frame("DELEGATECALL", IMPL, [
        frame("CALL", inner, [frame("DELEGATECALL", innerImpl)]),
      ]),
    ]);
    const map = buildImplByProxy(root);
    expect(map.get(PROXY)).toBe(IMPL);
    expect(map.get(inner)).toBe(innerImpl);
  });

  it("returns an empty map for a null root", () => {
    expect(buildImplByProxy(null).size).toBe(0);
  });
});

const proxyFiles: SourceFile[] = [
  {
    name: "Contract.sol",
    content: [
      "contract EternalStorageProxy is Proxy {",
      "  function implementation() public view returns (address) {",
      "    return _implementation;",
      "  }",
      "}",
    ].join("\n"),
  },
];

const implFiles: SourceFile[] = [
  {
    name: "Contract.sol",
    content: [
      "contract BridgeValidators {",
      "  function isValidator(address a) public view returns (bool) {}",
      "  function requiredSignatures() public view returns (uint256) {}",
      "}",
    ].join("\n"),
  },
];

describe("locateProxyAwareFunction", () => {
  const implByProxy = new Map([[PROXY, IMPL]]);

  it("resolves a proxied function against the IMPLEMENTATION's source, not the proxy's", () => {
    const sources = { [PROXY]: proxyFiles, [IMPL]: implFiles };
    const r = locateProxyAwareFunction(sources, implByProxy, PROXY, "requiredSignatures");
    expect(r.status).toBe("hit");
    if (r.status === "hit") {
      expect(r.addr).toBe(IMPL);
      expect(r.line).toBe(3); // requiredSignatures line in implFiles
      expect(r.file).toBe("Contract.sol");
    }
  });

  it("still resolves a plain (non-proxy) contract's own function", () => {
    const other = "0xcccc000000000000000000000000000000000000";
    const sources = { [other]: implFiles };
    const r = locateProxyAwareFunction(sources, new Map(), other, "isValidator");
    expect(r.status).toBe("hit");
    if (r.status === "hit") expect(r.addr).toBe(other);
  });

  it("prefers the implementation even when the proxy also defines the name", () => {
    // Proxy has implementation(); impl also has implementation() — impl wins.
    const implWithImpl: SourceFile[] = [
      {
        name: "Contract.sol",
        content: "contract L {\n  function implementation() public {}\n}",
      },
    ];
    const sources = { [PROXY]: proxyFiles, [IMPL]: implWithImpl };
    const r = locateProxyAwareFunction(sources, implByProxy, PROXY, "implementation");
    expect(r.status === "hit" && r.addr).toBe(IMPL);
  });

  it("falls back to the proxy's own source when the impl lacks the function", () => {
    const sources = { [PROXY]: proxyFiles, [IMPL]: implFiles };
    const r = locateProxyAwareFunction(sources, implByProxy, PROXY, "implementation");
    expect(r.status).toBe("hit");
    if (r.status === "hit") expect(r.addr).toBe(PROXY);
  });

  it("waits (loading) while the preferred impl source is still unfetched", () => {
    // impl key absent from sources (undefined) → still loading, even though the
    // proxy is present without the function. Don't error prematurely.
    const sources = { [PROXY]: proxyFiles };
    const r = locateProxyAwareFunction(sources, implByProxy, PROXY, "requiredSignatures");
    expect(r.status).toBe("loading");
  });

  it("reports not-found when every candidate has source but none defines the function", () => {
    const sources = { [PROXY]: proxyFiles, [IMPL]: implFiles };
    const r = locateProxyAwareFunction(sources, implByProxy, PROXY, "noSuchFunction");
    expect(r.status).toBe("notfound");
    if (r.status === "notfound") expect(r.where).toContain("0x0fd542");
  });

  it("reports unverified when all candidate sources are empty", () => {
    const sources = { [PROXY]: [], [IMPL]: [] };
    const r = locateProxyAwareFunction(sources, implByProxy, PROXY, "requiredSignatures");
    expect(r.status).toBe("unverified");
  });
});
