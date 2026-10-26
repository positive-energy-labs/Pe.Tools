/** One policy for scene ownership. The admission proxy is not a browser/driver memory limit. */
export const SCENE_ADMISSION_BYTES = 512 * 1024 * 1024;
const PREPARED_RETENTION_BYTES = 32 * 1024 * 1024;

export type ScenePhase = "decoded" | "prepared" | "staging" | "uploaded";
export type SceneFootprint = {
  /** Whole backing stores, not view lengths. Shared storage is charged once across all leases. */
  readonly buffers?: readonly ArrayBufferLike[];
  /** JS objects are estimates. Reuse the footprint object when sharing the same objects. */
  readonly heapBytes?: number;
  /** One key per actual GPU allocation, including its WebGL context. Never key by source array. */
  readonly gpu?: readonly { readonly key: object; readonly bytes: number }[];
};
export type SceneEstimate = {
  jsBufferBytes?: number;
  jsHeapEstimateBytes?: number;
  gpuEstimateBytes?: number;
};
export type SceneMemoryLease = {
  release(): void;
  move(phase: ScenePhase): void;
  update(footprint: SceneFootprint): void;
};
export type SceneMemoryReservation = {
  /** Replace the estimate with owned storage atomically. A cancelled reservation cannot commit. */
  commit(footprint: SceneFootprint): SceneMemoryLease;
  release(): void;
};
export type SceneMemoryRetention = { touch(): void; release(): void };

type Totals = Required<SceneEstimate>;
type Retention = {
  kind: "decoded" | "prepared";
  optional: boolean;
  admissionBytes: number;
  entryBytes: number;
  evict(): void;
};
type Ownership = {
  phase: ScenePhase;
  footprint: SceneFootprint;
  retention?: Retention;
};
const phases: ScenePhase[] = ["decoded", "prepared", "staging", "uploaded"];
const empty = (): Totals => ({ jsBufferBytes: 0, jsHeapEstimateBytes: 0, gpuEstimateBytes: 0 });
const total = (value: Totals) =>
  value.jsBufferBytes + value.jsHeapEstimateBytes + value.gpuEstimateBytes;
const bytes = (value = 0) => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error("Invalid scene memory byte estimate");
  return value;
};
const estimate = (value: SceneEstimate): Totals => ({
  jsBufferBytes: bytes(value.jsBufferBytes),
  jsHeapEstimateBytes: bytes(value.jsHeapEstimateBytes),
  gpuEstimateBytes: bytes(value.gpuEstimateBytes),
});
function validate(footprint: SceneFootprint) {
  bytes(footprint.heapBytes);
  for (const allocation of footprint.gpu ?? []) bytes(allocation.bytes);
}

/** Independent SceneCaches can share this owner; cache and active references use the same census.
 * The unchanged 512MiB proxy admits decoded artifacts. Derived retention borrows at most32MiB
 * of its spare capacity. Owned work/reservations evict retention under pressure, but cannot
 * refuse an already-admitted focus or its replacement. Remaining pressure is explicit overage.
 * This accounts owned backing stores, not GC timing, Three internals, or unobservable driver VRAM.
 */
export class SceneMemory {
  readonly maxAdmissionBytes: number;
  readonly maxDecodedScenes: number;
  readonly maxPreparedBytes: number;
  #owned = new Set<Ownership>();
  #reserved = new Map<object, { phase: ScenePhase; estimate: Totals }>();

  constructor(
    options: {
      maxAdmissionBytes?: number;
      maxDecodedScenes?: number;
      maxPreparedBytes?: number;
    } = {},
  ) {
    this.maxAdmissionBytes = bytes(options.maxAdmissionBytes ?? SCENE_ADMISSION_BYTES);
    this.maxDecodedScenes = bytes(options.maxDecodedScenes ?? 32);
    this.maxPreparedBytes = bytes(options.maxPreparedBytes ?? PREPARED_RETENTION_BYTES);
  }

  acquire(phase: ScenePhase, footprint: SceneFootprint): SceneMemoryLease {
    validate(footprint);
    const owned: Ownership = { phase, footprint };
    this.#owned.add(owned);
    this.#trim();
    return this.#lease(owned);
  }

