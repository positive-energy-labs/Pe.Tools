type Acquisition = {
  sourceIdentity: string;
  result: Promise<unknown>;
  release: () => Promise<unknown>;
  report?: (receipt: Cleanup) => Promise<void>;
  recovery: Record<string, unknown>;
  releaseRequested?: boolean;
  releasing?: Promise<Cleanup>;
};
type Cleanup = {
  acquisitionId: string;
  result: unknown;
  recovery?: Record<string, unknown>;
  reportingError?: string;
};
type TurnOwner = {
  ended: boolean;
  started?: boolean;
  attempts: Map<string, Acquisition>;
  ownerId?: string;
  report?: (receipt: Cleanup) => Promise<void>;
};

/** Host/runtime-owned attempts, registered before open is awaited. Ending a turn also arms
 * cleanup for replies that arrive after cancellation; release never inherits its aborted signal. */
export class TurnDocuments {
  // ponytail: tombstones live for the runtime lifetime; compact only once no delayed call can enter.
  readonly #turns = new Map<string, TurnOwner>();

  bind(turnId: string, ownerId: string, report: (receipt: Cleanup) => Promise<void>): void {
    if (this.#turns.has(turnId)) return;
    this.#turns.set(turnId, { ended: false, attempts: new Map(), ownerId, report });
  }

  /** Called synchronously at tool entry, before catalog/target resolution can await. */
  startCall(turnId: string): void {
    const turn = this.#turns.get(turnId);
    if (turn) turn.started = true;
  }

  async finishOwner(ownerId: string, includeQueued = false): Promise<Cleanup[]> {
    return (
      await Promise.all(
        [...this.#turns]
          .filter(
            ([, turn]) =>
              turn.ownerId === ownerId && !turn.ended && (includeQueued || turn.started),
          )
          .map(([id]) => this.finish(id)),
      )
    ).flat();
  }

  acquire(
    turnId: string,
    acquisitionId: string,
    open: () => Promise<unknown>,
    release: () => Promise<unknown>,
    sourceIdentity = "",
    recovery: Record<string, unknown> = {},
  ): Promise<unknown> {
    let turn = this.#turns.get(turnId);
    if (!turn) {
      turn = { ended: false, attempts: new Map() };
      this.#turns.set(turnId, turn);
    }
    const existing = turn.attempts.get(acquisitionId);
    if (existing)
      return existing.sourceIdentity === sourceIdentity
        ? existing.result
        : Promise.reject(new Error("Acquisition ID belongs to a different source."));
    if (turn.ended) return Promise.reject(new Error("Turn ended before acquisition."));
    turn.started = true;
    const admitted = Promise.resolve().then(() =>
      turn.report?.({ acquisitionId, result: { status: "pending", sourceIdentity, ...recovery } }),
    );
    const attempt: Acquisition = {
      sourceIdentity,
      result: Promise.resolve(),
      report: turn.report,
      recovery,
      release: async () => {
        await admitted;
        return release();
      },
    };
    turn.attempts.set(acquisitionId, attempt);
    attempt.result = admitted.then(open).finally(async () => {
      if (turn.ended || attempt.releaseRequested) {
        // An early release may have overtaken native admission. Re-read/release the SAME ID.
        attempt.releasing = undefined;
        await this.#release(acquisitionId, attempt);
      }
    });
    return attempt.result;
  }

  async finish(turnId: string): Promise<Cleanup[]> {
    const turn = this.#turns.get(turnId);
    if (!turn) {
      this.#turns.set(turnId, { ended: true, attempts: new Map() });
      return [];
    }
    turn.ended = true;
    return this.releaseCurrent(turnId);
  }

  /** A recoverable tool error ends existing acquisitions, not the surrounding chat turn. */
  async releaseCurrent(turnId: string): Promise<Cleanup[]> {
    const turn = this.#turns.get(turnId);
    if (!turn) return [];
    for (const attempt of turn.attempts.values()) attempt.releaseRequested = true;
    return Promise.all([...turn.attempts].map(([id, attempt]) => this.#release(id, attempt)));
  }

  #release(id: string, attempt: Acquisition) {
    return (attempt.releasing ??= Promise.resolve()
      .then(attempt.release)
      .then(
        (result) => ({ acquisitionId: id, result }),
        (error: unknown) => ({
          acquisitionId: id,
          result: { status: "recovery-required", detail: String(error) },
        }),
      )
      .then(async (receipt): Promise<Cleanup> => {
        const recovered = Object.keys(attempt.recovery).length
          ? { ...receipt, recovery: attempt.recovery }
          : receipt;
        try {
          await attempt.report?.(recovered);
          return recovered;
        } catch (error) {
          return { ...recovered, reportingError: String(error) };
        }
      }));
  }
}

export const ownedTurnDocuments = new TurnDocuments();
