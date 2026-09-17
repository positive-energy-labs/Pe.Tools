/**
 * THE MEMBER EDITOR — one member, one draft; form and raw JSON are two modes of that draft. A draft
 * the form cannot render stays raw, byte for byte. Offline the host answers schema issues only;
 * with a Revit session attached it adds the composed preview and the library's semantic issues.
 * `save` overwrites only the bytes it read; `save as new` files a sibling member.
 *
 * Beside the draft sits the member's Settings Work (`memberWork`): Pea's field proposals and the
 * fields a person staged, reviewed card by card and written with `settings.write`. Every route
 * that opens a member (`/pods`, `/family`, the product routes' spec pane) shows the same lane.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { z } from "zod";
import {
  memberWork,
  podMemberSchema,
  settingsRouteState,
  type PodMember,
  type SettingsFieldState,
  type SettingsRouteDocument,
  type SettingsSnapshot,
} from "@pe/agent-contracts";

import { ActionButton } from "#/components/lang/action-button";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip, Tag } from "#/components/lang/chip";
import { Code, JsonEditor } from "#/components/lang/code";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Switcher } from "#/components/lang/switcher";
import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import { useHostStatus } from "#/readings";
import { schemaFormModel } from "#/settings/schema-form";
import { CellTrichotomyReviewer } from "#/workbench/trichotomy-reviewer";
import {
  actionResult,
  saveSettingsAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

import { defineRoute, semanticActionFacts, type MemberRef } from "./manifest";
import { podHost, type Composed } from "./pods";
import { useRoute, type RouteHandle } from "./use-route";

/** The demo lane's member: no host is asked for anything. `fields` seeds its proposal lane. */
export interface DemoSpec {
  content: string;
  schema: string;
  fields?: Record<string, SettingsFieldState>;
}

/* ── the member's Settings Work ────────────────────────────────────────────── */

/** A member as the Settings Work reads it: the saved bytes, and what the host made of them. */
export async function openMember(member: PodMember): Promise<SettingsSnapshot> {
  const { content, sha256 } = await podHost.read(member);
  const composed = await podHost.compose(member, content);
  return {
    member,
    sha256,
    observedAt: new Date().toISOString(),
    rawContent: content,
    composedContent: composed.composed,
    dependencies: [...composed.dependencies],
    validation: {
      isValid: !composed.diagnostics.some((issue) => issue.severity === "error"),
      issues: composed.diagnostics.map((issue) => ({ ...issue })),
    },
  };
}

export type MemberWorkAction = "open" | "adopt" | "save";
export type MemberWorkHandle = RouteHandle<
  SettingsRouteDocument,
  never,
  Record<string, never>,
  MemberWorkAction
>;

const openInput = z.object({ member: podMemberSchema });
const adoptInput = z.object({ sha256: z.string().min(1) });

/**
 * The member Work's verbs. Staging, approving and denying are patches on the Work itself (the
 * reviewer and `/family` write them); refresh and validate stay Work commands Pea calls, because
 * the editor already re-reads the member and shows live composition diagnostics.
 */
