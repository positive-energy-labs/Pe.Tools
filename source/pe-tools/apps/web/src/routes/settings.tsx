import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";

import {
  type SettingsFieldState,
  type SettingsRouteDocument,
  settingsFieldPointer,
  settingsFieldSegments,
  settingsRouteState,
} from "@pe/agent-contracts";
import {
  SettingsFileKind,
  type SettingsFileEntry,
  type SettingsValidationResult,
} from "@pe/host-contracts/operation-types";
import {
  applySchemaDefaultsToValue,
  parseSchema,
  removeSchemaDefaultsFromValue,
} from "@pe/schema-core";

import { SchemaToFieldRender } from "#/lib/schema-to-field-render";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { StateCell } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { useSchemaQuery, useTreeQuery, useWorkspacesQuery } from "#/host/queries";
import { useVerb } from "#/lib/use-verb";
import { timeAgo } from "#/lib/utils";
import { useRouteState } from "#/workbench/route-state";

/**
 * /settings — the substrate-backed replacement for the old settings-prototype form.
 *
 * All collaborative state lives in the `route:settings` document: pea opens a
 * schema-backed host settings file into the snapshot and proposes field values
 * (JSON Pointers into the parsed raw JSON); the engineer reviews, stages, validates, and
 * saves. Writes go through the route-state dispatcher as `actor:"human"` — pea's
 * proposals arrive identically over SSE. The picker still speaks the host directly
 * (settings.workspaces / settings.tree) to choose which document `open` targets.
 *
 * Design-language pass 2026-08-16: head is the one `AddressingBar` (this route no longer
 * rides `RouteWorkspaceShell`); the field grid is the machine-operated object and wears the
 * one `ArtifactFrame`; field values render through `StateCell` (proposed / staged / clean);
 * verbs are lang `Verb`s bracketed by `useVerb`. Gaps are recorded in
 * docs/features/settings/DESIGN-AUDIT.md.
 */
export const Route = createFileRoute("/settings")({
  /** PROTOTYPE (settings-panes round 1, throwaway): `?variant=` mounts the pane-composition
   * variants beside the shipping surface. No variant param = the shipping surface, unchanged.
   * See docs/features/settings/PRODUCT.md. */
  validateSearch: (search: Record<string, unknown>): { variant?: string } => ({
    variant:
      typeof search.variant === "string" && search.variant.trim()
        ? search.variant.trim()
        : undefined,
  }),
  component: SettingsRouteGate,
});

/* ── PROTOTYPE GATE — everything between these markers dies with the round ── */
import { lazy, Suspense } from "react";
import { ProtoSwitcher } from "#/settings-panes/proto-switcher";

const PROTO_VARIANTS = [
  { key: "ship", name: "shipping surface" },
  { key: "a", name: "modeful document" },
  { key: "b", name: "workbench" },
  { key: "c", name: "annotated file" },
  { key: "d", name: "embedding proof" },
];

const VariantA = lazy(() =>
  import("#/settings-panes/variants/a-modeful-doc").then((m) => ({ default: m.VariantA })),
);
const VariantB = lazy(() =>
  import("#/settings-panes/variants/b-workbench").then((m) => ({ default: m.VariantB })),
);
const VariantC = lazy(() =>
  import("#/settings-panes/variants/c-annotated-file").then((m) => ({ default: m.VariantC })),
);
const VariantD = lazy(() =>
  import("#/settings-panes/variants/d-embedding-proof").then((m) => ({ default: m.VariantD })),
);

function SettingsRouteGate() {
  const { variant } = Route.useSearch();
  const key = variant ?? "ship";
  return (
    <>
      {key === "ship" ? (
        <SettingsRoute />
      ) : (
        <Suspense fallback={null}>
          {key === "a" ? <VariantA /> : null}
          {key === "b" ? <VariantB /> : null}
          {key === "c" ? <VariantC /> : null}
          {key === "d" ? <VariantD /> : null}
        </Suspense>
      )}
      <ProtoSwitcher variants={PROTO_VARIANTS} current={key} />
    </>
  );
}
/* ── END PROTOTYPE GATE ── */

