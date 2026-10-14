/**
 * The web's one caught-fault owner. A boundary, a reading deadline or a lost stream reports here
 * and nowhere else: no `console.error` beside it, no second sender. A fact is the receipt
 * schema's closed `diagnostic` body; the message stays in this tab's memory and never leaves it.
 *
 * Delivery is independent of `/host/status` and of every Reading: the owner exists at import and
 * posts to the host's diagnostic intake with its own deadline. The buffer is bounded (oldest
 * drops, counted), and the delivery state is visible: delivered, silent (the host has no intake),
 * refused, or unreachable. A refused batch is discarded and counted; it is never resent.
 */
import { useSyncExternalStore } from "react";
import { receiptBodySchema, type ReceiptBody, type ReceiptFaultCode } from "@pe/agent-contracts";

import { peClient } from "./pe-client";

export type DiagnosticFact = {
  code: ReceiptFaultCode;
  elapsedMs?: number;
  readingKind?: string;
  streamKind?: string;
  routeCode?: string;
};
type Body = Extract<ReceiptBody, { kind: "diagnostic" }>;
type Pending = { at: string; body: Body; message: string | null };

export type Delivery = "idle" | "sending" | "delivered" | "silent" | "refused" | "unreachable";
export interface DiagnosticsState {
  readonly delivery: Delivery;
  /** Why the last delivery did not land, in the host's words or the transport's. */
  readonly detail: string | null;
  readonly pending: number;
  readonly dropped: number;
  readonly refused: number;
  /** The newest faults this tab caught, local only; the message is never sent. */
  readonly recent: readonly Pending[];
}

export const DIAGNOSTICS_MAX_PENDING = 64;
const RECENT = 8;
const SEND_DEADLINE_MS = 3_000;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000] as const;

export type Post = (batch: {
  browserSessionId: string;
  dropped: number;
  facts: readonly { at: string; body: Body }[];
}) => Promise<Response>;

const postToHost: Post = (body) =>
  peClient.response("diagnostics.submit", { body: { ...body, facts: [...body.facts] } });

export class Diagnostics {
  private pending: Pending[] = [];
  private recent: Pending[] = [];
  private dropped = 0;
  /** Dropped facts the host has already been told about. */
  private reported = 0;
  private refused = 0;
  private delivery: Delivery = "idle";
  private detail: string | null = null;
  private attempt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private sending = false;
  private downSince: number | null = null;
  private snapshot: DiagnosticsState;
  private readonly listeners = new Set<() => void>();
  readonly browserSessionId = crypto.randomUUID();

  constructor(
    private readonly post: Post = postToHost,
    private readonly now: () => number = Date.now,
  ) {
    this.snapshot = this.project();
  }

  /** Record one caught fault. Never throws: a broken fact is kept locally as its message only. */
  report(fact: DiagnosticFact, error?: unknown) {
    const parsed = receiptBodySchema.safeParse({ kind: "diagnostic", ...fact });
    const message =
      error === undefined ? null : error instanceof Error ? error.message : String(error);
    const entry: Pending = {
      at: new Date(this.now()).toISOString(),
      body: parsed.success ? (parsed.data as Body) : { kind: "diagnostic", code: fact.code },
      message,
    };
    this.recent = [entry, ...this.recent].slice(0, RECENT);
    this.pending.push(entry);
    if (this.pending.length > DIAGNOSTICS_MAX_PENDING) {
      this.pending.shift();
      this.dropped++;
    }
    this.publish();
    this.schedule(0);
  }

  getState = (): DiagnosticsState => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private schedule(delay: number) {
    if (this.sending || typeof window === "undefined") return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  private async flush() {
    this.timer = undefined;
    if (this.sending || (!this.pending.length && this.dropped === this.reported)) return;
    this.sending = true;
    const batch = this.pending.slice();
    const dropped = this.dropped;
    this.delivery = "sending";
    this.publish();
    let retry = false;
    try {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const response = await Promise.race([
        this.post({
          browserSessionId: this.browserSessionId,
          dropped: dropped - this.reported,
          facts: batch.map(({ at, body }) => ({ at, body })),
        }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(Error(`no answer in ${SEND_DEADLINE_MS / 1000} s`)),
            SEND_DEADLINE_MS,
          );
        }),
      ]).finally(() => clearTimeout(deadline));
      if (response.ok) {
        this.settle(batch, dropped, "delivered", null);
      } else if (response.status === 404) {
        // No intake on this host: the facts stay here, and the state says so.
        this.delivery = "silent";
        this.detail = "this host has no diagnostic intake; faults stay in this tab";
        retry = true;
      } else if (response.status < 500) {
        const said = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        this.refused += batch.length;
        this.settle(
          batch,
          dropped,
          "refused",
          said?.error?.message ?? `host refused (${response.status})`,
        );
      } else {
        this.delivery = "unreachable";
        this.detail = `host answered ${response.status}`;
        retry = true;
      }
    } catch (caught) {
      this.delivery = "unreachable";
      this.detail = caught instanceof Error ? caught.message : String(caught);
      this.downSince ??= this.now();
      retry = true;
    } finally {
      this.sending = false;
    }
    if (retry) {
      this.schedule(RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]!);
      this.attempt++;
    } else {
      this.attempt = 0;
      if (this.pending.length || this.dropped !== this.reported) this.schedule(0);
    }
    this.publish();
  }

  private settle(batch: Pending[], dropped: number, delivery: Delivery, detail: string | null) {
    this.pending = this.pending.filter((entry) => !batch.includes(entry));
    this.reported = dropped;
    this.delivery = delivery;
    this.detail = detail;
    // The host answered again: the outage it could not hear about is itself a fault.
    if (this.downSince !== null) {
      const elapsedMs = this.now() - this.downSince;
      this.downSince = null;
      this.pending.push({
        at: new Date(this.now()).toISOString(),
        body: { kind: "diagnostic", code: "host.unreachable", elapsedMs },
        message: null,
      });
    }
  }

  private project(): DiagnosticsState {
    return {
      delivery: this.delivery,
      detail: this.detail,
      pending: this.pending.length,
      dropped: this.dropped,
      refused: this.refused,
      recent: this.recent,
    };
  }

  private publish() {
    this.snapshot = this.project();
    for (const listener of this.listeners) listener();
  }
}

const diagnostics = new Diagnostics();

/** Every caught fault in the web goes through this one call. */
export const reportFault = (fact: DiagnosticFact, error?: unknown) =>
  diagnostics.report(fact, error);

export const useDiagnostics = (owner: Diagnostics = diagnostics): DiagnosticsState =>
  useSyncExternalStore(owner.subscribe, owner.getState, owner.getState);
