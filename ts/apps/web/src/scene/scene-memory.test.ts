import { describe, expect, it, vi } from "vite-plus/test";
import { SCENE_ADMISSION_BYTES, SceneMemory, type SceneFootprint } from "./scene-memory";

describe("scene ownership accounting", () => {
  it("counts actual shared backing once, separates GPU allocations and estimates from storage", () => {
    const memory = new SceneMemory();
    const backing = new ArrayBuffer(1024),
      gpu = {};
    const decoded: SceneFootprint = {
      buffers: [new Float32Array(backing, 16, 4).buffer],
      heapBytes: 40,
    };
    const first = memory.acquire("decoded", decoded);
    const second = memory.acquire("prepared", decoded);
    const edit = memory.acquire("staging", {
      buffers: [backing, backing],
      gpu: [
        { key: gpu, bytes: 64 },
        { key: gpu, bytes: 64 },
      ],
    });
    const uploaded = memory.acquire("uploaded", {
      gpu: [
        { key: gpu, bytes: 64 },
        { key: {}, bytes: 64 },
      ],
    });
    expect(memory.snapshot().owned).toEqual({
      jsBufferBytes: 1024,
      jsHeapEstimateBytes: 40,
      gpuEstimateBytes: 128,
    });
    expect(memory.snapshot().retention.maxAdmissionBytes).toBe(SCENE_ADMISSION_BYTES);
    expect(memory.snapshot().driverBytes).toBeNull();
    first.release();
    second.release();
    expect(memory.snapshot().owned.jsBufferBytes).toBe(1024);
    expect(memory.snapshot().owned.jsHeapEstimateBytes).toBe(0);
    edit.release();
    uploaded.release();
    uploaded.release();
    expect(memory.snapshot().ownedAndReservedBytes).toBe(0);
  });

  it("reserves work, atomically commits owned storage, moves phases and rolls back cancellation", () => {
    const memory = new SceneMemory({ maxAdmissionBytes: 100 });
    const old = memory.acquire("uploaded", { buffers: [new ArrayBuffer(80)] });
    const evict = vi.fn();
    const retained = memory.retain(
      "prepared",
      { buffers: [new ArrayBuffer(10)] },
      { optional: true, evict },
    );
    const reservation = memory.reserve("staging", { jsBufferBytes: 60, gpuEstimateBytes: 20 });
    expect(evict).not.toHaveBeenCalled();
    expect(memory.snapshot().reserved).toEqual({
      jsBufferBytes: 60,
      gpuEstimateBytes: 20,
      jsHeapEstimateBytes: 0,
    });
    expect(memory.snapshot().overageBytes).toBe(70);
    reservation.release();
    reservation.release();
    expect(() => reservation.commit({})).toThrow("settled");
    expect(memory.snapshot().owned.jsBufferBytes).toBe(90);
    retained.release();
    expect(memory.snapshot().owned.jsBufferBytes).toBe(80);
    expect(memory.snapshot().overageBytes).toBe(0);
    const next = memory.reserve("staging", { jsBufferBytes: 40 });
    expect(() => next.commit({ heapBytes: -1 })).toThrow("Invalid");
    expect(memory.snapshot().reserved.jsBufferBytes).toBe(40);
    const lease = next.commit({ buffers: [new ArrayBuffer(30)] });
    next.release();
    expect(() => next.commit({})).toThrow("settled");
    expect(memory.snapshot().reserved.jsBufferBytes).toBe(0);
    expect(memory.snapshot().owned.jsBufferBytes).toBe(110);
    lease.move("uploaded");
    expect(memory.snapshot().phases.uploaded!.owned.jsBufferBytes).toBe(110);
    old.release();
    lease.update({ buffers: [new ArrayBuffer(20)] });
    expect(memory.snapshot().owned.jsBufferBytes).toBe(20);
    lease.release();
    expect(() => lease.move("staging")).toThrow("released");
    expect(memory.snapshot().ownedAndReservedBytes).toBe(0);
    expect(memory.snapshot().owners).toEqual({ active: 0, retained: 0, reservations: 0 });
  });

  it("does not discard retained references which share all their storage with active work", () => {
    const memory = new SceneMemory({ maxAdmissionBytes: 100 });
    const footprint = { buffers: [new ArrayBuffer(80)] };
    const active = memory.acquire("decoded", footprint),
      evict = vi.fn();
    const retained = memory.retain("decoded", footprint, {
      admissionBytes: 90,
      optional: false,
      evict,
    });
    const work = memory.reserve("staging", { jsBufferBytes: 50 });
    expect(memory.snapshot().overageBytes).toBe(30);
    expect(evict).not.toHaveBeenCalled();
    work.release();
    active.release();
    retained.release();
    expect(evict).toHaveBeenCalledOnce();
    expect(memory.snapshot().ownedAndReservedBytes).toBe(0);
  });

  it("bounds retention by its allowance, with optional then LRU eviction independent of workspace", () => {
    const memory = new SceneMemory({ maxAdmissionBytes: 100, maxPreparedBytes: 100 });
    const removed: string[] = [];
    const retain = (key: string, optional: boolean) =>
      memory.retain(
        "prepared",
        { buffers: [new ArrayBuffer(30)] },
        { optional, evict: () => removed.push(key) },
      );
    const a = retain("focus-a", false);
    retain("context", true).touch();
    const b = retain("focus-b", false);
    a.touch();
    const c = retain("focus-c", false);
    expect(removed).toEqual(["context"]);
    const reservation = memory.reserve("prepared", { jsBufferBytes: 30 });
    expect(removed).toEqual(["context"]);
    reservation.release();
    const active = memory.acquire("decoded", { buffers: [new ArrayBuffer(200)] });
    expect(memory.snapshot().owned.jsBufferBytes).toBe(290);
    expect(memory.snapshot().overageBytes).toBe(190);
    expect(removed).toEqual(["context"]);
    const d = retain("focus-d", false);
    expect(removed).toEqual(["context", "focus-b"]);
    expect(memory.snapshot().retention.preparedBytes).toBe(90);
    active.release();
    a.release();
    b.release();
    c.release();
    d.release();
    expect(memory.snapshot().ownedAndReservedBytes).toBe(0);
  });

  it("does not claim geometry is reclaimed by dropping an alias while another owner still holds it", () => {
    const memory = new SceneMemory({ maxAdmissionBytes: 100, maxPreparedBytes: 100 });
    const footprint = { buffers: [new ArrayBuffer(80)] },
      evict = vi.fn();
    const active = memory.acquire("prepared", footprint);
    const first = memory.retain("prepared", footprint, { optional: false, evict });
    const second = memory.retain("prepared", footprint, { optional: true, evict });
    const work = memory.reserve("staging", { jsBufferBytes: 50 });
    expect(evict).not.toHaveBeenCalled();
    active.release();
    expect(evict).not.toHaveBeenCalled();
    first.release();
    expect(memory.snapshot().owned.jsBufferBytes).toBe(80);
    expect(memory.snapshot().overageBytes).toBe(30);
    second.release();
    expect(evict).toHaveBeenCalledTimes(2);
    expect(memory.snapshot().owned.jsBufferBytes).toBe(0);
    expect(memory.snapshot().overageBytes).toBe(0);
    work.release();
  });
});
