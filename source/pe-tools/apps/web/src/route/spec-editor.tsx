/**
 * THE SPEC EDITOR — one member, one draft; form and raw JSON are two modes of that draft. A draft
 * the form cannot render stays raw, byte for byte. Offline the host answers schema issues only;
 * with a Revit session attached it adds the composed preview and the library's semantic issues.
 * Saving files a new member beside the one opened: `pod.member.write` never overwrites.
 */
import { useEffect, useMemo, useState, useTransition } from "react";

import { ActionButton } from "#/components/lang/action-button";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip, Tag } from "#/components/lang/chip";
import { Code, JsonEditor } from "#/components/lang/code";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Switcher } from "#/components/lang/switcher";
import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import { useHostStatus } from "#/readings";
import { schemaFormModel } from "#/settings-panes/schema-form";

import type { MemberRef } from "./manifest";
import { podHost, type Composed } from "./pods";

/** The demo lane's member: no host is asked for anything. */
export interface DemoSpec {
  content: string;
  schema: string;
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
  }, [key, fixture]);

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
              // ponytail: field options still key on moduleKey host-side; owed with the C# field-options op.
              moduleKey=""
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
