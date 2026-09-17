/**
 * PROTOTYPE — pods and their consuming routes. Round 1 lineup, three shapes on one scenario.
 * Throwaway: `?variant=A|B|C`, switcher bottom-centre. The settings Work is the REAL `?demo=save`
 * seed through `useRoute` (staged fields, a Pea proposal, the captured ScheduleProfile schema);
 * pods, documents, dependency states, the diagnostic and the receipt are fixture (dashed marks).
 *
 *   A  Pod ledger        the Pod is the page; a member's editor is a mode of its row
 *   B  Consumer sentence no pod page; the pod is one more slot in the consuming route's sentence
 *   C  Reconciliation    portable spec on the left, live document on the right, per-field marks
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { settingsFieldPointer, settingsWorkSnapshot } from "@pe/agent-contracts";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip, Tag } from "#/components/lang/chip";
import { Code } from "#/components/lang/code";
import { Press } from "#/components/lang/press";
import { PrototypeSwitcher } from "#/components/prototype-switcher";
import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import { useRoute } from "#/route";
import { Picker, type PickLevel } from "#/route/picker";
import { Situation, SituationCell } from "#/route/situation";
import { schemaFormModel } from "#/settings-panes/schema-form";
import { settingsManifest, type SettingsHandle } from "#/settings/manifest";
import { SETTINGS_SEED_SCHEMA } from "#/settings/seeds";
import {
  CAPTURED_SCHEDULE,
  DIAGNOSTIC,
  DOCUMENTS,
  PODS,
  RECEIPT,
  type Dependency,
  type Member,
  type Pod,
  type RevitDocument,
} from "#/prototype-pods/fixture";

const VARIANTS = [
  { key: "A", label: "Pod ledger — the pod is the page" },
  { key: "B", label: "Consumer sentence — the pod is a slot" },
  { key: "C", label: "Reconciliation — spec ⇄ document" },
] as const;

export const Route = createFileRoute("/prototype-pods")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: typeof search.variant === "string" ? search.variant : "A",
    demo: typeof search.demo === "string" ? search.demo : undefined,
    pod: typeof search.pod === "string" ? search.pod : "local",
    member: typeof search.member === "string" ? search.member : undefined,
    doc: typeof search.doc === "string" ? search.doc : DOCUMENTS[0]!.openId,
  }),
  component: PrototypePods,
});

/* ── selection lives in the URL: pod, member, document ─────────────────────── */

function useSelection() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const set = (patch: Partial<typeof search>) =>
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({ ...previous, ...patch }),
      replace: true,
    } as never);
  const pod = PODS.find((row) => row.key === search.pod) ?? PODS[0]!;
  const member = pod.members.find((row) => row.path === search.member) ?? null;
  const doc = DOCUMENTS.find((row) => row.openId === search.doc) ?? DOCUMENTS[0]!;
  return { search, set, pod, member, doc };
}

function PrototypePods() {
  const { search, set } = useSelection();
  // The real settings Work: `?demo=save` = two staged fields + one open Pea proposal.
  useEffect(() => {
    if (!search.demo) set({ demo: "save" });
  }, [search.demo]);
  const scope = useMemo(() => ({ route: "settings", target: null, work: "demo" }) as const, []);
  const manifest = useMemo(() => settingsManifest({ scope }), [scope]);
  const handle = useRoute(manifest, { work: "demo" });
  if (!search.demo) return null;
  return (
    <main
      className="flex h-screen w-screen max-w-full min-h-0 flex-col overflow-hidden"
      data-surface="page"
    >
      {search.variant === "B" ? (
        <VariantB handle={handle} />
      ) : search.variant === "C" ? (
        <VariantC handle={handle} />
      ) : (
        <VariantA handle={handle} />
      )}
      <PrototypeSwitcher variants={VARIANTS} current={search.variant} />
    </main>
  );
}

/* ── shared marks ──────────────────────────────────────────────────────────── */

const FIXTURE_TITLE =
  "Prototype seam: pods, documents, dependency states, the diagnostic and the receipt are fixture. The schedule JSON, its schema, the staged fields and the Pea proposal are the real settings seed.";

function FixtureMark({ what }: { what: string }) {
  return (
    <FactChip tone="caution" dashed title={FIXTURE_TITLE}>
      fixture · {what}
    </FactChip>
  );
}