  reserve(phase: ScenePhase, value: SceneEstimate): SceneMemoryReservation {
    const key = {};
    this.#reserved.set(key, { phase, estimate: estimate(value) });
    this.#trim();
    return {
      commit: (footprint) => {
        if (!this.#reserved.has(key)) throw Error("Scene memory reservation already settled");
        validate(footprint);
        this.#reserved.delete(key);
        return this.acquire(phase, footprint);
      },
      release: () => {
        this.#reserved.delete(key);
        this.#trim();
      },
    };
  }

  /** Stores own values/identity; this owner alone decides retention and eviction. */
  retain(
    kind: "decoded" | "prepared",
    footprint: SceneFootprint,
    options: { optional: boolean; admissionBytes?: number; entryBytes?: number; evict(): void },
  ): SceneMemoryRetention {
    validate(footprint);
    const admissionBytes = bytes(options.admissionBytes);
    const entryBytes = bytes(options.entryBytes);
    if (kind === "decoded" && admissionBytes > this.maxAdmissionBytes)
      throw Error("Scene exceeds the resident geometry budget. Narrow the scope.");
    const owned: Ownership = {
      phase: kind,
      footprint,
      retention: {
        kind,
        optional: options.optional,
        admissionBytes,
        entryBytes,
        evict: options.evict,
      },
    };
    this.#owned.add(owned);
    this.#trim();
    return {
      touch: () => {
        if (!this.#owned.delete(owned)) return;
        this.#owned.add(owned);
      },
      release: () => {
        this.#drop(owned);
        this.#trim();
      },
    };
  }

  snapshot() {
    const retained = [...this.#owned].filter((o) => o.retention);
    const decoded = retained.filter((o) => o.retention!.kind === "decoded");
    const prepared = retained.filter((o) => o.retention!.kind === "prepared");
    const admissionBytes = decoded.reduce((n, o) => n + o.retention!.admissionBytes, 0);
    const owned = this.#measure(this.#owned);
    const reserved = this.#reservationTotals();
    return {
      owned,
      reserved,
      /** These subsets overlap when active and retained owners share storage; do not add them. */
      active: this.#measure([...this.#owned].filter((o) => !o.retention)),
      retained: this.#measure(retained),
      owners: {
        active: this.#owned.size - retained.length,
        retained: retained.length,
        reservations: this.#reserved.size,
      },
      /** Phase totals include shared storage in each phase; only `owned` is globally additive. */
      phases: Object.fromEntries(
        phases.map((phase) => [
          phase,
          {
            owned: this.#measure([...this.#owned].filter((o) => o.phase === phase)),
            reserved: this.#reservationTotals(phase),
          },
        ]),
      ) as Record<ScenePhase, { owned: Totals; reserved: Totals }>,
      retention: {
        admissionBytes,
        maxAdmissionBytes: this.maxAdmissionBytes,
        decodedScenes: decoded.length,
        preparedBytes: total(this.#measure(prepared)),
        preparedLimitBytes: Math.min(
          this.maxPreparedBytes,
          Math.max(0, this.maxAdmissionBytes - admissionBytes),
        ),
      },
      ownedAndReservedBytes: total(owned) + total(reserved),
      overageBytes: Math.max(0, total(owned) + total(reserved) - this.maxAdmissionBytes),
      driverBytes: null,
    };
  }

  #lease(owned: Ownership): SceneMemoryLease {
    return {
      release: () => {
        this.#drop(owned);
        this.#trim();
      },
      move: (phase) => {
        if (!this.#owned.has(owned)) throw Error("Scene memory lease released");
        owned.phase = phase;
      },
      update: (footprint) => {
        if (!this.#owned.has(owned)) throw Error("Scene memory lease released");
        validate(footprint);
        owned.footprint = footprint;
        this.#trim();
      },
    };
  }

  #drop(owned: Ownership) {
    if (!this.#owned.delete(owned)) return;
    const retention = owned.retention;
    owned.footprint = {};
    owned.retention = undefined;
    retention?.evict();
  }

  #measure(ownership: Iterable<Ownership>): Totals {
    const buffers = new Set<ArrayBufferLike>();
    const footprints = new Set<SceneFootprint>();
    const gpu = new Map<object, number>();
    const result = empty();
    for (const { footprint, retention } of ownership) {
      result.jsHeapEstimateBytes += retention?.entryBytes ?? 0;
      for (const buffer of footprint.buffers ?? []) buffers.add(buffer);
      if (!footprints.has(footprint)) {
        footprints.add(footprint);
        result.jsHeapEstimateBytes += footprint.heapBytes ?? 0;
      }
      for (const allocation of footprint.gpu ?? [])
        gpu.set(allocation.key, Math.max(gpu.get(allocation.key) ?? 0, allocation.bytes));
    }
    for (const buffer of buffers) result.jsBufferBytes += buffer.byteLength;
    for (const weight of gpu.values()) result.gpuEstimateBytes += weight;
    return result;
  }

  #reservationTotals(phase?: ScenePhase) {
    const result = empty();
    for (const reservation of this.#reserved.values()) {
      if (phase && reservation.phase !== phase) continue;
      for (const key of Object.keys(result) as (keyof Totals)[])
        result[key] += reservation.estimate[key];
    }
    return result;
  }

  #trim() {
    for (;;) {
      const retained = [...this.#owned].filter((o) => o.retention);
      const decoded = retained.filter((o) => o.retention!.kind === "decoded");
      const prepared = retained.filter((o) => o.retention!.kind === "prepared");
      const admissionBytes = decoded.reduce((n, o) => n + o.retention!.admissionBytes, 0);
      const preparedLimit = Math.min(
        this.maxPreparedBytes,
        Math.max(0, this.maxAdmissionBytes - admissionBytes),
      );
      let candidates: Ownership[];
      if (decoded.length > this.maxDecodedScenes || admissionBytes > this.maxAdmissionBytes)
        candidates = decoded;
      else if (total(this.#measure(prepared)) > preparedLimit) candidates = prepared;
      else {
        const before = total(this.#measure(this.#owned));
        if (before + total(this.#reservationTotals()) <= this.maxAdmissionBytes) return;
        // Retained aliases can be removed together; active shared storage cannot be reclaimed.
        const active = [...this.#owned].filter((o) => !o.retention);
        const activeBytes = total(this.#measure(active));
        candidates = retained.filter((o) => total(this.#measure([...active, o])) > activeBytes);
      }
      if (!candidates.length) return;
      // Stable sort preserves LRU within each tier. Optional context goes before exact focus.
      candidates.sort(
        (a, b) =>
          Number(a.retention!.optional === false) - Number(b.retention!.optional === false) ||
          Number(a.retention!.kind === "decoded") - Number(b.retention!.kind === "decoded"),
      );
      this.#drop(candidates[0]!);
    }
  }
}

export const sceneMemory = new SceneMemory();
