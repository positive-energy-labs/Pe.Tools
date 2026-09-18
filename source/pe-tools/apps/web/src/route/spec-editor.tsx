/**
 * THE MEMBER EDITOR — one member, one draft; form and raw JSON are two modes of that draft. A draft
 * the form cannot render stays raw, byte for byte. Offline the host answers schema issues only;
 * with a Revit session attached it adds the composed preview and the library's semantic issues.
 * Beside the draft sits the member's Settings Work (`memberWork`): Pea's field proposals and the
 * fields a person staged, reviewed card by card. Every route that opens a member (`/pods`,
 * `/family`, the product routes' spec pane) shows the same lane.
 *
 * One save per member. While the Work holds proposals or staged fields, the draft is the Work's
 * root raw edit, staged fields apply on top of it, and save is `settings.write`. With a clean Work,
 * save is `pod.member.save` of the exact bytes, and the Work re-opens on them. `save as new`
 * files a sibling member.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { z } from "zod";
import { SchemaDocument } from "@pe/schema-core";
import {
  memberWork,
  podMemberSchema,
  settingsCandidate,
  settingsRouteState,
  type PodMember,
  type RouteStatePatch,
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
import { projectHostValidationState } from "#/lib/schema-to-field-render/field-state";
import type { RemoteOptionsHook } from "#/lib/schema-to-field-render/shared";
import {
  inventoryOf,
  previousOf,
  useFieldOptionsQuery,
  useHostStatus,
  useInventory,
} from "#/readings";
import { schemaFormModel } from "#/settings/schema-form";
import {
  reviewAddresses,
  reviewCommit,
  reviewPatches,
  ReviewRow,
  WorkBand,
} from "#/components/lang/band";
import {
  actionResult,
  saveSettingsAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

import { defineRoute, semanticActionFacts, type MemberRef } from "./manifest";
import { Picker } from "./picker";
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

const display = (rung: { value?: unknown; delete?: true } | null | undefined) =>
  rung?.delete
    ? "DELETE"
    : rung?.value === undefined
      ? "—"
      : typeof rung.value === "string"
        ? rung.value
        : JSON.stringify(rung.value);

/**
 * Pea's proposals and the staged fields on the open member, on the Work band: accept stages, deny
 * clears, unstage clears the staged value, and save writes every staged field. It stays out of the
 * way while the Work is clean.
 */
function ProposalLane({ work, readSha }: { work: MemberWorkHandle; readSha: string | null }) {
  const doc = work.work.doc;
  // The root raw edit is the editor's draft, not a card.
  const { [""]: _draft, ...fields } = doc?.fields ?? {};
  const items = reviewAddresses(fields);
  const proposed = items.filter(([, cell]) => cell.proposal != null && cell.staged == null).length;
  const staged = items.filter(([, cell]) => cell.staged != null);
  const basisSha = doc?.basis?.sha256 ?? null;
  // The Work reviews bytes the editor no longer sees on disk: only a person may adopt the new ones.
  const moved = !work.demo && readSha !== null && basisSha !== null && readSha !== basisSha;
  if (!items.length && !moved) return null;
  const patch = reviewPatches("fields");
  const run = (patches: RouteStatePatch[]) => void work.work.write(patches).catch(() => undefined);
  const busy = work.busy !== null;
  return (
    <ArtifactFrame
      head={
        <>
          <Tag>pea</Tag>
          <FactChip tone={proposed ? "pea" : "meta"} title="Open Pea proposals on this member.">
            {proposed} proposed
          </FactChip>
          {moved ? (
            <ActionButton
              label="adopt disk bytes"
              disabled={busy}
              reason="The member changed on disk after these proposals were made. Adopting discards them and the staged fields."
              onClick={() => void work.actions.adopt.run({ sha256: readSha } as never)}
            />
          ) : null}
        </>
      }
    >
      <div className="px-3">
        <WorkBand
          count={staged.length}
          noun="field"
          revision={work.work.revision}
          conflict={work.work.conflict}
          reload={work.work.reload}
          busy={busy}
          visible
          discard={() => run(staged.flatMap(([path]) => patch.unstage(path)))}
          commit={reviewCommit(
            `save ${staged.length} staged`,
            staged.length,
            () => void work.actions.save.run().catch(() => undefined),
            work.actions.save.refusal,
          )}
          unresolved={work.failure ? [work.failure.message] : []}
          body={items.map(([path, cell]) => (
            <ReviewRow
              key={path}
              address={path}
              label={<span className="face-mono">{path}</span>}
              cell={cell}
              facts={{ value: display(cell.staged ?? cell.proposal) }}
              busy={busy}
              onAccept={(address) => run(patch.accept(address, cell))}
              onDeny={(address) => run(patch.deny(address))}
              onUnstage={(address) => run(patch.unstage(address))}
            />
          ))}
        />
      </div>
    </ArtifactFrame>
  );
}

