/**
 * SENTENCE — the whole route chrome as ONE readable English line.
 *
 *   running open · 3s   Chat on projectC.rvt · 4 read · sent a turn · ran
 *
 * The six nouns are the line's slots. Work is the subject, Target is the object of "on", Reading
 * is the freshness clause, Action is the outcome clause; Page and View live in the inspector
 * (one placement each — nothing on this line is repeated below it). Each slot is styled by its
 * STATE, not by its kind: unbound is caution with a solid underline, bound is ink, inferred
 * (resolved from the thread head, never chosen here) is a dashed underline, ambiguous is caution
 * with the count that makes it ambiguous, dangling is struck through.
 *
 * A running action prefixes the line; a finished one briefly REPLACES it with its receipt and then
 * relaxes back to the nouns (the old `chat-sentence.tsx` grammar, on the real `RouteHandle`).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Reading, TargetInventory } from "@pe/agent-contracts";

import { PickList, type PickListItem } from "#/components/lang/pick-list";
import { Press } from "#/components/lang/press";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { StateDot } from "#/components/master-table/cells";
import { useTargetInventory } from "#/readings";

import { RouteHelpButton } from "../help";
import { RouteInspector } from "../inspector";
import { RouteKeys } from "../keys";
import type { Refusal } from "../refusal";
import { useChooseTarget, useEmptyBody, useHostLamp, type ShellProps } from "../shell";
import { useRoute, type RouteHandle } from "../use-route";

/* ── slot grammar ──────────────────────────────────────────────────────────── */

/** How a slot stands to the rest of the sentence. One mark each; never two at once. */
type SlotState = "bound" | "unbound" | "inferred" | "ambiguous" | "dangling";

const SLOT_MARK: Record<SlotState, string> = {
  bound: "text-ink",
  unbound: "underline decoration-solid underline-offset-4",
  inferred: "text-ink-2 underline decoration-dashed underline-offset-4",
  ambiguous: "underline decoration-solid underline-offset-4",
  dangling: "text-ink-mute line-through",
};

const SLOT_TONE: Partial<Record<SlotState, string>> = {
  unbound: "caution",
  ambiguous: "caution",
};

/** What one noun says right now: its state, its words, and what it means for the others. */
interface SlotSay {
  state: SlotState;
  text: string;
  says: string;
}

function Slot({ slot, open, onToggle }: { slot: SlotSay; open?: boolean; onToggle?: () => void }) {
  const mark = `face-mono t-small whitespace-nowrap ${SLOT_MARK[slot.state]}`;
  if (!onToggle)
    return (
      <span className={mark} data-tone={SLOT_TONE[slot.state]} title={slot.says}>
        {slot.text}
      </span>
    );
  return (
    <Press
      type="button"
      tone="quiet"
      size="caption"
      hover="bare"
      aria-expanded={open ?? false}
      data-tone={SLOT_TONE[slot.state]}
      title={slot.says}
      onClick={onToggle}
    >
      <span className={mark}>{slot.text}</span>
    </Press>
  );
}

/** The picker a slot opens: one searchable, keyboard-walked, grouped list — never a menu. */
function SlotPicker({
  items,
  placeholder,
  emptyNote,
  onPick,
}: {
  items: PickListItem[];
  placeholder: string;
  emptyNote: ReactNode;
  onPick: (id: string) => void;
}) {
  return (
    <div
      data-surface="artifact"
      className="absolute top-full left-0 z-raised mt-1 max-h-72 w-96 overflow-y-auto border border-line-2 py-1"
    >
      <PickList items={items} placeholder={placeholder} emptyNote={emptyNote} onPick={onPick} />
    </div>
  );
}

/* ── the Target noun ───────────────────────────────────────────────────────── */

interface OpenDocument {
  openId: string;
  session: string;
  address: string | null;
  label: string;
  kind: "project" | "family";
}

