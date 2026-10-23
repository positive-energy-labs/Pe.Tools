import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * THROWAWAY protoui variant 3 (2026-10-13): BARE PATCH BAY. Revit is the spine: year sockets on
 * top, one dense line per running Revit, and Pea threads / Work nested UNDER the session they
 * target ("what is each Revit doing, and who is driving it"). Unbound threads tail. Fixture-only.
 */
import { useMemo, useState } from "react";
import { Play, RotateCw, Square } from "lucide-react";
import {
  emptyThreadLifecycle,
  type HarnessThreadSummary,
  type MachineSession,
} from "@pe/agent-contracts";

import { Button } from "@pe/kit/lang/button";
import { ProviderMark } from "#/components/lang/provider-mark";
import { Row } from "@pe/kit/lang/row";
import { activityWord, isUnread, relativeThreadAge } from "#/chat/thread-navigation";
import { custodyOf, keyOf, phaseOf, unsavedOf } from "#/machine/session";
import { chipText, planWaits, shareState } from "#/machine/model";
import { BAY_THREADS, MACHINE_SEEDS } from "#/open/seeds";

import { updateSaid } from "#/machine/update-state";

import type { VariantMeta } from "./lineup";

export const meta: VariantMeta = { id: "3", label: "Bare patch bay", width: 400, height: 600 };

const seed = MACHINE_SEEDS["patch-bay"];
const machine = seed.state === "ready" ? seed.observation : null;

const read = (t: HarnessThreadSummary): HarnessThreadSummary => ({
  ...t,
  lifecycle: { ...t.lifecycle, readSeq: t.activity.lastSeq },
});
const mk = (
  base: HarnessThreadSummary,
  id: string,
  title: string,
  activity: Partial<HarnessThreadSummary["activity"]>,
  target: { session: string; openId: string } | null,
): HarnessThreadSummary => ({
  ...base,
  id,
  title,
  activity: { ...base.activity, ...activity },
  lifecycle: { ...emptyThreadLifecycle(), readSeq: base.activity.lastSeq },
  head: {
    ...base.head,
    targets: target
      ? [{ request: { kind: "open", ref: target }, label: title, admission: null }]
      : [],
  },
});
const B = BAY_THREADS[0]!;
/** Local fixture: the bay's three threads plus a waiting, a failed, a finished-unread, an unbound. */
const THREADS: HarnessThreadSummary[] = [
  ...BAY_THREADS.map(read),
  mk(
    B,
    "t-wait",
    "Resize ducts on L3",
    { state: "waiting", pending: 1, lastSeq: 52, message: "Approve 14 duct changes?" },
    { session: "bridge-18244", openId: "18244-hospital" },
  ),
  {
    ...mk(
      B,
      "t-done",
      "Family audit SD-Diffuser",
      { state: "idle", lastSeq: 70, message: "Found 3 issues" },
      { session: "bridge-18244", openId: "18244-sd" },
    ),
    lifecycle: { ...emptyThreadLifecycle(), readSeq: 60 },
  },
  mk(
    B,
    "t-fail",
    "Export sheets to PDF",
    { state: "failed", lastSeq: 15, message: "Revit closed mid-export" },
    { session: "bridge-gone", openId: "x" },
  ),
  mk(B, "t-free", "Draft a naming standard", { state: "idle", lastSeq: 9, message: "" }, null),
];
/** Local fixture: Work (a proposal) bound to Pea's 2025 job. */
const WORK = [
  {
    id: "w1",
    session: "bridge-22910",
    label: "Proposal · 37 field renames on Schedules",
    changes: 37,
  },
];

const notifies = (t: HarnessThreadSummary) => {
  const { state, pending } = t.activity;
  return (
    pending > 0 || state === "waiting" || state === "failed" || (state === "idle" && isUnread(t))
  );
};
const Dot = () => (
  <span
    className="inline-block size-1.5 rounded-full bg-current"
    data-tone="alarm"
    aria-label="needs you"
  />
);
const Lamp = ({ on }: { on: boolean }) => (
  <span
    className={"inline-block size-2 rounded-full " + (on ? "bg-current" : "border border-line")}
    data-tone={on ? "done" : undefined}
  />
);
const sessionKey = (s: MachineSession) => s.attachment?.session ?? keyOf(s);

