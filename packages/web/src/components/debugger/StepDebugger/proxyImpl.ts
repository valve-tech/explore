import type { CallFrame } from "../../../api/debugger";
import type { SourceFile } from "../../../api/source";
import { findFunctionLine } from "./findFunctionLine";

/**
 * Map every proxy address in the trace to the implementation it delegates to.
 *
 * A frame whose child is a DELEGATECALL is a proxy: the child's `to` is the
 * address whose CODE actually runs (storage stays the proxy's). AMB bridges use
 * EternalStorageProxy / OwnedUpgradeabilityProxy, so the *called* function
 * (`submitSignature`, `requiredSignatures`, `isValidator`) is defined only in
 * the implementation's verified source — never the proxy's fallback boilerplate.
 *
 * The map is built trace-wide, so a call to a proxy that had no delegate child
 * captured on its own frame (e.g. a view call the tracer didn't expand) still
 * resolves via a sibling call to the same proxy that did delegate. First
 * delegate wins — a proxy points at one implementation per transaction.
 */
export function buildImplByProxy(
  root: CallFrame | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (frame: CallFrame) => {
    const proxy = frame.to?.toLowerCase();
    if (proxy && !map.has(proxy)) {
      for (const child of frame.calls ?? []) {
        if (child.type === "DELEGATECALL" && child.to) {
          map.set(proxy, child.to.toLowerCase());
          break;
        }
      }
    }
    for (const child of frame.calls ?? []) visit(child);
  };
  if (root) visit(root);
  return map;
}

/**
 * Outcome of a proxy-aware function lookup, mirroring the three states the
 * debugger's click handler already distinguishes (plus the found case):
 *   - `hit`        — located; `addr` is whichever candidate matched.
 *   - `loading`    — the preferred (implementation) source is still unfetched;
 *                    the caller should keep waiting rather than error.
 *   - `unverified` — every candidate resolved but none had any source.
 *   - `notfound`   — sources were present but none declared the function.
 */
export type FnLookup =
  | { status: "hit"; line: number; file: string; addr: string }
  | { status: "loading" }
  | { status: "unverified"; where: string }
  | { status: "notfound"; where: string };

/**
 * Locate a called function's declaration line, PREFERRING the implementation's
 * source when `contractAddr` is a proxy. Candidates are searched impl-first,
 * then the proxy itself — so a proxied call resolves in the delegate's source
 * (fixing "Couldn't locate `requiredSignatures()` in <proxy>'s source"), while a
 * plain contract call still resolves in its own source, and a genuinely
 * proxy-native symbol (`implementation()`) still falls back to the proxy.
 *
 * `loading` is returned if any candidate's source is still unfetched, so the
 * caller waits for the preferred implementation rather than erroring on the
 * proxy that happens to have loaded first.
 */
export function locateProxyAwareFunction(
  sourcesByAddr: Record<string, SourceFile[]>,
  implByProxy: Map<string, string>,
  contractAddr: string | undefined,
  funcName: string,
): FnLookup {
  const proxyKey = contractAddr?.toLowerCase();
  const implKey = proxyKey ? implByProxy.get(proxyKey) : undefined;

  // Impl first, then the proxy itself; dedupe preserving order.
  const seen = new Set<string>();
  const candidates = [implKey, proxyKey].filter(
    (a): a is string => !!a && !seen.has(a) && (seen.add(a), true),
  );
  const where = contractAddr ? `${contractAddr.slice(0, 8)}…` : "this contract";

  let anyMissing = false;
  let anySearched = false;
  for (const addr of candidates) {
    const files = sourcesByAddr[addr];
    if (files === undefined) {
      anyMissing = true;
      continue;
    }
    if (files.length === 0) continue;
    anySearched = true;
    const hit = findFunctionLine(files, funcName);
    if (hit) return { status: "hit", line: hit.line, file: hit.file, addr };
  }

  // A preferred candidate is still loading → wait, don't error prematurely.
  if (anyMissing) return { status: "loading" };
  // Some source was searched but the function wasn't there.
  if (anySearched) return { status: "notfound", where };
  // Nothing had any verified source at all.
  return { status: "unverified", where };
}
