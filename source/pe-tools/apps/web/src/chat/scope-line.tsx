import { Fragment, useState, type ReactNode } from "react";
import {
  addressSchema,
  resolveCallTarget,
  type Address,
  type DocumentRequest,
  type TargetInventory,
  type TargetResolution,
} from "@pe/agent-contracts";

import { useThreadScope } from "#/chat/scope";
import { Press } from "#/components/lang/press";
import { token } from "#/lib/token";
import { selectToolCalls, type ChatState } from "#/workbench/chat-state";
import { unresolvedRuns, type ChatActivityRow } from "#/chat/activity";
import { ActionReceiptView } from "#/actions/receipt";
import { ActivityDisclosure, ActivityRow } from "#/components/lang/activity";
import { useWorkbench } from "#/workbench/provider";
import { useTargetInventory } from "#/readings";

/**
 * THE one place the user sees and changes the thread's default Target: the composer's to-line.
 *
 * Rewritten in fold 2. The old line drew `resolveScope`'s four-way answer and offered PIN-A-SESSION
 * recovery — the user chose a Revit by SDK label and the Scope carried it. A `DocumentRequest`
 * names its session directly and law 6 forbids a label from being an execution identity, so the
 * pin UI is gone: the only recovery is the Resolution's `choose` door, which asks for a document
 * and says which reason it is asking for.
 *
 * Fold 5: `/chat` is on a manifest (`chat/manifest.ts`). The `choose` door lives here, in the
 * composer, because that is where the user is; the inventory it reads and the default Target it
 * writes are the manifest's `inventory` and `thread-head` Readings, not a second model.
 */

/** A document the user can pick, as the inventory reports it. */
export interface ToLineDocument {
  document: Address;
  label: string;
  /** Sessions holding it now; empty for a document nobody has open. */
  holders: string[];
}

/** What the last pe_do / pe_read in the thread said it ran against. */
export interface Ran {
  key: string;
  ok: boolean;
  revision: number;
  session: string | null;
  document: string | null;
}

export interface ToLineProps {
  target: DocumentRequest | null;
  revision: number;
  inventory: TargetInventory;
  documents: readonly ToLineDocument[];
  /** pea is mid-turn: the line shows but refuses changes; the turn keeps its admitted target. */
  busy: boolean;
  refusal?: string | null;
  ran: Ran | null;
  activity: readonly ChatActivityRow[];
  onSet: (next: DocumentRequest | null) => void;
}

/** Every open document the inventory names, with the sessions holding it. */
export function inventoryDocuments(inventory: TargetInventory): ToLineDocument[] {
  if (inventory.kind !== "ready") return [];
  const byDocument = new Map<string, ToLineDocument>();
  for (const [session, held] of Object.entries(inventory.sessions)) {
    if (held.kind !== "ready") continue;
    for (const value of held.values) {
      if (value.address === null) continue;
      const entry = byDocument.get(value.address) ?? {
        document: value.address,
        label: value.address.split(/[\\/]/).at(-1) ?? value.address,
        holders: [],
      };
      entry.holders.push(session);
      byDocument.set(value.address, entry);
    }
  }
  return [...byDocument.values()];
}

/** The last completed pe_do / pe_read, with the revision and target its result named. */
function lastRun(chat: ChatState): Ran | null {
  const last = selectToolCalls(chat)
    .filter(
      (call) => (call.title === "pe_do" || call.title === "pe_read") && call.status === "completed",
    )
    .at(-1);
  if (!last || last.status !== "completed") return null;
  const result = last.result as
    | {
        key?: string;
        ok?: boolean;
        revision?: number;
        target?: { session?: string | null; document?: string | null };
      }
    | undefined;
  if (!result || typeof result.revision !== "number") return null;
  return {
    key: result.key ?? String((last.args as { key?: string } | null)?.key ?? last.title),
    ok: result.ok !== false,
    revision: result.revision,
    session: result.target?.session ?? null,
    document: result.target?.document ?? null,
  };
}

export function useToLine(): ToLineProps {
  const { currentThreadId, isRunning, chat } = useWorkbench();
  const head = useThreadScope(currentThreadId);
  // The manifest's `inventory` Reading, over the one stream.
  const inventory = useTargetInventory();
  return {
    target: head.defaultTarget,
    revision: head.revision,
    inventory,
    documents: inventoryDocuments(inventory),
    busy: isRunning,
    refusal: head.refusal,
    ran: lastRun(chat),
    activity: unresolvedRuns(chat),
    onSet: (next) => void head.set(next),
  };
}

const requestAddress = (target: DocumentRequest | null): Address | null =>
  target === null ? null : target.kind === "named" ? target.address : null;

const chooseSentence = (resolution: TargetResolution): string =>
  resolution.kind === "resolved"
    ? "resolved"
    : resolution.kind === "checking"
      ? "checking the inventory"
      : resolution.kind === "failed"
        ? resolution.message
        : {
            missing: "no document chosen",
            "session-gone": "the Revit holding it ended — choose again",
            "document-closed": "it is no longer open — choose again",
            "wrong-document-kind": "that document is the wrong kind for this call",
            ambiguous: "two Revits hold it — choose the document again",
          }[resolution.reason];

/* ── the readout: chose / got / ran ────────────────────────────────────────────────────────── */