/** Every open document the inventory reports — a file open in two Revits is two rows. */
function openDocuments(inventory: TargetInventory): OpenDocument[] {
  if (inventory.kind !== "ready") return [];
  return Object.entries(inventory.sessions).flatMap(([session, held]) =>
    held.kind !== "ready"
      ? []
      : held.values.map((value) => ({
          openId: value.openId,
          session,
          address: value.address as string | null,
          label: value.address?.split(/[\\/]/).at(-1) ?? `unsaved (${value.openId.slice(0, 6)})`,
          kind: value.kind,
        })),
  );
}

const basename = (value: string) => value.split(/[\\/]/).at(-1) ?? value;

function targetSlot(
  handle: RouteHandle<any, any, any, any>,
  documents: OpenDocument[],
  chosen: string | undefined,
): SlotSay {
  const { resolution, manifest } = handle;
  if (!manifest.needs)
    return {
      state: "bound",
      text: "the host",
      says: "this route needs no Revit document — every action runs on the host itself",
    };
  if (resolution.kind === "checking")
    return { state: "inferred", text: "…", says: "reading the inventory of open documents" };
  if (resolution.kind === "failed")
    return { state: "dangling", text: "unreadable", says: resolution.message };
  if (resolution.kind === "resolved") {
    const ref = resolution.target.kind === "document" ? resolution.target.ref : null;
    const found = ref ? documents.find((doc) => doc.openId === ref.openId) : undefined;
    return {
      state: chosen ? "bound" : "inferred",
      text: found?.label ?? (ref ? `open ${ref.openId.slice(0, 6)}` : "the host"),
      says: chosen
        ? `you chose this document — every action and every Reading on this route runs in ${ref?.session ?? "the host"}`
        : `nothing was chosen here: this is the thread's default document, in ${ref?.session ?? "the host"}. Click to choose one.`,
    };
  }
  const holders = chosen
    ? documents.filter((doc) => doc.address !== null && basename(doc.address) === basename(chosen))
        .length
    : 0;
  const chosenName = chosen ? basename(chosen) : "the chosen document";
  return {
    missing: {
      state: "unbound" as const,
      text: `pick a ${manifest.needs}`,
      says: `nothing is chosen and the thread names no default — every action here refuses, and every Reading stays absent, until you pick a ${manifest.needs}`,
    },
    "session-gone": {
      state: "dangling" as const,
      text: chosenName,
      says: "the Revit holding that document ended — pick again",
    },
    "document-closed": {
      state: "dangling" as const,
      text: chosenName,
      says: "that document is no longer open — pick again",
    },
    "wrong-document-kind": {
      state: "unbound" as const,
      text: chosenName,
      says: `that document is the wrong kind — this route needs a ${manifest.needs}`,
    },
    ambiguous: {
      state: "ambiguous" as const,
      text: `${chosenName} ×${holders || 2}`,
      says: `${holders || 2} Revits hold that document — pick the one you mean`,
    },
  }[resolution.reason];
}

/* ── the Reading noun ──────────────────────────────────────────────────────── */

function readingSlot(readings: Record<string, Reading<unknown>>): SlotSay & { rows: string[] } {
  const entries = Object.entries(readings);
  const rows = entries.map(
    ([name, reading]) =>
      `${name} · ${
        reading.state === "failed"
          ? `failed: ${reading.message}`
          : reading.state === "stale"
            ? `stale (${reading.reason})`
            : reading.state
      }`,
  );
  if (entries.length === 0)
    return {
      state: "bound",
      text: "nothing read",
      says: "this route declares no Readings — it observes nothing about the Target",
      rows,
    };
  const count = (state: string) => entries.filter(([, r]) => r.state === state).length;
  const failed = count("failed");
  const stale = count("stale");
  const absent = count("absent");
  const loading = count("loading");
  if (failed)
    return {
      state: "ambiguous",
      text: `${failed} of ${entries.length} unread`,
      says: "a Reading failed — what this page shows about the Target is not what Revit says",
      rows,
    };
  if (stale)
    return {
      state: "ambiguous",
      text: `${stale} of ${entries.length} stale`,
      says: "a Reading is stale: its last observation stands, but the Target has moved since",
      rows,
    };
  if (loading || absent)
    return {
      state: "inferred",
      text:
        absent === entries.length
          ? "not read yet"
          : `${entries.length - absent - loading} of ${entries.length} read`,
      says: "a Reading has not answered — an absent Reading is waiting on the Target, not empty",
      rows,
    };
  return {
    state: "bound",
    text: `${entries.length} read`,
    says: "every Reading this route declares answered for the bound Target",
    rows,
  };
}