export const memberWorkManifest = (seed?: SettingsRouteDocument) => {
  // `?demo=<key>` mounts a seed under whatever key the host page was opened with.
  const demo = globalThis.location
    ? new URLSearchParams(globalThis.location.search).get("demo")
    : null;
  return defineRoute<SettingsRouteDocument, never, Record<string, never>, MemberWorkAction>({
    key: settingsRouteState.route,
    name: "Member",
    docs: "Review Pea's field proposals on one pod member, stage what you accept, and save the member.",
    work: settingsRouteState,
    actions: {
      open: {
        label: "open",
        says: "adopts the member's saved bytes as the Work basis; refuses while edits are pending",
        needs: "host",
        actor: "any",
        input: openInput as never,
        dirties: [],
        ready: () => null,
        run: (ctx, input: z.infer<typeof openInput>) => ctx.command("open", input),
      },
      adopt: {
        label: "adopt disk bytes",
        says: "adopts the member as it is on disk now and discards the old proposals and staged fields",
        needs: "host",
        actor: "human",
        input: adoptInput as never,
        dirties: [],
        ready: (ctx) => (ctx.work.doc?.basis ? null : "open a pod member first"),
        run: (ctx, input: z.infer<typeof adoptInput>) =>
          ctx.command("adopt", { member: ctx.work.doc!.basis!.member, sha256: input.sha256 }),
      },
      save: {
        label: "save",
        ...semanticActionFacts("settings.write"),
        input: z.void() as never,
        dirties: [],
        requires: { work: true },
        ready: (ctx) => {
          const doc = ctx.work.doc;
          if (!doc?.basis) return "open a pod member first";
          if (!doc.basis.sha256) return "review an adopted member before saving";
          return null;
        },
        run: async (ctx) => {
          const doc = ctx.work.doc;
          const revision = ctx.work.revision;
          if (!doc || revision === null) throw Error("Member Work unavailable");
          const result = actionResult(await saveSettingsAction(ctx.work.key, doc, revision)) as
            | { kind?: string }
            | undefined;
          if (result?.kind === "conflict")
            throw Error(
              "The member changed on disk. Adopt the disk bytes after reviewing; staged fields were kept until then.",
            );
        },
      },
    },
    seeds: (seed && demo
      ? {
          [demo]: {
            title: "a member with Pea's proposal lane",
            work: seed,
            readings: {},
            page: {},
          },
        }
      : undefined) as never,
  });
};

/**
 * The member's Settings Work, opened the way every member surface opens it. A member whose Work
 * has no basis yet adopts the saved bytes. `seed` is the demo lane's Work and nothing is fetched.
 */
export function useMemberWork(
  member: PodMember | null,
  seed?: SettingsRouteDocument,
): MemberWorkHandle {
  const manifest = useMemo(() => memberWorkManifest(seed), [seed]);
  const handle = useRoute(manifest, {
    work: !seed && member ? memberWork(member) : undefined,
  }) as MemberWorkHandle;
  const current = handle.work.current;
  const based = Boolean(handle.work.doc?.basis);
  const open = handle.actions.open;
  const key = member ? memberWork(member) : null;
  useEffect(() => {
    if (seed || !member || !current || based) return;
    void open.run({ member } as never);
    // `key` is the member's identity; the object is rebuilt every render.
  }, [seed, key, current, based, open]); // eslint-disable-line react-hooks/exhaustive-deps
  return handle;
}

/** The demo lane's Work for a member: its fixture bytes as the basis, and the seeded fields. */
export const seededWork = (
  member: PodMember | null,
  fixture: DemoSpec | undefined,
): SettingsRouteDocument | undefined =>
  member && fixture?.fields
    ? {
        basis: { member, rawContent: fixture.content, sha256: "demo" },
        fields: fixture.fields,
      }
    : undefined;

const display = (value: unknown) =>
  value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);

/**
 * Pea's proposals and the staged fields on the open member: approve stages, deny clears, undo
 * unstages, and save writes every staged field. It stays out of the way while the Work is clean.
 */
function ProposalLane({ work, readSha }: { work: MemberWorkHandle; readSha: string | null }) {
  const doc = work.work.doc;
  const fields = doc?.fields ?? {};
  const cells = Object.values(fields);
  const proposed = cells.filter((cell) => cell.proposal != null && cell.staged == null).length;
  const staged = cells.filter((cell) => cell.staged != null).length;
  const basisSha = doc?.basis?.sha256 ?? null;
  // The Work reviews bytes the editor no longer sees on disk: only a person may adopt the new ones.
  const moved = !work.demo && readSha !== null && basisSha !== null && readSha !== basisSha;
  if (!proposed && !staged && !moved) return null;
  return (
    <ArtifactFrame
      head={
        <>
          <Tag>pea</Tag>
          <FactChip tone={proposed ? "pea" : "meta"} title="Open Pea proposals on this member.">
            {proposed} proposed
          </FactChip>
          <FactChip tone={staged ? "caution" : "meta"} title="Fields staged for save.">
            {staged} staged
          </FactChip>
          <FactChip
            tone={work.work.revision === null ? "caution" : "meta"}
            title="The member Work's revision; writes are refused while it is not current."
          >
            {work.work.revision === null ? "work not read" : `r${work.work.revision}`}
          </FactChip>
          {moved ? (
            <ActionButton
              label="adopt disk bytes"
              disabled={work.busy !== null}
              reason="The member changed on disk after these proposals were made. Adopting discards them and the staged fields."
              onClick={() => void work.actions.adopt.run({ sha256: readSha } as never)}
            />
          ) : null}
        </>
      }
    >
      <div className="px-3">
        <CellTrichotomyReviewer
          state={{
            apply: work.work.write,
            busy: work.busy?.key ?? null,
            failure: work.failure,
          }}
          segment="fields"
          cells={fields}
          onCommit={() => work.actions.save.run()}
          commitBlocked={work.actions.save.refusal ?? false}
          commitLabel={(count) => `save ${count} staged`}
          reviewHint="Pea proposes; you stage; save writes the member."
          renderLabel={(path) => <span className="face-mono">{path}</span>}
          renderValue={display}
        />
      </div>
    </ArtifactFrame>
  );
}

