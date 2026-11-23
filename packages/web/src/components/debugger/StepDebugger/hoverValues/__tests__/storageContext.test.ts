import { describe, expect, it } from "vitest";
import type { StepDetail } from "../../../../../api/debugger";
import type { FrameRange } from "../../lineToStepIndex";
import { buildStorageModel, frameStorageAt, storageAddressAt, type SkeletonStep } from "../storageContext";

// These traces are synthetic. The production API refuses debug traces
// ("this feature is unavailable on this deployment"), so no real struct log
// was available. The shapes follow geth: a storage map only on SLOAD and
// SSTORE steps, cumulative per storage address, keys without "0x".

const PROXY = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const IMPL = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN = "0xcccccccccccccccccccccccccccccccccccccccc";
const proxy = PROXY.toLowerCase();

const w = (n: number | string) => (typeof n === "number" ? n.toString(16) : n).padStart(64, "0");
const x = (n: number | string) => "0x" + w(n);
const S = (op: string, depth: number): SkeletonStep => ({ op, depth });
/** Detail of an SLOAD or SSTORE step: the slot is the top of the stack. */
const snap = (slot: number, storage: Record<number, number>): StepDetail => ({
  // SSTORE pops the slot, then the value. An SLOAD ignores the second item.
  stack: [x(storage[slot] ?? 0), x(slot)],
  memory: [],
  storage: Object.fromEntries(Object.entries(storage).map(([k, v]) => [w(Number(k)), w(v)])),
});

describe("storage address of a frame", () => {
  // 0 SLOAD(d1) 1 DELEGATECALL(d1) 2 SLOAD(d2) 3 CALL(d2) 4 SSTORE(d3) 5 RETURN(d3) 6 SSTORE(d2) 7 RETURN(d2) 8 STOP(d1)
  const steps = [
    S("SLOAD", 1), S("DELEGATECALL", 1), S("SLOAD", 2), S("CALL", 2), S("SSTORE", 3),
    S("RETURN", 3), S("SSTORE", 2), S("RETURN", 2), S("STOP", 1),
  ];
  const frames: FrameRange[] = [
    { addr: PROXY, entry: 0, end: 9, depth: 1 },
    { addr: IMPL, entry: 2, end: 8, depth: 2 },
    { addr: TOKEN, entry: 4, end: 6, depth: 3 },
  ];
  const model = buildStorageModel(steps, frames);
  const detail: Record<number, StepDetail> = {
    0: snap(0, { 0: 7 }),
    2: snap(1, { 0: 7, 1: 5 }),
    4: snap(9, { 9: 1 }),
    6: snap(1, { 0: 7, 1: 6 }),
  };

  it("gives a DELEGATECALL frame the storage of the proxy, and a CALL frame its own", () => {
    expect(storageAddressAt(model, 0)).toBe(proxy);
    expect(storageAddressAt(model, 2)).toBe(proxy);
    expect(storageAddressAt(model, 4)).toBe(TOKEN);
    expect(storageAddressAt(model, 7)).toBe(proxy);
  });

  it("reads the implementation's variables from the proxy's cumulative map", () => {
    const fs = frameStorageAt(model, detail, 3);
    expect(fs).toEqual({
      status: "known", address: proxy, storage: { [x(0)]: x(7), [x(1)]: x(5) },
      prevStorage: null, writtenSlot: null, snapshotStep: 2,
    });
  });

  it("does not use the snapshot of a child call with another storage address", () => {
    // Step 5 is in TOKEN. Step 6 is back in the implementation.
    expect(frameStorageAt(model, detail, 5)).toMatchObject({ status: "known", address: TOKEN, storage: { [x(9)]: x(1) } });
    const back = frameStorageAt(model, { ...detail, 6: undefined as unknown as StepDetail }, 6);
    expect(back).toEqual({ status: "need-detail", address: proxy, step: 6 });
  });

  it("gives the previous map and the written slot at an SSTORE step", () => {
    expect(frameStorageAt(model, detail, 6)).toEqual({
      status: "known", address: proxy, storage: { [x(0)]: x(7), [x(1)]: x(6) },
      prevStorage: { [x(0)]: x(7), [x(1)]: x(5) }, writtenSlot: x(1), snapshotStep: 6,
    });
    // A first write in a storage address: the previous map is known to be empty.
    expect(frameStorageAt(model, detail, 4)).toMatchObject({ prevStorage: {}, writtenSlot: x(9) });
    // An SLOAD step writes nothing.
    expect(frameStorageAt(model, detail, 2)).toMatchObject({ prevStorage: { [x(0)]: x(7) }, writtenSlot: null });
  });

  it("the proxy frame sees a write that the implementation made", () => {
    expect(frameStorageAt(model, detail, 8)).toMatchObject({ status: "known", storage: { [x(1)]: x(6) }, snapshotStep: 6 });
  });

  it("asks for detail when the snapshot step is not loaded", () => {
    expect(frameStorageAt(model, { 6: detail[6]! }, 3)).toEqual({ status: "need-detail", address: proxy, step: 2 });
    expect(frameStorageAt(model, null, 3)).toEqual({ status: "need-detail", address: proxy, step: 2 });
  });

  it("refuses a snapshot that does not hold the slot it reads", () => {
    const bad = { ...detail, 2: { stack: [x(1)], memory: [], storage: {} } };
    expect(frameStorageAt(model, bad, 3).status).toBe("unknown");
  });

  it("refuses an SSTORE snapshot that holds another value than the step writes", () => {
    const bad = { ...detail, 6: { ...detail[6]!, stack: [x(99), x(1)] } };
    expect(frameStorageAt(model, bad, 7).status).toBe("unknown");
  });

  it("refuses snapshots that are not cumulative", () => {
    // Step 2 now reads slot 5. The later map at step 6 does not hold slot 5.
    const bad = { ...detail, 2: snap(5, { 0: 7, 5: 1 }) };
    expect(frameStorageAt(model, bad, 6).status).toBe("unknown");
  });

  it("accepts keys and values with the 0x prefix", () => {
    const prefixed = { 0: { stack: [x(0)], memory: [], storage: { [x(0)]: x(7) } } };
    expect(frameStorageAt(model, prefixed, 1)).toMatchObject({ status: "known", storage: { [x(0)]: x(7) } });
  });
});