/** The document a field asks for its options. Explicit, never implicit, never stored. */
export interface OptionsFrom {
  session: string;
  openId: string;
}

/**
 * THE OPTIONS-FROM SLOT (user verdict, grill round 2). A field's remote options are read from one
 * named Revit document and nothing else: no active-document fallback, no borrowing the Situation's
 * target by accident. A product route pins it to what the route acts on; `/pods` starts it empty
 * and the person picks a session, then a document. Empty means schema-only options, and the head
 * says so.
 */
function useOptionsFrom(pinned: OptionsFrom | null | undefined, enabled: boolean) {
  const [chosen, choose] = useState<OptionsFrom | null>(null);
  const [session, chooseSession] = useState<string | null>(null);
  const owned = pinned === undefined;
  const from = owned ? chosen : pinned;
  const inventory = useInventory(owned && enabled);
  const sessions = inventoryOf(previousOf(inventory)?.sessions ?? []);
  const open = sessions.find(
    (item) => item.sessionId === (session ?? from?.session),
  )?.openDocuments;
  const useRemoteOptions: RemoteOptionsHook = (request, wanted) =>
    useFieldOptionsQuery(request, {
      enabled: wanted && Boolean(from),
      bridgeSessionId: from?.session,
      openDocumentId: from?.openId,
    });
  const word = from
    ? (open?.find((item) => item.openId === from.openId)?.title ?? from.openId)
    : null;
  return {
    useRemoteOptions,
    word,
    owned,
    levels: [
      {
        key: "session",
        label:
          sessions.find((item) => item.sessionId === (session ?? from?.session))?.sessionId ?? null,
        placeholder: "choose a session",
        options: sessions.map((item) => ({
          id: item.sessionId,
          label: item.sdkSessionId ?? item.sessionId,
          sub: `${item.openDocumentCount} open`,
        })),
        note: inventory.state === "failed" ? inventory.message : "no Revit answers the host",
        picked: (id: string) => id === (session ?? from?.session),
        pick: (id: string) => (chooseSession(id), choose(null)),
      },
      {
        key: "document",
        label: word,
        placeholder: "choose a document",
        options: open ? open.map((item) => ({ id: item.openId, label: item.title })) : null,
        note: (session ?? from?.session) ? "nothing open here" : "choose a session first",
        picked: (id: string) => id === from?.openId,
        pick: (id: string) => {
          const chosenSession = session ?? from?.session;
          if (chosenSession) choose({ session: chosenSession, openId: id });
        },
      },
    ],
  };
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

const NO_ISSUES: Composed["diagnostics"] = [];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SpecEditor({
  member,
  schema,
  fixture,
  optionsFrom,
  onSaved,
}: {
  member: MemberRef | null;
  /** The member's `$schema`; null = plain data, no library validates it. */
  schema: string | null;
  fixture?: DemoSpec;
  /**
   * The document field options are read from, pinned read-only by the route that owns the target.
   * Omit it and the editor owns the slot: it starts empty and the person picks (`/pods`).
   */
  optionsFrom?: OptionsFrom | null;
  onSaved?: (ref: MemberRef) => void;
}) {
  const status = useHostStatus(!fixture);
  const session =
    !fixture && status.state === "ready" && status.observation.bridgeIsConnected === true;
  const options = useOptionsFrom(fixture ? null : optionsFrom, !fixture);
  const [basis, setBasis] = useState<string | null>(fixture?.content ?? null);
  const [basisSha, setBasisSha] = useState<string | null>(null);
  /** What the person typed since the last read; null = the draft is the Work's or the disk's. */
  const [typed, setDraft] = useState<string | null>(null);
  const [schemaJson, setSchemaJson] = useState<string | null>(fixture?.schema ?? null);
  const [mode, setMode] = useState<Mode>("form");
  /** The host's last answer, with the draft it answered: an answer on older bytes gates nothing. */
  const [composed, setComposed] = useState<(Composed & { draft: string }) | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const key = member ? `${member.pod}/${member.path}` : "";
  const seed = useMemo(() => seededWork(member, fixture), [key, fixture]); // eslint-disable-line react-hooks/exhaustive-deps
  const work = useMemberWork(member, seed);
  // A `settings.write` moves the basis; the draft re-reads the bytes it wrote.
  const workSha = work.work.doc?.basis?.sha256 ?? null;
  const fields = work.work.doc?.fields ?? {};
  const rootEdit = fields[""]?.staged?.value as string | undefined;
  const workBytes = rootEdit ?? work.work.doc?.basis?.rawContent ?? null;
  // A Work with proposals or staged fields owns the member: the draft is its root raw edit.
  const viaWork = !fixture && Object.values(fields).some((field) => field.staged || field.proposal);
  const staged = Object.values(fields).some((field) => field.staged);
  const draft = typed ?? (viaWork ? workBytes : null) ?? basis ?? "";
  const synced = !viaWork || typed === null || typed === workBytes;

  useEffect(() => {
    if (fixture || !member) return;
    let live = true;
    setBasis(null);
    setFailure(null);
    podHost.read(member).then(
      ({ content, sha256 }) => live && (setBasis(content), setBasisSha(sha256), setDraft(null)),
      (error) => live && setFailure(message(error)),
    );
    return () => {
      live = false;
    };
    // `key` is the member's identity; the object is rebuilt every render.
  }, [key, fixture, workSha]);

  // Typing becomes the Work's root raw edit; back at the basis bytes, the root edit clears.
  const writeWork = work.work.write;
  const basisBytes = work.work.doc?.basis?.rawContent;
  useEffect(() => {
    if (synced || typed === null) return;
    const timer = setTimeout(
      () =>
        void writeWork(
          typed === basisBytes
            ? [{ path: ["fields", ""] }]
            : [{ path: ["fields", ""], value: { proposal: null, staged: { value: typed } } }],
        ),
      400,
    );
    return () => clearTimeout(timer);
  }, [synced, typed, basisBytes, writeWork]);

  const parsed = useMemo(() => parse(draft), [draft]);
  const form = useMemo(() => schemaFormModel(draft, schemaJson), [draft, schemaJson]);
  const baseline = useMemo(() => schemaFormModel(basis, schemaJson), [basis, schemaJson]);
  const shown: Mode = form ? mode : "raw";
  const issues = composed?.diagnostics ?? NO_ISSUES;
  // In the form each issue with a path lands beside its field; the rest stay outcome lines.
  const unplaced = useMemo(
    () =>
      shown === "form" && form
        ? projectHostValidationState(SchemaDocument.from(form.schema), issues).formIssues
        : issues,
    [shown, form, issues],
  );

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
          setComposed({ ...result, draft });
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

  const dirty = viaWork ? staged : basis !== null && draft !== basis;
  /**
   * Save writes the Work (draft plus staged fields) or, with a clean Work, overwrites only the bytes
   * this editor read. Save as new files the same content as a sibling member.
   */
  const save = (asNew: boolean) =>
    startSave(async () => {
      const ref = asNew ? { pod: member.pod, path: siblingPath(member.path) } : member;
      try {
        if (asNew) {
          const content =
            viaWork && basisBytes !== undefined
              ? settingsCandidate(basisBytes, { ...fields, "": { staged: { value: draft } } })
              : draft;
          await podHost.write(ref, content);
        } else if (viaWork) {
          const refusal = await work.actions.save.run();
          if (refusal) throw Error(refusal.message);
        } else {
          const written = await podHost.save(ref, draft, basisSha!);
          setBasis(draft);
          setBasisSha(written.sha256);
          setDraft(null);
          // The clean Work follows the bytes it will review next.
          if (work.work.doc?.basis) await work.actions.open.run({ member });
        }
        onSaved?.(ref);
      } catch (error) {
        setFailure(message(error));
      }
    });
  // Guard (law 14): a member is JSON the type cannot close; the host's schema and composition
  // checks are the judge, so save refuses bytes the host has not yet answered or just called invalid.
  const hostErrors = issues.filter((issue) => issue.severity === "error");
  const saveReason = fixture
    ? "The demo member is read-only."
    : parsed.error
      ? `The draft is not JSON: ${parsed.error}`
      : !synced
        ? "The draft is still being staged on the member."
        : !dirty
          ? "Nothing to save."
          : composed?.draft !== draft
            ? "The host is still checking this draft."
            : hostErrors.length
              ? `The host called this draft invalid: ${hostErrors.length === 1 ? "1 error" : `${hostErrors.length} errors`}, first ${hostErrors[0]!.path || "the member"}: ${hostErrors[0]!.message}.`
              : null;

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
            {options.owned ? (
              <span
                className="t-small"
                title="The document this form reads field options from. With none chosen the form offers the schema's own options only."
              >
                options from <Picker levels={options.levels} />
              </span>
            ) : (
              <FactChip
                tone={options.word ? "meta" : "caution"}
                dashed={!options.word}
                title={
                  options.word
                    ? "Field options are read from the document this route acts on."
                    : "No document: the form offers the schema's own options only."
                }
              >
                {options.word ? `options from ${options.word}` : "schema options only"}
              </FactChip>
            )}
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
                (viaWork
                  ? "Write the draft with the staged fields on top; refuses if the member changed on disk."
                  : "Overwrite this member; refuses if it changed on disk since it was read.")
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
              // The demo lane has no host to answer remote options, so it asks for none.
              schemaUrl={fixture ? "" : (schema ?? "")}
              baselineValues={baseline.baseline}
              useRemoteOptions={options.useRemoteOptions}
              values={form.parsedRaw}
              issues={issues}
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
      {unplaced.map((issue, index) => (
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