type Mode = "form" | "raw";

const parse = (raw: string): { value?: Record<string, unknown>; error?: string } => {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { value: value as Record<string, unknown> }
      : { error: "a spec is a JSON object" };
  } catch (error) {
    return { error: (error as Error).message };
  }
};

const setAt = (root: Record<string, unknown>, path: string, value: unknown) => {
  const next = structuredClone(root);
  const keys = path.split(".");
  let node = next;
  for (const key of keys.slice(0, -1)) {
    if (node[key] == null || typeof node[key] !== "object") node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys.at(-1)!] = value;
  return next;
};

/** A saved sibling: `a.json` → `a.<stamp>.json`. */
const siblingPath = (path: string, at = new Date()) =>
  path.replace(/(\.json)?$/, `.${at.toISOString().replace(/[:.]/g, "-")}.json`);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SpecEditor({
  member,
  schema,
  fixture,
  onSaved,
}: {
  member: MemberRef | null;
  /** The member's `$schema`; null = plain data, no library validates it. */
  schema: string | null;
  fixture?: DemoSpec;
  onSaved?: (ref: MemberRef) => void;
}) {
  const status = useHostStatus(!fixture);
  const session =
    !fixture && status.state === "ready" && status.observation.bridgeIsConnected === true;
  const [basis, setBasis] = useState<string | null>(fixture?.content ?? null);
  const [basisSha, setBasisSha] = useState<string | null>(null);
  const [draft, setDraft] = useState(fixture?.content ?? "");
  const [schemaJson, setSchemaJson] = useState<string | null>(fixture?.schema ?? null);
  const [mode, setMode] = useState<Mode>("form");
  const [composed, setComposed] = useState<Composed | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const key = member ? `${member.pod}/${member.path}` : "";
  const seed = useMemo(() => seededWork(member, fixture), [key, fixture]); // eslint-disable-line react-hooks/exhaustive-deps
  const work = useMemberWork(member, seed);
  // A `settings.write` moves the basis; the draft re-reads the bytes it wrote.
  const workSha = work.work.doc?.basis?.sha256 ?? null;

  useEffect(() => {
    if (fixture || !member) return;
    let live = true;
    setBasis(null);
    setFailure(null);
    podHost.read(member).then(
      ({ content, sha256 }) => live && (setBasis(content), setBasisSha(sha256), setDraft(content)),
      (error) => live && setFailure(message(error)),
    );
    return () => {
      live = false;
    };
    // `key` is the member's identity; the object is rebuilt every render.
  }, [key, fixture, workSha]);

  const parsed = useMemo(() => parse(draft), [draft]);
  const form = useMemo(() => schemaFormModel(draft, schemaJson), [draft, schemaJson]);
  const baseline = useMemo(() => schemaFormModel(basis, schemaJson), [basis, schemaJson]);
  const shown: Mode = form ? mode : "raw";

  // Host diagnostics follow the draft: schema issues always, composition and semantics in Revit.
  useEffect(() => {
    if (fixture || !member || parsed.error) return;
    let live = true;
    const timer = setTimeout(() => {
      // One host call: schema issues offline; composition and semantic issues with a session.
      podHost
        .compose(member, draft)
        .then((result) => {
          if (!live) return;
          setComposed(result);
          if (result.schemaJson) setSchemaJson(result.schemaJson);
        })
        .catch((error) => live && setFailure(message(error)));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft, key, session, schema, fixture, parsed.error]);

  if (!member)
    return (
      <EmptyState story="scope" exit="capture a spec, or pick a member">
        no spec open
      </EmptyState>
    );

  const dirty = basis !== null && draft !== basis;
  /** Save overwrites only the bytes this editor read; save as new files a sibling member. */
  const save = (asNew: boolean) =>
    startSave(async () => {
      const ref = asNew ? { pod: member.pod, path: siblingPath(member.path) } : member;
      try {
        const written = asNew
          ? await podHost.write(ref, draft)
          : await podHost.save(ref, draft, basisSha!);
        if (!asNew) {
          setBasis(draft);
          setBasisSha(written.sha256);
        }
        onSaved?.(ref);
      } catch (error) {
        setFailure(message(error));
      }
    });
  const saveReason = fixture
    ? "The demo member is read-only."
    : parsed.error
      ? `The draft is not JSON: ${parsed.error}`
      : dirty
        ? null
        : "Nothing to save.";

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <ProposalLane work={work} readSha={basisSha} />
      <ArtifactFrame
        head={
          <>
            <Tag>spec</Tag>
            <span className="t-small face-mono min-w-0 flex-1 truncate text-ink">
              {member.pod} · {member.path}
            </span>
            <FactChip
              tone={schema ? "meta" : "caution"}
              title={schema ?? "No $schema: plain data, no library validates it."}
            >
              {schema ? (schema.split("/").at(-1) ?? schema) : "no $schema"}
            </FactChip>
            <FactChip
              tone={session ? "done" : "meta"}
              title={
                session
                  ? "A Revit session is attached: composition and semantic issues are live."
                  : "No Revit session: the host checks schema only. Composition needs Revit."
              }
            >
              {session ? "semantic" : "schema only"}
            </FactChip>
            <Switcher
              ariaLabel="editor mode"
              value={shown}
              onChange={setMode}
              options={[
                {
                  value: "form",
                  label: "form",
                  title: form
                    ? "Edit through the schema form."
                    : "The form cannot render this draft; raw JSON is preserved.",
                  disabled: !form,
                },
                { value: "raw", label: "raw", title: "Edit the JSON text." },
              ]}
            />
            <ActionButton
              tone="commit"
              label="save"
              busy={saving}
              disabled={!!saveReason || saving || !basisSha}
              reason={
                saveReason ??
                "Overwrite this member; refuses if it changed on disk since it was read."
              }
              onClick={() => save(false)}
            />
            <ActionButton
              label="save as new"
              busy={saving}
              disabled={!!saveReason || saving}
              reason={
                saveReason ??
                "File the draft as a new member beside this one; apply reads saved members only."
              }
              onClick={() => save(true)}
            />
          </>
        }
      >
        {basis === null && !failure ? (
          <OutcomeLine kind="busy" label="reading member" />
        ) : shown === "form" && form && baseline ? (
          <div className="px-3 py-1.5">
            <SchemaToFieldRender
              schema={form.schema}
              // The member's own URL from pod.list: a draft's $schema may be relative to its file.
              schemaUrl={schema ?? ""}
              baselineValues={baseline.baseline}
              values={form.parsedRaw}
              onChange={(path, value) =>
                setDraft(JSON.stringify(setAt(form.parsedRaw, path, value), null, 2))
              }
            />
          </div>
        ) : (
          <JsonEditor aria-label="spec JSON" value={draft} onChange={setDraft} />
        )}
      </ArtifactFrame>
      {failure ? <OutcomeLine kind="error" label="host" says={failure} /> : null}
      {parsed.error ? <OutcomeLine kind="error" label="json" says={parsed.error} /> : null}
      {!form && !parsed.error && schemaJson ? (
        <OutcomeLine
          kind="advisory"
          label="form"
          says="the schema form cannot render this draft; raw JSON is kept as written"
        />
      ) : null}
      {(composed?.diagnostics ?? []).map((issue, index) => (
        <OutcomeLine
          key={index}
          kind={issue.severity === "error" ? "error" : "advisory"}
          label={issue.path}
          says={issue.message}
        />
      ))}
      {session && composed?.composed ? (
        <Code code={composed.composed} lang="json" title="composed" />
      ) : null}
    </div>
  );
}