export default function Variant() {
  const [launched, setLaunched] = useState<number[]>([]);
  const sessions = machine?.revit.sessions ?? [];
  const years = machine?.revit.years ?? [];
  const bound = useMemo(() => new Set(sessions.map(sessionKey)), [sessions]);
  const sessionOf = (t: HarnessThreadSummary) => {
    const request = t.head.targets[0]?.request;
    return request?.kind === "open" ? request.ref.session : null;
  };
  const under = (s: MachineSession) => THREADS.filter((t) => sessionOf(t) === sessionKey(s));
  const orphans = THREADS.filter((t) => !bound.has(sessionOf(t) ?? ""));
  const update = machine ? updateSaid(machine) : { text: "unread" };
  const share = machine ? shareState(machine) : { text: "unread" };

  return (
    <div data-surface="document" className="flex h-full w-full flex-col text-ink">
      {/* sockets */}
      <div className="grid grid-cols-3 gap-1 p-2">
        {years.map((y) => {
          const n =
            sessions.filter((s) => s.row.year === y).length +
            launched.filter((l) => l === y).length;
          return (
            <TooltipHint
              key={y}
              content={n ? `${n} running · click launches another` : `Launch Revit ${y}`}
            >
              <button
                type="button"
                onClick={() => setLaunched((l) => [...l, y])}
                className="flex h-8 items-center justify-between rounded-sm border border-line px-2 face-mono t-small"
              >
                <span className="flex items-center gap-1.5">
                  <Lamp on={n > 0} />
                  {y}
                </span>
                {n ? (
                  <span className="text-ink-2 tabular-nums">{n}</span>
                ) : (
                  <Play className="size-3 text-ink-2" />
                )}
              </button>
            </TooltipHint>
          );
        })}
      </div>

      {/* spine */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.map((s) => {
          const docs = s.documents ?? [];
          const active = docs.find((d) => d.isActive);
          const phase = phaseOf(s.row);
          const unsaved = unsavedOf(s).length;
          const kids = under(s);
          const key = sessionKey(s);
          const works = WORK.filter((w) => w.session === key);
          return (
            <div key={keyOf(s)} className="hairline-t">
              <Row
                lead={
                  s.whose === "pea" ? (
                    <ProviderMark harness="pea" />
                  ) : (
                    <Lamp on={phase === "ready"} />
                  )
                }
                label={<span className="face-mono">{s.row.year}</span>}
                aside={`${custodyOf(s.row)}${phase === "ready" ? "" : " · " + phase} · ${active?.title ?? "no document"} · ${docs.length} doc${docs.length === 1 ? "" : "s"}${unsaved ? ` · ${unsaved} unsaved` : ""}`}
                meta={s.whose === "pea" ? "pea" : "you"}
                actions={
                  <>
                    <Button label="Hot reload" icon={RotateCw} />
                    <Button label="Stop" icon={Square} />
                  </>
                }
              />
              {kids.map((t) => (
                <div key={t.id} className="pl-5">
                  <Row
                    lead={<ProviderMark harness={t.harness} />}
                    label={t.title}
                    aside={t.activity.message}
                    meta={
                      <span className="flex items-center gap-1.5">
                        {notifies(t) ? <Dot /> : null}
                        <span className="text-ink-2">
                          {activityWord(t)?.toLowerCase() ?? relativeThreadAge(t.updatedAt)}
                        </span>
                      </span>
                    }
                  />
                </div>
              ))}
              {works.map((w) => (
                <div key={w.id} className="pl-5">
                  <Row
                    lead={<span className="face-mono text-ink-2">Δ</span>}
                    label={w.label}
                    meta={<Dot />}
                  />
                </div>
              ))}
            </div>
          );
        })}
        {orphans.length ? (
          <div className="hairline-t">
            <div className="t-small t-upper px-2 pt-1.5 text-ink-2">unbound</div>
            {orphans.map((t) => (
              <Row
                key={t.id}
                lead={<ProviderMark harness={t.harness} />}
                label={t.title}
                aside={t.activity.message}
                meta={
                  <span className="flex items-center gap-1.5">
                    {notifies(t) ? <Dot /> : null}
                    <span className="text-ink-2">
                      {activityWord(t)?.toLowerCase() ?? relativeThreadAge(t.updatedAt)}
                    </span>
                  </span>
                }
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* footer */}
      <div className="hairline-t flex flex-col gap-0.5 px-2 py-1.5 t-small face-mono text-ink-2">
        <div className="flex justify-between">
          <span>update {update.text}</span>
          <span>share {share.text}</span>
          {machine && planWaits(machine) ? <Dot /> : null}
        </div>
        <div className="truncate">
          {machine ? chipText(seed) : "host unread"} · pid {machine?.host?.process.pid} · :
          {machine?.host?.port}
        </div>
      </div>
    </div>
  );
}