function Readout({ p, resolution }: { p: ToLineProps; resolution: TargetResolution }) {
  const address = requestAddress(p.target);
  const label = (value: Address | null) =>
    value === null
      ? "nothing — every call refuses until a document is chosen"
      : (p.documents.find((d) => d.document === value)?.label ?? value);
  const drift =
    p.ran !== null &&
    (resolution.kind !== "resolved" ||
      resolution.target.kind !== "document" ||
      p.ran.session !== resolution.target.ref.session);
  const rows: [string, ReactNode, boolean][] = [
    ["chose", label(address), false],
    ["got", chooseSentence(resolution), resolution.kind !== "resolved"],
    [
      "ran",
      p.ran ? (
        <>
          <span className="face-mono">{p.ran.key}</span> r{p.ran.revision}
          {p.ran.session ? ` in ${p.ran.session}` : ""}
          {p.ran.ok ? "" : " — refused"}
          {drift ? " — not what you would get now" : ""}
        </>
      ) : (
        "nothing yet"
      ),
      Boolean(drift),
    ],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 t-small" data-testid="scope-readout">
      {rows.map(([label, value, caution]) => (
        <Fragment key={label}>
          <dt className="t-upper" style={{ color: token("ink-mute") }}>
            {label}
          </dt>
          <dd
            data-tone={caution ? "caution" : undefined}
            style={caution ? undefined : { color: token("ink-2") }}
          >
            {value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** The default Target as the composer's to-line. Mounted by ChatShell in the composer topBar. */
export function ToLine() {
  const p = useToLine();
  const [readout, setReadout] = useState(false);
  const resolution = resolveCallTarget({ needs: "document" }, p.target, p.inventory);
  const address = requestAddress(p.target);
  return (
    <div
      className="hairline-b flex flex-col gap-1 px-3 py-1.5"
      data-testid="scope-head"
      data-scope={resolution.kind}
    >
      <div className="flex flex-wrap items-baseline gap-2 t-small">
        <span className="t-upper" style={{ color: token("ink-mute") }}>
          to
        </span>
        {/* The `choose` door: one control, one reason. No session is ever picked here. */}
        <select
          aria-label="document"
          disabled={p.busy}
          value={address ?? ""}
          onChange={(event) => {
            const next = addressSchema.safeParse(event.target.value).data;
            const holder = p.documents.find((d) => d.document === next)?.holders[0];
            p.onSet(next && holder ? { kind: "named", session: holder, address: next } : null);
          }}
        >
          <option value="">pick a document</option>
          {p.documents.map((document) => (
            <option key={document.document} value={document.document}>
              {document.label}
            </option>
          ))}
        </select>
        {resolution.kind === "resolved" ? null : (
          <span data-tone="caution">{chooseSentence(resolution)}</span>
        )}
        <span className="flex-1" />
        {p.refusal ? <span style={{ color: token("ink-2") }}>{p.refusal}</span> : null}
        <Press
          type="button"
          tone="quiet"
          size="caption"
          data-tone={p.busy ? "pea" : undefined}
          aria-expanded={readout}
          aria-controls="scope-readout"
          title={
            (p.busy ? "pea is mid-turn; the turn keeps the target it was admitted under. " : "") +
            (readout ? "hide the readout" : "readout: chose / got / ran")
          }
          onClick={() => setReadout(!readout)}
          data-testid="scope-revision"
        >
          r{p.revision}
        </Press>
      </div>
      <ChatActivity rows={p.activity} busy={p.busy} />
      {readout ? (
        <div id="scope-readout">
          <Readout p={p} resolution={resolution} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact activity beside the to-line. Every unresolved original operation stays listed, ahead of
 * the turn's in-flight call; a later success appends and never removes one.
 */
function ChatActivity({ rows, busy }: { rows: readonly ChatActivityRow[]; busy: boolean }) {
  const [openId, setOpenId] = useState<string>();
  if (rows.length === 0) return busy ? <span data-tone="meta">running…</span> : null;
  const unresolved = rows.filter((row) => row.state !== "running");
  const summary = unresolved.length
    ? `${unresolved.length} outcome${unresolved.length === 1 ? "" : "s"} unresolved${rows.length > unresolved.length ? " · running" : ""}`
    : `${rows.length} running`;
  return (
    <ActivityDisclosure summary={summary} tone="caution" label="thread activity">
      {rows.map((row) => (
        <ActivityRow
          key={row.id}
          label={`${row.key} / ${row.state}`}
          says={row.says}
          tone={row.tone}
        >
          <Press
            type="button"
            tone="quiet"
            size="caption"
            aria-expanded={openId === row.id}
            aria-controls={`chat-receipt-${row.id}`}
            title={`Read original action ${row.id}. Opening reads once; it starts no stream and retries nothing.`}
            onClick={() => setOpenId(openId === row.id ? undefined : row.id)}
          >
            {openId === row.id ? "hide receipt" : "read status"}
          </Press>
        </ActivityRow>
      ))}
      {openId ? (
        <div id={`chat-receipt-${openId}`}>
          {/* One reader for the selected row, on the same base these operations were admitted
              through, addressed by the original ID. No `watch`, so no stream is opened. */}
          <ActionReceiptView id={openId} base="" />
        </div>
      ) : null}
    </ActivityDisclosure>
  );
}