/* ── the receipt ───────────────────────────────────────────────────────────── */

const RECEIPT_MS = 4_000;
const REFUSAL_MS = 8_000;

/** A finished action briefly REPLACES the sentence, then relaxes back to the nouns. */
function useReceipt(outcome: RouteHandle<any, any, any, any>["outcome"]) {
  const [shown, setShown] = useState<{ text: string; refused: boolean } | null>(null);
  const last = useRef(outcome);
  useEffect(() => {
    if (outcome === last.current) return;
    last.current = outcome;
    if (!outcome) {
      setShown(null);
      return;
    }
    const refusal = outcome.refusal;
    setShown({
      text: refusal
        ? `${outcome.label} refused · ${refusal.message}`
        : `${outcome.label} · ran · just now`,
      refused: refusal !== null,
    });
    const timer = setTimeout(() => setShown(null), refusal ? REFUSAL_MS : RECEIPT_MS);
    return () => clearTimeout(timer);
  }, [outcome]);
  return shown;
}

/* ── the shell ─────────────────────────────────────────────────────────────── */

export function SentenceShell<W, R extends string, P, A extends string>({
  manifest,
  name,
  aside,
  live,
  children,
}: ShellProps<W, R, P, A>) {
  const [chosenTarget, chooseTarget] = useChooseTarget();
  const handle = useRoute(manifest, { target: chosenTarget });
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [open, setOpen] = useState<"target" | "action" | "reading" | "inspector" | null>(null);
  const inventory = useTargetInventory();
  const documents = useMemo(() => openDocuments(inventory), [inventory]);
  const empty = useEmptyBody(handle);
  const lamp = useHostLamp(live);
  const receipt = useReceipt(handle.outcome);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const target = targetSlot(handle, documents, handle.chosen ?? undefined);
  const reading = readingSlot(handle.readings as Record<string, Reading<unknown>>);
  const failure = refusal ?? handle.failure;
  const outcome = handle.outcome;
  const action: SlotSay = failure
    ? { state: "ambiguous", text: failure.code, says: failure.message }
    : outcome
      ? outcome.refusal
        ? { state: "ambiguous", text: `${outcome.label} refused`, says: outcome.refusal.message }
        : {
            state: "bound",
            text: `${outcome.label} · ran`,
            says: "the last action this route ran on this Target, and what it left behind",
          }
      : {
          state: "unbound",
          text: "nothing run yet",
          says: "no action has run here in this visit — click to see what this route can do to the Target, and why any one is refused",
        };

  const documentItems: PickListItem[] = documents.map((doc) => ({
    id: doc.openId,
    label: doc.label,
    group: doc.session,
    meta: doc.kind,
    hint: doc.address ?? "this document has never been saved",
  }));
  const actionItems: PickListItem[] = Object.entries(handle.actions).map(([key, value]) => {
    const item = value as RouteHandle<W, R, P, A>["actions"][A];
    return {
      id: key,
      label: item.label,
      group: item.refusal ? "refused" : "ready",
      meta: item.chord ?? "",
      hint: item.refusal ?? item.says,
    };
  });

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={`${manifest.name} route`}
      className="flex h-full min-h-0 min-w-0 flex-col gap-2"
    >
      <RouteKeys handle={handle} onRefusal={setRefusal} />
      <div className="flex min-w-0 items-center justify-between gap-4">
        {/* THE LINE. One sentence, read left to right; every noun in it is a control. */}
        <div className="relative flex min-w-0 flex-1 items-baseline gap-1.5 py-1" role="status">
          {receipt ? (
            <span
              className="face-mono t-small truncate"
              data-tone={receipt.refused ? "caution" : "done"}
            >
              {receipt.text}
            </span>
          ) : (
            <>
              {handle.busy ? (
                <span className="face-mono t-small whitespace-nowrap" data-tone="pea">
                  running {handle.busy.key} · {handle.busy.seconds}s
                </span>
              ) : null}
              <h1 className="t-small face-display truncate text-ink">{name ?? manifest.name}</h1>
              <span className="t-small text-ink-mute">on</span>
              <Slot
                slot={target}
                open={open === "target"}
                onToggle={() => setOpen(open === "target" ? null : "target")}
              />
              <span className="t-small text-ink-mute">·</span>
              <Slot
                slot={reading}
                open={open === "reading"}
                onToggle={() => setOpen(open === "reading" ? null : "reading")}
              />
              <span className="t-small text-ink-mute">·</span>
              <Slot
                slot={action}
                open={open === "action"}
                onToggle={() => setOpen(open === "action" ? null : "action")}
              />
              {handle.work.conflict ? (
                <span className="face-mono t-small" data-tone="caution">
                  · someone else wrote this Work
                </span>
              ) : null}
            </>
          )}

          {open === "target" ? (
            <SlotPicker
              items={documentItems}
              placeholder="filter open documents"
              emptyNote="no document is open in any Revit — open one from the page below"
              onPick={(openId) => {
                const doc = documents.find((item) => item.openId === openId);
                setOpen(null);
                chooseTarget(doc?.address ?? null);
              }}
            />
          ) : null}

          {open === "reading" ? (
            <div
              data-surface="artifact"
              className="absolute top-full left-0 z-raised mt-1 max-h-72 w-96 overflow-y-auto border border-line-2 p-2"
            >
              {reading.rows.length === 0 ? (
                <div className="t-small text-ink-2">
                  this route declares no Readings — it observes nothing about the Target
                </div>
              ) : (
                reading.rows.map((row) => (
                  <div key={row} className="face-mono t-small text-ink-2">
                    {row}
                  </div>
                ))
              )}
            </div>
          ) : null}

          {open === "action" ? (
            <SlotPicker
              items={actionItems}
              placeholder="filter actions"
              emptyNote="this route declares no actions — there is nothing it can do to the Target"
              onPick={(key) => {
                setOpen(null);
                void (handle.actions as Record<string, { run: () => Promise<unknown> }>)[
                  key
                ]?.run();
              }}
            />
          ) : null}
        </div>

        {/* The lamp is host status and nothing else; the control group is beside it. */}
        <span className="flex shrink-0 items-center gap-3">
          {aside}
          <span className="flex items-center gap-1.5" title={lamp.says}>
            <StateDot tone={lamp.tone} />
            <span className="face-mono t-small text-ink-2">
              host · {lamp.word}
              {lamp.checked ? ` · ${lamp.checked}` : ""}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <RouteHelpButton name={manifest.name} docs={manifest.docs} />
            {/* The inspector floats over the page; it is never inline with the body (ruling). */}
            <span className="relative">
              <Press
                type="button"
                tone="quiet"
                size="caption"
                aria-expanded={open === "inspector"}
                title="inspect this route: its Work revision, its Page, its Views, and every Reading's owner and readiness"
                onClick={() => setOpen(open === "inspector" ? null : "inspector")}
              >
                inspect
              </Press>
              {open === "inspector" ? (
                <div
                  data-surface="artifact"
                  className="absolute top-full right-0 z-raised mt-1 max-h-96 w-[32rem] overflow-auto border border-line-2 p-2"
                >
                  <RouteInspector handle={handle} />
                  {(manifest.views ?? []).map((view) => (
                    <div key={view.key}>{view.draws({ readings: handle.readings })}</div>
                  ))}
                </div>
              ) : null}
            </span>
            <ThemeToggle />
          </span>
        </span>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{empty ?? children}</div>
    </div>
  );
}