function isAuthoringFile(entry: SettingsFileEntry) {
  return (
    entry.kind !== SettingsFileKind.Fragment &&
    entry.kind !== SettingsFileKind.Schema &&
    !entry.isFragment &&
    !entry.isSchema &&
    entry.relativePath.toLowerCase().endsWith(".json")
  );
}

function SettingsRoute() {
  const route = useRouteState(settingsRouteState);
  const document = route.slice;
  const snapshot = document?.snapshot ?? null;

  const [workspaceKey, setWorkspaceKey] = useState<string>();
  const [moduleKey, setModuleKey] = useState<string>();
  const [rootKey, setRootKey] = useState<string>();
  const [filePath, setFilePath] = useState<string>();
  const verb = useVerb();

  const workspacesQuery = useWorkspacesQuery();
  const workspaces = workspacesQuery.data?.workspaces ?? [];
  const workspace = workspaces.find((w) => w.workspaceKey === workspaceKey);
  const modules = workspace?.modules ?? [];
  const module = modules.find((m) => m.moduleKey === moduleKey);
  const roots = module?.roots ?? [];

  const treeRequest =
    moduleKey && rootKey
      ? {
          moduleKey,
          rootKey,
          subDirectory: "",
          recursive: true,
          includeFragments: false,
          includeSchemas: false,
        }
      : undefined;
  const treeQuery = useTreeQuery(treeRequest, { enabled: Boolean(treeRequest) });
  const files = useMemo(
    () => (treeQuery.data?.files ?? []).filter(isAuthoringFile),
    [treeQuery.data?.files],
  );

  /* ── THE GENERATED FORM (restored 2026-08-17, forensics in PRODUCT.md) — the module's
     schema (settings.schema, Revit-tuned x-options intact) drives a SchemaToFieldRender
     form over the open document. Form edits are staged as pointer-keyed field values and
     ride the SAME substrate save as pea's approved proposals — one write path, chat lane
     stays sighted. No schema for the module → the flat pointer reviewer below is the
     honest fallback. ── */
  // The OPEN DOCUMENT names its own module/root — pea can open a document the pickers
  // never touched, and the form must still generate. Pickers only seed the next open.
  const schemaRequest = snapshot
    ? { moduleKey: snapshot.documentId.moduleKey, rootKey: snapshot.documentId.rootKey }
    : moduleKey && rootKey
      ? { moduleKey, rootKey }
      : undefined;
  const schemaQuery = useSchemaQuery(schemaRequest, { enabled: Boolean(schemaRequest) });
  const schemaJson = schemaQuery.data?.schemaJson ?? undefined;
  const renderSchema = useMemo(
    () => (schemaJson ? parseSchema(schemaJson) : undefined),
    [schemaJson],
  );
  const parsedRaw = useMemo(() => safeParse(snapshot?.rawContent), [snapshot?.rawContent]);

  const formBaseline = useMemo(() => {
    if (!renderSchema || !parsedRaw) return undefined;
    const withDefaults = applySchemaDefaultsToValue(renderSchema, parsedRaw, renderSchema);
    return withDefaults && typeof withDefaults === "object" && !Array.isArray(withDefaults)
      ? (withDefaults as Record<string, unknown>)
      : undefined;
  }, [renderSchema, parsedRaw]);

  const form = useForm({ defaultValues: formBaseline ?? {} });
  const formValues = useStore(form.store, (state) => state.values);
  // A fresh snapshot or schema resets the form to the file's truth (open, re-read, save).
  const formResetToken = `${snapshot?.documentId.relativePath ?? ""}:${snapshot?.versionToken ?? ""}:${schemaJson ?? ""}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset exactly when the token moves
  useEffect(() => form.reset(formBaseline ?? {}), [formResetToken]);

  const formMode = Boolean(snapshot && renderSchema && formBaseline);
  const formDirty = formMode && JSON.stringify(formValues) !== JSON.stringify(formBaseline ?? {});

  const rows = useMemo(() => (document ? buildFieldRows(document) : []), [document]);
  const stagedCount = rows.filter((row) => row.field?.staged != null).length;
  const attentionCount = rows.filter((row) => row.field?.review === "attention").length;
  const proposalCount = rows.filter(
    (row) => row.field?.proposal && row.field.staged == null,
  ).length;
  const proposalRows = rows.filter((row) => row.field?.proposal && row.field.staged == null);
  const canSave = formMode
    ? (formDirty || stagedCount > 0) && attentionCount === 0
    : stagedCount > 0 && attentionCount === 0;

  /** One in-flight command at a time; op-level failures surface on the outcome lane. */
  const runCommand = (label: string, name: string, input?: unknown, receipt?: string) =>
    void verb.run(label, async () => {
      const result = await route.command(name, input);
      if (!result.ok) throw new Error(result.error ?? result.hint ?? `${name} failed.`);
      return receipt;
    });

  /** Form-mode save: strip schema defaults back off the values (only authored content is
   * written), diff leaf pointers against the file's parse, stage every change, then run
   * the substrate save — which splices ALL staged fields (form edits AND approved
   * proposals) with the captured version token. */
  const saveForm = () =>
    void verb.run("save", async () => {
      if (!renderSchema || !parsedRaw) throw new Error("No schema or document to save against.");
      const authored = removeSchemaDefaultsFromValue(renderSchema, formValues, renderSchema);
      const authoredRecord =
        authored && typeof authored === "object" && !Array.isArray(authored)
          ? (authored as Record<string, unknown>)
          : {};
      const patches = diffLeafPatches(parsedRaw, authoredRecord);
      if (patches.length > 0) {
        const applied = await route.apply(patches);
        if (!applied.ok)
          throw new Error(applied.error ?? applied.hint ?? "Staging form edits failed.");
      }
      const result = await route.command("save", undefined);
      if (!result.ok) throw new Error(result.error ?? result.hint ?? "save failed.");
      const total = patches.length + stagedCount;
      return `saved ${total} field${total === 1 ? "" : "s"}`;
    });

  const applyPatches = async (patches: { path: (string | number)[]; value?: unknown }[]) => {
    verb.fail("error", null);
    const result = await route.apply(patches);
    if (!result.ok) verb.fail("error", result.error ?? result.hint ?? "Update failed.");
  };

  const openFile = (relativePath?: string) => {
    setFilePath(relativePath);
    if (moduleKey && rootKey && relativePath)
      runCommand("open", "open", { documentId: { moduleKey, rootKey, relativePath } });
  };

  const validation = snapshot?.validation;
  const saveReason =
    attentionCount > 0
      ? `${attentionCount} staged field${attentionCount === 1 ? "" : "s"} need attention before anything is written.`
      : formMode
        ? formDirty || stagedCount > 0
          ? `Write your form edits${stagedCount > 0 ? ` and ${stagedCount} staged value${stagedCount === 1 ? "" : "s"}` : ""} into the settings file on disk — the only verb here that leaves the page.`
          : "Nothing to write — edit the form or approve a proposal first. Save writes into the settings file on disk."
        : stagedCount === 0
          ? "Nothing is staged — approve a proposal or stage a value first. Save writes the staged values into the settings file on disk."
          : `Write ${stagedCount} staged value${stagedCount === 1 ? "" : "s"} into the settings file on disk — the only verb here that leaves the page.`;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--r-page)]">
      {/* ── THE HEAD — a Section-style form head, deliberately NOT the AddressingBar (fit
          reviews, ruled 2026-08-16: the five-slot rule binds TABLE/WORKSPACE routes only; a
          form route addresses through its pickers, so the pickers ARE the sentence). The two
          header rows this route used to pay — an inert mono path in the sentence slot plus a
          second strip of exiled pickers — collapse into this one row. ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--r-line)] px-3 py-1.5">
        <h1 className="t-label t-upper text-[var(--r-ink-2)]">settings</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <Picker
            id="workspace"
            label="workspace"
            value={workspaceKey}
            placeholder="workspace…"
            onChange={(v) => {
              setWorkspaceKey(v);
              setModuleKey(undefined);
              setRootKey(undefined);
              setFilePath(undefined);
            }}
            options={workspaces.map((w) => ({
              value: w.workspaceKey,
              label: w.displayName || w.workspaceKey,
            }))}
          />
          <Picker
            id="module"
            label="module"
            value={moduleKey}
            placeholder="module…"
            disabled={modules.length === 0}
            onChange={(v) => {
              setModuleKey(v);
              const nextModule = modules.find((m) => m.moduleKey === v);
              const defaultRoot =
                nextModule?.roots.find((r) => r.rootKey === nextModule.defaultRootKey) ??
                nextModule?.roots[0];
              setRootKey(defaultRoot?.rootKey);
              setFilePath(undefined);
            }}
            options={modules.map((m) => ({ value: m.moduleKey, label: m.moduleKey }))}
          />
          <Picker
            id="root"
            label="root"
            value={rootKey}
            placeholder="root…"
            disabled={roots.length === 0}
            onChange={(v) => {
              setRootKey(v);
              setFilePath(undefined);
            }}
            options={roots.map((r) => ({ value: r.rootKey, label: r.displayName || r.rootKey }))}
          />
          <Picker
            id="file"
            label="authoring file"
            value={filePath}
            placeholder="file…"
            disabled={files.length === 0}
            onChange={openFile}
            options={files.map((f) => ({ value: f.relativePath, label: f.relativePath }))}
          />
          {snapshot?.versionToken ? (
            <FactChip title="The snapshot's version token — bumped every time the document is re-read or saved.">
              v{snapshot.versionToken}
            </FactChip>
          ) : null}
        </div>
        <FactChip
          tone={route.connected ? "meta" : "caution"}
          title={
            route.connected
              ? "The route-state bridge is connected — pea's proposals arrive live over SSE."
              : "The route-state bridge is not connected. Nothing arrives and nothing can be sent; a busy bridge is not the model disagreeing."
          }
        >
          bridge {route.connected ? "connected" : "disconnected"}
        </FactChip>
        <FactChip
          title={
            document?.binding?.target
              ? `This document is bound to ${document.binding.target}. Cycling targets is not offered here.`
              : "No target is bound to this document yet."
          }
        >
          {document?.binding?.target ?? "unbound"}
        </FactChip>
        {snapshot ? (
          <>
            <FactChip
              tone={proposalCount > 0 ? "pea" : "meta"}
              title="Open pea proposals awaiting your review — approving stages the value."
            >
              {proposalCount} proposed
            </FactChip>
            <FactChip
              tone={stagedCount > 0 ? "caution" : "meta"}
              title="Values staged for the next save."
            >
              {stagedCount} staged
            </FactChip>
            {attentionCount > 0 ? (
              <FactChip
                tone="caution"
                title="Fields whose review flag is 'attention' — save refuses while any remain."
              >
                {attentionCount} need attention
              </FactChip>
            ) : null}
            {validation ? (
              <FactChip
                tone={validation.isValid ? "done" : "caution"}
                title={
                  validation.isValid
                    ? "The last validate run found the saved file schema-valid."
                    : `The last validate run reported ${validation.issues.length} issue(s): ${validation.issues
                        .slice(0, 3)
                        .map((issue) => issue.message)
                        .join(" · ")}`
                }
              >
                {validation.isValid
                  ? "valid"
                  : `${validation.issues.length} validation issue${validation.issues.length === 1 ? "" : "s"}`}
              </FactChip>
            ) : null}
            {document?.savedAt ? (
              <FactChip title="When save last wrote this document to disk.">
                saved {timeAgo(document.savedAt)}
              </FactChip>
            ) : null}
          </>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {route.peaActive ? <OutcomeLine kind="busy" label="pea is working" /> : null}
          <Verb
            tone="commit"
            label={formMode ? "save" : `save ${stagedCount}`}
            busy={verb.busy === "save"}
            disabled={!canSave || verb.busy != null}
            reason={saveReason}
            onClick={() =>
              formMode
                ? saveForm()
                : runCommand(
                    "save",
                    "save",
                    undefined,
                    `saved ${stagedCount} field${stagedCount === 1 ? "" : "s"}`,
                  )
            }
          />
        </span>
      </header>

      {/* ── field grid ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <div className="mx-auto max-w-3xl">
          {/* page-scoped read verbs + the outcome lane — plain content, never enclosed */}
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <Verb
              label="re-read"
              busy={verb.busy === "re-read"}
              disabled={!snapshot || verb.busy != null}
              reason={
                snapshot
                  ? "Read the settings file from disk again — replaces the snapshot; staged values and open proposals stay."
                  : "No document is open — choose one above."
              }
              onClick={() => runCommand("re-read", "refresh")}
            />
            <Verb
              label="validate"
              busy={verb.busy === "validate"}
              disabled={!snapshot || verb.busy != null}
              reason={
                snapshot
                  ? "Dry-run the schema over the saved file (staged values excluded). Advisory — it blocks nothing and writes nothing."
                  : "No document is open — choose one above."
              }
              onClick={() => runCommand("validate", "validate", { includeProposals: false })}
            />
            {verb.busy ? (
              <OutcomeLine kind="busy" label={`${verb.busy} — ${verb.seconds}s`} />
            ) : null}
            {verb.outcome ? (
              <OutcomeLine kind={verb.outcome.kind} label={verb.outcome.text} />
            ) : verb.receipt ? (
              <OutcomeLine kind="receipt" label={verb.receipt.text} />
            ) : null}
            {route.error ? (
              <OutcomeLine kind="error" label="route stream failed" says={route.error} />
            ) : null}
          </div>

          {snapshot && formMode && renderSchema ? (
            <>
              {/* THE GENERATED FORM — schema-shaped, x-options-fed. Edits live in the form
                  until save stages+writes them; pea's open proposals ride the lane below. */}
              <ArtifactFrame>
                <div className="px-4 py-3">
                  <SchemaToFieldRender
                    // tanstack-form's full api is a structural superset of the lib's form contract.
                    form={form as unknown as Parameters<typeof SchemaToFieldRender>[0]["form"]}
                    schema={renderSchema}
                    moduleKey={snapshot.documentId.moduleKey}
                    rootKey={snapshot.documentId.rootKey}
                    baselineValues={formBaseline ?? {}}
                    validationResult={toValidationResult(validation)}
                  />
                </div>
              </ArtifactFrame>
              {proposalRows.length > 0 ? (
                <div className="pt-4">
                  <div className="t-label t-upper pb-1.5 text-[var(--r-ink-2)]">open proposals</div>
                  <ArtifactFrame>
                    <div className="divide-y divide-[var(--r-line)]">
                      {proposalRows.map((row) => (
                        <FieldRow
                          key={row.path}
                          row={row}
                          busy={verb.busy != null}
                          onApprove={(value) =>
                            void applyPatches([
                              { path: ["fields", row.path, "staged"], value: { value } },
                              { path: ["fields", row.path, "review"], value: "good" },
                            ])
                          }
                          onDeny={() =>
                            void applyPatches([
                              { path: ["fields", row.path, "proposal"] },
                              { path: ["fields", row.path, "review"], value: "none" },
                            ])
                          }
                          onUndo={() =>
                            void applyPatches([
                              { path: ["fields", row.path, "staged"] },
                              { path: ["fields", row.path, "review"], value: "none" },
                            ])
                          }
                        />
                      ))}
                    </div>
                  </ArtifactFrame>
                </div>
              ) : null}
            </>
          ) : snapshot ? (
            rows.length > 0 ? (
              <ArtifactFrame>
                <div className="divide-y divide-[var(--r-line)]">
                  {rows.map((row) => (
                    <FieldRow
                      key={row.path}
                      row={row}
                      busy={verb.busy != null}
                      onApprove={(value) =>
                        void applyPatches([
                          { path: ["fields", row.path, "staged"], value: { value } },
                          { path: ["fields", row.path, "review"], value: "good" },
                        ])
                      }
                      onDeny={() =>
                        void applyPatches([
                          { path: ["fields", row.path, "proposal"] },
                          { path: ["fields", row.path, "review"], value: "none" },
                        ])
                      }
                      onUndo={() =>
                        void applyPatches([
                          { path: ["fields", row.path, "staged"] },
                          { path: ["fields", row.path, "review"], value: "none" },
                        ])
                      }
                    />
                  ))}
                </div>
              </ArtifactFrame>
            ) : (
              <EmptyState
                story="scope"
                exit="pea can propose fields into it, or add keys to the JSON file itself and re-read"
              >
                this document has no fields
              </EmptyState>
            )
          ) : (
            <EmptyState
              story="scope"
              exit="choose a workspace, module, root, and authoring file above"
            >
              no document open
            </EmptyState>
          )}
        </div>
      </div>
    </main>
  );
}

/* ── field rows ──────────────────────────────────────────────────────────── */

interface FieldRow {
  path: string;
  current: unknown;
  field?: SettingsFieldState;
}

function buildFieldRows(document: SettingsRouteDocument): FieldRow[] {
  const parsed = safeParse(document.snapshot?.rawContent);
  const leafPaths = parsed ? flattenLeafPaths(parsed) : [];
  const paths = new Set<string>([...leafPaths, ...Object.keys(document.fields)]);
  return [...paths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      path,
      current: parsed ? valueAtPath(parsed, settingsFieldSegments(path)) : undefined,
      field: document.fields[path],
    }));
}

function FieldRow({
  row,
  busy,
  onApprove,
  onDeny,
  onUndo,
}: {
  row: FieldRow;
  busy: boolean;
  onApprove: (value: unknown) => void;
  onDeny: () => void;
  onUndo: () => void;
}) {
  const field = row.field;
  const staged = field?.staged != null;
  const proposal = !staged ? field?.proposal : undefined;
  const attention = field?.review === "attention";
  const shown = staged ? field?.staged?.value : proposal ? proposal.value : row.current;

  // The cell's prose facts, ranked onto the one footline. "needs attention" leads because it
  // blocks save; the prior value and pea's own words follow. NOTE (audit #2): the review
  // "attention" flag has no cell-grammar axis — it rides the note.
  const note =
    [
      attention
        ? "needs attention — review flagged this value; save refuses while it stands"
        : null,
      staged || proposal ? `was ${display(row.current)}` : null,
      proposal?.confidence ? `pea confidence: ${proposal.confidence}` : null,
      proposal?.note ?? null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;

  return (
    <div className="flex min-h-12 items-center gap-3 px-3 py-2">
      {/* THE OWED MARKER (fit reviews, ruled 2026-08-16), hand-carried: this grid is not a
          MasterTable, so the gutter is a fixed slot at the row's left edge — a count in the
          caution ink when a review decision is owed, blank otherwise. Locate-only. */}
      <span
        className="face-mono t-caption w-3 shrink-0 text-center text-[var(--r-caution)]"
        title={
          attention
            ? `${row.path} was flagged for attention — a review decision is owed here; save refuses while it stands`
            : undefined
        }
      >
        {attention ? 1 : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="face-mono t-label truncate text-[var(--r-ink-2)]">{row.path}</div>
        <StateCell
          className="face-mono t-value"
          value={display(shown)}
          stage={staged ? "staged" : proposal ? "proposed" : "clean"}
          stagedBy="you"
          note={note}
        />
      </div>

      {staged ? (
        <Verb
          label="unstage"
          disabled={busy}
          reason="Return this field to its saved value. The proposal it came from is restored to the open list."
          onClick={onUndo}
        />
      ) : proposal ? (
        <span className="flex shrink-0 gap-1.5">
          <Verb
            label="deny"
            disabled={busy}
            reason="Clear pea's proposal for this field — the saved value stands."
            onClick={onDeny}
          />
          <Verb
            label="approve"
            disabled={busy}
            reason={`Approve and stage "${display(proposal.value)}" for the next save.`}
            onClick={() => onApprove(proposal.value)}
          />
        </span>
      ) : null}
    </div>
  );
}

/* ── small pieces ────────────────────────────────────────────────────────── */

function Picker({
  id,
  label,
  value,
  placeholder,
  disabled,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  placeholder: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  // Head-inline: the pickers live ON the head row (the form-route head ruling), so the
  // stacked label died — the trigger carries the label as its accessible name and title.
  // `items` lets Base UI's Value render the LABEL of the sentinel, not the raw "__none".
  return (
    <Select
      items={[{ value: "__none", label: placeholder }, ...options]}
      value={value ?? "__none"}
      onValueChange={(v: string | null) => onChange(v === "__none" || !v ? undefined : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} title={label} className="h-6 max-w-52">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ── generated-form helpers ──────────────────────────────────────────────── */

/** Route-state validation (loose) → the host-contracts shape the field renderer projects.
 * Paths pass through untouched; the renderer's projector owns dotted-vs-pointer forgiveness. */
function toValidationResult(
  validation:
    | {
        isValid: boolean;
        issues: { message: string; severity?: string | null; path?: string | null }[];
      }
    | null
    | undefined,
): SettingsValidationResult | undefined {
  if (!validation) return undefined;
  return {
    isValid: validation.isValid,
    issues: validation.issues.map((issue) => ({
      path: issue.path ?? "$",
      code: "host",
      severity: issue.severity ?? "error",
      message: issue.message,
    })),
  };
}

/** Leaf-pointer diff of the authored form values against the file's parse, as route.apply
 * patches staging each change. Arrays are leaves (this route's flatten rule — round-1
 * finding #2 owns reconciling this with per-index addressing). */
function diffLeafPatches(
  fileParse: Record<string, unknown>,
  authored: Record<string, unknown>,
): { path: (string | number)[]; value?: unknown }[] {
  const pointers = new Set([...flattenLeafPaths(fileParse), ...flattenLeafPaths(authored)]);
  const patches: { path: (string | number)[]; value?: unknown }[] = [];
  for (const pointer of pointers) {
    const segments = settingsFieldSegments(pointer);
    const before = valueAtPath(fileParse, segments);
    const after = valueAtPath(authored, segments);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    patches.push({
      path: ["fields", pointer, "staged"],
      value: after === undefined ? { delete: true } : { value: after },
    });
  }
  return patches;
}

/* ── json helpers ────────────────────────────────────────────────────────── */

function safeParse(rawContent: string | null | undefined): Record<string, unknown> | null {
  if (!rawContent?.trim()) return null;
  try {
    const parsed = JSON.parse(rawContent);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every leaf JSON Pointer. Objects recurse; arrays/primitives are leaves. */
function flattenLeafPaths(value: Record<string, unknown>, prefix: string[] = []): string[] {
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const segments = [...prefix, key];
    if (child != null && typeof child === "object" && !Array.isArray(child)) {
      out.push(...flattenLeafPaths(child as Record<string, unknown>, segments));
    } else {
      out.push(settingsFieldPointer(segments));
    }
  }
  return out;
}

function valueAtPath(root: Record<string, unknown>, segments: string[]): unknown {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function display(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