const stateTone = (state: Dependency["state"]) =>
  state === "must fetch" ? "caution" : state === "installed" ? "done" : "meta";

/** Dependencies that cross the pod boundary, drawn where a decision needs them. */
function Boundary({ deps, compact }: { deps: readonly Dependency[]; compact?: boolean }) {
  const crossing = deps.filter((dep) => dep.crosses);
  if (!crossing.length) return <span className="t-small text-ink-mute">stays inside the pod</span>;
  if (compact)
    return (
      <span className="flex flex-wrap gap-1">
        {crossing.map((dep) => (
          <FactChip
            key={dep.label}
            tone={stateTone(dep.state)}
            dashed={dep.state === "must fetch"}
            title={`${dep.kind} · ${dep.label}${dep.pin ? ` · pinned ${dep.pin}` : ""} · used by ${dep.usedBy}`}
          >
            {dep.kind} · {dep.state}
          </FactChip>
        ))}
      </span>
    );
  return (
    <table className="w-full table-fixed t-small [&_td]:break-words [&_td]:align-top">
      <thead className="text-ink-mute">
        <tr className="text-left">
          <th className="font-normal">crosses to</th>
          <th className="font-normal">what</th>
          <th className="font-normal">pin</th>
          <th className="font-normal">state</th>
          <th className="font-normal">used by</th>
        </tr>
      </thead>
      <tbody className="hairline-rows">
        {crossing.map((dep) => (
          <tr key={dep.label} className="h-(--item-h)">
            <td>{dep.kind}</td>
            <td className="text-ink">{dep.label}</td>
            <td className="face-mono text-ink-mute">{dep.pin ?? "—"}</td>
            <td data-tone={stateTone(dep.state)}>{dep.state}</td>
            <td className="face-mono">{dep.usedBy}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IdentityLedger(pod: Pod): readonly (readonly [string, ReactNode])[] {
  return [
    ["folder", pod.folder],
    ["lineage", pod.lineage],
    ["content", pod.contentHash],
    ["parent", pod.parentRelease ?? "none (this is the release)"],
    ["origin", pod.origin],
  ];
}

function podLevel(pod: Pod, set: (patch: { pod: string; member?: string }) => void): PickLevel {
  return {
    key: "pod",
    label: pod.name,
    placeholder: "choose a pod",
    options: PODS.map((row) => ({
      id: row.key,
      label: row.name,
      sub: `${row.kind} · ${row.editable ? "editable" : "read-only release"}`,
    })),
    picked: (id) => id === pod.key,
    pick: (id) => set({ pod: id }),
  };
}

function memberLevel(
  pod: Pod,
  member: Member | null,
  set: (patch: { member: string }) => void,
  only?: Member["consumer"],
): PickLevel {
  const rows = only ? pod.members.filter((row) => row.consumer === only) : pod.members;
  return {
    key: "member",
    label: member ? member.path.split("/").at(-1)! : null,
    placeholder: "choose a member",
    options: rows.map((row) => ({
      id: row.path,
      label: row.path,
      sub: `${row.kind}${row.dirty ? " · unsaved" : ""}${row.lastRun ? ` · ran ${row.lastRun.slice(0, 16)}` : ""}`,
    })),
    picked: (id) => id === member?.path,
    pick: (id) => set({ member: id }),
  };
}

function docLevels(doc: RevitDocument, set: (patch: { doc: string }) => void): PickLevel[] {
  return [
    {
      key: "session",
      label: doc.session,
      placeholder: "choose a session",
      options: [{ id: doc.session, label: doc.session, sub: "controlled · dev lane" }],
      picked: () => true,
      pick: () => {},
    },
    {
      key: "document",
      label: doc.title,
      placeholder: "choose a document",
      options: DOCUMENTS.map((row) => ({ id: row.openId, label: row.title, sub: row.kind })),
      picked: (id) => id === doc.openId,
      pick: (id) => set({ doc: id }),
    },
  ];
}

/** The real schema form on the real settings Work, reusable inside any variant. */
function ScheduleForm({ handle }: { handle: SettingsHandle }) {
  const doc = handle.work.doc;
  const snapshot = doc ? settingsWorkSnapshot(doc) : null;
  const candidate = doc ? settingsWorkSnapshot(doc, true) : null;
  const model = useMemo(
    () => schemaFormModel(snapshot?.rawContent ?? "", SETTINGS_SEED_SCHEMA),
    [snapshot?.rawContent],
  );
  const values = useMemo(() => {
    try {
      return JSON.parse(candidate?.rawContent ?? "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [candidate?.rawContent]);
  if (!snapshot || !model)
    return <span className="t-small text-ink-mute">the settings Work has not arrived</span>;
  return (
    <SchemaToFieldRender
      schema={model.schema}
      moduleKey={snapshot.documentId.moduleKey}
      rootKey={snapshot.documentId.rootKey}
      baselineValues={model.baseline}
      values={values}
      onChange={(path, value) =>
        void handle.actions.stage.run({ path: settingsFieldPointer(path.split(".")), value })
      }
    />
  );
}

function stagedOf(handle: SettingsHandle) {
  const fields = handle.work.doc?.fields ?? {};
  return {
    staged: Object.entries(fields).filter(([, field]) => field.staged != null),
    proposals: Object.entries(fields).filter(([, field]) => field.proposal != null),
  };
}

/** The member body for whichever kind is selected. Only the schedule has a real schema + Work. */
function MemberBody({ member, handle }: { member: Member; handle: SettingsHandle }) {
  if (member.kind === "schedule") return <ScheduleForm handle={handle} />;
  if (member.json)
    return (
      <div className="flex flex-col gap-1.5">
        <span className="t-small text-ink-2">
          {member.schema
            ? `declares ${member.schema}; the form for this schema is not mounted in the prototype`
            : "no $schema declared: no library validator is selected, so this is raw JSON (settled contract)"}
        </span>
        <Code code={member.json} lang="json" clamp />
      </div>
    );
  return (
    <span className="t-small text-ink-2">
      {member.kind === "script"
        ? "scripts declare an entrypoint; the web does not edit them"
        : "no content in the fixture"}
    </span>
  );
}

function DiagnosticLine({ handle }: { handle: SettingsHandle }) {
  const { proposals } = stagedOf(handle);
  const tied = proposals.some(([path]) => path === DIAGNOSTIC.path);
  if (!tied) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-2 t-prose" data-tone="caution">
      <span className="face-mono">{DIAGNOSTIC.path}</span>
      <span>{DIAGNOSTIC.says}</span>
      <span className="text-ink-mute">· resolves at {DIAGNOSTIC.resolvesAt}</span>
      <FixtureMark what="diagnostic" />
    </div>
  );
}

function ReceiptLine() {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 t-small">
      <span className="face-mono text-ink">{RECEIPT.runFolder}</span>
      <span>
        {RECEIPT.operation} · {RECEIPT.outcome} · on {RECEIPT.document}
      </span>
      <span className="face-mono text-ink-mute">snapshot {RECEIPT.snapshot}</span>
      <span className="text-ink-2">{RECEIPT.outputs.join(" · ")}</span>
      <FixtureMark what="receipt" />
    </div>
  );
}

function WorkBand({ handle }: { handle: SettingsHandle }) {
  const { staged, proposals } = stagedOf(handle);
  return (
    <div className="flex flex-col gap-1 py-1.5 t-prose">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <b className="font-semibold text-ink">{staged.length} staged</b>
        <span data-tone="pea">{proposals.length} proposed by Pea</span>
        <span className="text-ink-mute">
          edits land in the pod's editable settings source; save writes the file, nothing reaches
          Revit until apply
        </span>
      </div>
      {staged.map(([path, field]) => (
        <div key={path} className="flex gap-2 face-mono t-small">
          <span className="text-ink-2">{path}</span>
          <b className="text-ink">{JSON.stringify(field.staged?.value)}</b>
        </div>
      ))}
      <DiagnosticLine handle={handle} />
    </div>
  );
}

/* ═══ A · Pod ledger ═══════════════════════════════════════════════════════════ */

function VariantA({ handle }: { handle: SettingsHandle }) {
  const { pod, member, doc, set } = useSelection();
  const { staged } = stagedOf(handle);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && member) set({ member: undefined });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [member]);
  const sentence = (
    <>
      <SituationCell io="rw">
        <Picker levels={[podLevel(pod, set)]} title="the pod being edited" />
      </SituationCell>{" "}
      for{" "}
      <SituationCell io="w">
        <Picker levels={docLevels(doc, set)} title="the document an apply will affect" />
      </SituationCell>
      .
    </>
  );
  return (
    <>
      <Situation
        handle={{ ...handle, manifest: { ...handle.manifest, name: "Pod" } } as SettingsHandle}
        sentence={sentence}
        target={{ session: doc.session, document: doc.title }}
        commit="save"
        work={
          staged.length
            ? {
                count: staged.length,
                noun: "field edit",
                read: "seed",
                discard: async () => {},
                body: <WorkBand handle={handle} />,
              }
            : undefined
        }
        band={
          <div className="flex flex-wrap items-center gap-2 py-1">
            <FixtureMark what="pods, documents, dependency states" />
            <FactChip
              tone={pod.editable ? "done" : "caution"}
              title="Whether this pod's settings source may be written."
            >
              {pod.editable ? "editable source" : "read-only release · import a copy to edit"}
            </FactChip>
            <FactChip title="Publish shares pod.json, source/settings/assets; output is excluded.">
              shareable: pod.json + settings/ + scripts/ · output/ excluded
            </FactChip>
          </div>
        }
        ledger={IdentityLedger(pod)}
      />
      <div className="min-h-0 flex-1 overflow-auto px-3 py-1.5">
        <ArtifactFrame
          head={
            <>
              <Tag>members</Tag>
              <span className="t-small text-ink-2">
                {pod.members.length} in {pod.folder}
              </span>
              <span className="ml-auto t-small text-ink-mute">
                click a row to edit it here · Esc returns
              </span>
            </>
          }
        >
          <table className="w-full table-fixed t-small [&_td]:break-words [&_td]:align-top">
            <thead className="text-ink-mute">
              <tr className="text-left">
                <th className="px-3 font-normal">member</th>
                <th className="font-normal">kind</th>
                <th className="font-normal">consumed by</th>
                <th className="font-normal">validator</th>
                <th className="font-normal">crosses the boundary</th>
                <th className="font-normal">last capture</th>
                <th className="font-normal">last run</th>
              </tr>
            </thead>
            <tbody className="hairline-rows">
              {pod.members.map((row) => {
                const selected = row.path === member?.path;
                return (
                  <tr
                    key={row.path}
                    aria-selected={selected}
                    className="h-(--item-h) cursor-pointer"
                    onClick={() => set({ member: selected ? undefined : row.path })}
                  >
                    <td className={`px-3 face-mono ${row.dirty ? "font-semibold text-ink" : ""}`}>
                      {row.path}
                      {row.dirty ? " ✱" : ""}
                    </td>
                    <td>{row.kind}</td>
                    <td className="face-mono">{row.consumer ?? "—"}</td>
                    <td className="face-mono text-ink-mute">
                      {row.schema ? row.schema.split("/").at(-1) : "none"}
                    </td>
                    <td>
                      <Boundary deps={row.deps} compact />
                    </td>
                    <td className="face-mono text-ink-mute">{row.lastCapture ?? "—"}</td>
                    <td className="face-mono text-ink-mute">{row.lastRun ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ArtifactFrame>
        {member ? (
          <div className="mt-1.5">
            <ArtifactFrame
              head={
                <>
                  <Tag>{member.kind}</Tag>
                  <span className="face-mono t-small text-ink">{member.path}</span>
                  {member.consumer ? (
                    <FactChip title="The route that consumes this member; its verbs are the same here.">
                      {member.consumer}
                    </FactChip>
                  ) : null}
                  <span className="ml-auto flex items-center gap-1.5">
                    <Press
                      frame="line"
                      size="value"
                      tone="quiet"
                      title="prototype: no capture op wired"
                    >
                      ← capture from {doc.title}
                    </Press>
                    <Press
                      frame="line"
                      size="value"
                      tone="neutral"
                      state="disabled"
                      disabled
                      title={
                        member.deps.some((dep) => dep.state === "must fetch")
                          ? "refused: a pinned pod source is not installed — fetch pe-mech-standards@2026.09 first"
                          : "prototype: no apply op wired"
                      }
                    >
                      apply → {doc.title}
                    </Press>
                  </span>
                </>
              }
            >
              <div className="flex flex-col gap-2 px-3 py-1.5">
                <Boundary deps={member.deps} />
                <MemberBody member={member} handle={handle} />
                {member.dirty ? <ReceiptLine /> : null}
              </div>
            </ArtifactFrame>
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ═══ B · Consumer sentence ════════════════════════════════════════════════════ */

const CONSUMERS = [
  { route: "/schedule-grid", name: "Schedule Grid", word: "Authoring" },
  { route: "/family", name: "Family", word: "Authoring" },
  { route: "/families", name: "Families", word: "Placing" },
] as const;

function VariantB({ handle }: { handle: SettingsHandle }) {
  const { pod, doc, set, search } = useSelection();
  const [consumerKey, setConsumer] =
    useState<(typeof CONSUMERS)[number]["route"]>("/schedule-grid");
  const consumer = CONSUMERS.find((row) => row.route === consumerKey)!;
  const candidates = pod.members.filter((row) => row.consumer === consumer.route);
  const member = candidates.find((row) => row.path === search.member) ?? candidates[0] ?? null;
  const { staged } = stagedOf(handle);
  const mustFetch = member?.deps.find((dep) => dep.state === "must fetch");
  const sentence = (
    <>
      <SituationCell io="rw" empty={!member}>
        <Picker
          levels={[memberLevel(pod, member, set, consumer.route)]}
          title="the member this route reads and writes"
        />
      </SituationCell>{" "}
      of{" "}
      <SituationCell io="r">
        <Picker levels={[podLevel(pod, set)]} title="the pod that owns the member" />
      </SituationCell>{" "}
      {consumer.route === "/families" ? "over" : "with"}{" "}
      <SituationCell io="w">
        <Picker levels={docLevels(doc, set)} title="the document an apply will affect" />
      </SituationCell>
      .
    </>
  );
  return (
    <>
      <div className="flex items-center gap-1 px-3 pt-1 t-small">
        <span className="text-ink-mute">route:</span>
        {CONSUMERS.map((row) => (
          <Press
            key={row.route}
            size="value"
            frame="line"
            tone={row.route === consumerKey ? "neutral" : "quiet"}
            aria-pressed={row.route === consumerKey}
            onClick={() => {
              setConsumer(row.route);
              set({ member: undefined });
            }}
          >
            {row.route}
          </Press>
        ))}
        <span className="ml-2 text-ink-mute">
          same head grammar on every consumer; no pod page exists in this variant
        </span>
      </div>
      <Situation
        handle={
          { ...handle, manifest: { ...handle.manifest, name: consumer.name } } as SettingsHandle
        }
        sentence={sentence}
        target={{ session: doc.session, document: doc.title }}
        commit="save"
        work={
          staged.length && member?.kind === "schedule"
            ? {
                count: staged.length,
                noun: "field edit",
                read: "seed",
                discard: async () => {},
                body: <WorkBand handle={handle} />,
              }
            : undefined
        }
        band={
          <div className="flex flex-wrap items-center gap-2 py-1">
            <FixtureMark what="pods, documents, dependency states" />
            {mustFetch ? (
              <FactChip
                tone="caution"
                dashed
                title={`${mustFetch.label} is pinned at ${mustFetch.pin}; apply is refused until it is installed. Used by ${mustFetch.usedBy}.`}
              >
                apply refused · fetch {mustFetch.label}
              </FactChip>
            ) : null}
            {staged.length ? (
              <FactChip
                tone="caution"
                title="Changing the member while a draft is dirty keeps the draft on its member; the sentence would show ✱ on the previous member until saved or discarded."
              >
                switching members keeps this draft on {member?.path.split("/").at(-1)}
              </FactChip>
            ) : null}
          </div>
        }
        ledger={[
          ...IdentityLedger(pod),
          ["member", member?.path ?? "none"],
          ["validator", member?.schema ?? "none selected"],
          ["last run", member?.lastRun ?? "never"],
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto px-3 py-1.5">
        {member ? (
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(18rem,1fr)] gap-1.5">
            <ArtifactFrame
              head={
                <>
                  <Tag>{member.kind}</Tag>
                  <span className="face-mono t-small text-ink">{member.path}</span>
                </>
              }
            >
              <div className="px-3 py-1.5">
                <MemberBody member={member} handle={handle} />
              </div>
            </ArtifactFrame>
            <div className="flex flex-col gap-1.5">
              <ArtifactFrame head={<Tag>at apply, this member reaches</Tag>}>
                <div className="px-3 py-1.5">
                  <Boundary deps={member.deps} />
                </div>
              </ArtifactFrame>
              <ArtifactFrame head={<Tag>last run</Tag>}>
                <div className="px-3 py-1.5">
                  {member.lastRun ? (
                    <ReceiptLine />
                  ) : (
                    <span className="t-small text-ink-mute">never run</span>
                  )}
                </div>
              </ArtifactFrame>
              <ArtifactFrame head={<Tag>capture</Tag>}>
                <div className="flex flex-col gap-1 px-3 py-1.5 t-small">
                  <span className="text-ink-2">{member.lastCapture ?? "never captured"}</span>
                  <Press
                    frame="line"
                    size="value"
                    tone="quiet"
                    title="prototype: no capture op wired"
                  >
                    ← capture from {doc.title} into this member
                  </Press>
                </div>
              </ArtifactFrame>
            </div>
          </div>
        ) : (
          <span className="t-small text-ink-2">
            {pod.name} has no {consumer.route} member; pick another pod or capture one from{" "}
            {doc.title}.
          </span>
        )}
      </div>
    </>
  );
}

/* ═══ C · Reconciliation board (ambitious) ═════════════════════════════════════ */

type Mark = "=" | "≠" | "∅" | "—";

function reconcile(spec: Record<string, unknown>, captured: Record<string, unknown>) {
  const keys = [...new Set([...Object.keys(spec), ...Object.keys(captured)])].filter(
    (key) => key !== "$schema",
  );
  return keys.map((key) => {
    const s = spec[key];
    const c = captured[key];
    const mark: Mark =
      s === undefined
        ? "∅"
        : c === undefined
          ? "—"
          : JSON.stringify(s) === JSON.stringify(c)
            ? "="
            : "≠";
    return { key, spec: s, captured: c, mark };
  });
}

function VariantC({ handle }: { handle: SettingsHandle }) {
  const { pod, doc, set, search } = useSelection();
  const member =
    pod.members.find((row) => row.path === search.member) ??
    pod.members.find((row) => row.kind === "schedule")!;
  const candidate = handle.work.doc ? settingsWorkSnapshot(handle.work.doc, true) : null;
  const spec = useMemo(() => {
    try {
      return JSON.parse(candidate?.rawContent ?? "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [candidate?.rawContent]);
  const rows = member.kind === "schedule" ? reconcile(spec, CAPTURED_SCHEDULE) : [];
  const counts = rows.reduce<Record<Mark, number>>(
    (acc, row) => ({ ...acc, [row.mark]: acc[row.mark] + 1 }),
    { "=": 0, "≠": 0, "∅": 0, "—": 0 },
  );
  const { staged } = stagedOf(handle);
  const sentence = (
    <>
      <SituationCell io="rw">
        <Picker levels={[memberLevel(pod, member, set)]} />
      </SituationCell>{" "}
      of{" "}
      <SituationCell io="r">
        <Picker levels={[podLevel(pod, set)]} title="the pod that owns the member" />
      </SituationCell>{" "}
      against{" "}
      <SituationCell io="r">
        <Picker
          levels={docLevels(doc, set)}
          title="the document being read; replicate writes to it"
        />
      </SituationCell>
      .
    </>
  );
  const markWord: Record<Mark, string> = {
    "=": "spec and document agree",
    "≠": "spec and document differ",
    "∅": "in the document, not in the spec — capture would add it",
    "—": "in the spec, not in the document — replicate would add it",
  };
  return (
    <>
      <Situation
        handle={
          { ...handle, manifest: { ...handle.manifest, name: "Reconcile" } } as SettingsHandle
        }
        sentence={sentence}
        target={{ session: doc.session, document: doc.title }}
        commit="save"
        work={
          staged.length
            ? {
                count: staged.length,
                noun: "field edit",
                read: "seed",
                discard: async () => {},
                body: <WorkBand handle={handle} />,
              }
            : undefined
        }
        band={
          <div className="flex flex-wrap items-center gap-2 py-1">
            <FixtureMark what="captured side, pods, documents" />
            <FactChip
              tone="caution"
              dashed
              title="Ambitious seam: no operation projects a live schedule back into ScheduleProfile shape today. The capture op returns a grid snapshot."
            >
              per-field capture correspondence does not exist yet
            </FactChip>
            {(["=", "≠", "∅", "—"] as Mark[]).map((mark) => (
              <FactChip key={mark} title={markWord[mark]} tone={mark === "≠" ? "caution" : "meta"}>
                {mark} {counts[mark]}
              </FactChip>
            ))}
          </div>
        }
        ledger={IdentityLedger(pod)}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[14rem_minmax(0,1fr)] gap-1.5 overflow-auto px-3 py-1.5">
        <ArtifactFrame head={<Tag>members</Tag>}>
          <div className="hairline-rows t-small">
            {pod.members.map((row) => (
              <button
                key={row.path}
                type="button"
                aria-selected={row.path === member.path}
                className="flex h-(--item-h) w-full items-center gap-2 px-2 text-left"
                onClick={() => set({ member: row.path })}
              >
                <span
                  className={`min-w-0 flex-1 truncate face-mono ${row.dirty ? "font-semibold text-ink" : ""}`}
                >
                  {row.path.split("/").at(-1)}
                </span>
                <span className="face-mono text-ink-mute">
                  {row.kind === "schedule"
                    ? `${counts["≠"]}≠ ${counts["∅"]}∅`
                    : row.lastCapture
                      ? "cap"
                      : "·"}
                </span>
              </button>
            ))}
          </div>
        </ArtifactFrame>
        <div className="min-h-0 overflow-y-auto">
          <ArtifactFrame
            head={
              <>
                <Tag>{member.kind}</Tag>
                <span className="face-mono t-small text-ink">{member.path}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <Press
                    frame="line"
                    size="value"
                    tone="quiet"
                    title="prototype: takes every ∅ and ≠ from the document into the spec"
                  >
                    ← capture all
                  </Press>
                  <Press
                    frame="line"
                    size="value"
                    tone="neutral"
                    state="disabled"
                    disabled
                    title="refused: @company/_fields/Header is pinned and not installed; fetch first"
                  >
                    replicate all →
                  </Press>
                </span>
              </>
            }
          >
            {member.kind === "schedule" ? (
              <table className="w-full table-fixed t-small [&_td]:break-words [&_td]:align-top">
                <thead className="text-ink-mute">
                  <tr className="text-left">
                    <th className="px-3 font-normal">field</th>
                    <th className="font-normal">portable spec · you own · {pod.folder}</th>
                    <th className="w-8 text-center font-normal">⇄</th>
                    <th className="font-normal">live document · {doc.title}</th>
                    <th className="font-normal">boundary</th>
                  </tr>
                </thead>
                <tbody className="hairline-rows align-top">
                  {rows.map((row) => {
                    const dep = member.deps.find((dep) => dep.usedBy.startsWith(row.key));
                    const stagedField = handle.work.doc?.fields[`/${row.key}`]?.staged;
                    return (
                      <tr key={row.key} className="min-h-(--item-h)">
                        <td className="px-3 face-mono">{row.key}</td>
                        <td className={stagedField ? "font-semibold text-ink" : ""}>
                          <Cellish value={row.spec} />
                        </td>
                        <td
                          className="text-center face-mono"
                          data-tone={row.mark === "≠" ? "caution" : undefined}
                          title={markWord[row.mark]}
                        >
                          {row.mark}
                        </td>
                        <td className="text-ink-2">
                          <Cellish value={row.captured} />
                        </td>
                        <td>
                          {dep ? (
                            <FactChip
                              tone={stateTone(dep.state)}
                              dashed={dep.state === "must fetch"}
                              title={`${dep.label}${dep.pin ? ` · ${dep.pin}` : ""}`}
                            >
                              {dep.kind} · {dep.state}
                            </FactChip>
                          ) : (
                            <span className="text-ink-mute">inside</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="px-3 py-1.5">
                <span className="t-small text-ink-2">
                  only the schedule member has a captured side in this fixture
                </span>
                <MemberBody member={member} handle={handle} />
              </div>
            )}
            <div className="px-3 py-1.5">
              <DiagnosticLine handle={handle} />
            </div>
          </ArtifactFrame>
          <div className="mt-1.5">
            <ArtifactFrame head={<Tag>edit the spec side</Tag>}>
              <div className="px-3 py-1.5">
                <MemberBody member={member} handle={handle} />
              </div>
            </ArtifactFrame>
          </div>
        </div>
      </div>
    </>
  );
}

function Cellish({ value }: { value: unknown }) {
  if (value === undefined) return <span className="text-ink-mute">—</span>;
  if (typeof value !== "object" || value === null)
    return <span className="face-mono">{String(value)}</span>;
  const text = JSON.stringify(value, null, 1).replaceAll("\n", " ");
  return (
    <span className="face-mono" title={text}>
      {text.length > 120 ? `${text.slice(0, 120)}…` : text}
    </span>
  );
}