describe("storage that the trace cannot vouch for", () => {
  it("knows that nothing is touched before the first storage op", () => {
    const steps = [S("PUSH1", 1), S("PUSH1", 1), S("SLOAD", 1), S("STOP", 1)];
    const model = buildStorageModel(steps, [{ addr: TOKEN, entry: 0, end: 4, depth: 1 }]);
    expect(frameStorageAt(model, {}, 1)).toEqual({
      status: "known", address: TOKEN, storage: {}, prevStorage: null, writtenSlot: null, snapshotStep: null,
    });
  });

  // 0 SLOAD(d1) 1 CALL(d1) 2 SSTORE(d2) 3 REVERT(d2) 4 SLOAD(d1) 5 STOP(d1) — a call back into the same contract reverts.
  const steps = [S("SLOAD", 1), S("CALL", 1), S("SSTORE", 2), S("REVERT", 2), S("SLOAD", 1), S("STOP", 1)];
  const frames: FrameRange[] = [
    { addr: TOKEN, entry: 0, end: 6, depth: 1 },
    { addr: TOKEN, entry: 2, end: 4, depth: 2 },
  ];
  const model = buildStorageModel(steps, frames);
  const detail = { 0: snap(0, { 0: 1 }), 2: snap(0, { 0: 2 }), 4: snap(0, { 0: 2 }) };

  it("answers inside a call that will revert", () => {
    expect(frameStorageAt(model, detail, 3)).toMatchObject({ status: "known", storage: { [x(0)]: x(2) } });
  });

  it("refuses after a reverted call wrote the same storage", () => {
    // The tracer keeps 2 in its map, but the chain rolled the slot back to 1.
    expect(frameStorageAt(model, detail, 4).status).toBe("unknown");
    expect(frameStorageAt(model, detail, 5).status).toBe("unknown");
  });

  it("still answers when the reverted call wrote another storage address", () => {
    const other = buildStorageModel(steps, [frames[0]!, { ...frames[1]!, addr: IMPL }]);
    expect(frameStorageAt(other, detail, 5)).toMatchObject({ status: "known", address: TOKEN, snapshotStep: 4 });
  });

  it("treats a frame that ends without RETURN or STOP as failed (out of gas)", () => {
    const oog = [S("SLOAD", 1), S("CALL", 1), S("SSTORE", 2), S("PUSH1", 2), S("SLOAD", 1), S("STOP", 1)];
    expect(frameStorageAt(buildStorageModel(oog, frames), detail, 5).status).toBe("unknown");
  });

  it("refuses at an SSTORE that is the failing last step of its frame", () => {
    const fail = [S("SLOAD", 1), S("CALL", 1), S("PUSH1", 2), S("SSTORE", 2), S("SLOAD", 1), S("STOP", 1)];
    const m = buildStorageModel(fail, frames);
    expect(frameStorageAt(m, { 0: detail[0], 3: snap(0, { 0: 2 }) }, 3).status).toBe("unknown");
  });

  it("refuses when a frame has no address or no known opener", () => {
    const noAddr = buildStorageModel(steps, [{ addr: null, entry: 0, end: 6, depth: 1 }, frames[1]!]);
    expect(frameStorageAt(noAddr, detail, 0).status).toBe("unknown");
    // The step before the frame entry is not a call: the frame map drifted.
    const drift = [S("SLOAD", 1), S("PUSH1", 1), S("SSTORE", 2), S("RETURN", 2), S("SLOAD", 1), S("STOP", 1)];
    const m = buildStorageModel(drift, frames);
    expect(storageAddressAt(m, 2)).toBeNull();
    expect(frameStorageAt(m, detail, 2).status).toBe("unknown");
    // A write with an unknown storage address taints every later step.
    expect(frameStorageAt(m, detail, 5).status).toBe("unknown");
    expect(frameStorageAt(m, detail, 1).status).toBe("known");
  });

  it("refuses when no frame covers the step", () => {
    expect(frameStorageAt(buildStorageModel(steps, []), detail, 0).status).toBe("unknown");
  });
});
