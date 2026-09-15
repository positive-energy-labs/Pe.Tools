/**
 * The settings route. One manifest (`settings/manifest.ts`), one shell, one body: the shell draws
 * the head, the door, the chords, the help and the inspector; everything below reads the route
 * handle's Work and Readings. There is no second store and no separate demo lane — `?demo=<action>`
 * mounts a seed through `useRoute` like every other route.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  settingsFieldPointer,
  settingsFieldSegments,
  settingsWorkSnapshot,
  type Reading,
  type RouteStatePatch,
  type SettingsDocumentId,
  type SettingsFieldState,
  type SettingsValidation,
  type WorkKey,
} from "@pe/agent-contracts";
import type { SettingsValidationResult } from "@pe/host-contracts/operation-types";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { StateCell } from "#/components/lang/cell";
import { FactChip, Tag } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { ActionButton } from "#/components/lang/action-button";
import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import { timeAgo } from "#/lib/utils";
import { RouteShell, useRoute, type RouteHandle } from "#/route";
import { schemaFormModel } from "#/settings-panes/schema-form";
import { FileWorkspace, fileSearch } from "#/settings/file-workspace";
import { settingsManifest } from "#/settings/manifest";
import type { SettingsAction, SettingsPage, SettingsReading } from "#/settings/seeds";
import type { SettingsRouteDocument } from "@pe/agent-contracts";

type Handle = RouteHandle<SettingsRouteDocument, SettingsReading, SettingsPage, SettingsAction>;

export const settingsSearch = (
  search: Record<string, unknown>,
): ReturnType<typeof fileSearch> & { thread?: string } => ({
  ...fileSearch(search),
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
});

export const manifest = settingsManifest({ scope: { route: "settings", target: null } });

export const Route = createFileRoute("/settings")({
  validateSearch: settingsSearch,
  component: SettingsRoute,
});

function SettingsRoute() {
  return <SettingsRouteContent {...Route.useSearch()} />;
}

export function SettingsRouteContent(initial: Partial<ReturnType<typeof fileSearch>>) {
  // In the demo lane the SEED is the file. `FileWorkspace` exists to pick one and have the host
  // read it; standing it in front of `?demo=` meant the seeded surface never mounted at all, so
  // the route's own proof could not reach its own actions.
  const demo = new URLSearchParams(globalThis.location?.search ?? "").get("demo");
  if (demo)
    return (
      <SettingsWorkspace
        scope={{ route: "settings", target: null, work: "demo" }}
        selectFile={async () => {}}
      />
    );
  return (
    <FileWorkspace initial={initial}>
      {(scope, selectFile) => <SettingsWorkspace scope={scope} selectFile={selectFile} />}
    </FileWorkspace>
  );
}

/** A file Reading's observation is its raw text. */
function readingText(reading: Reading<unknown> | undefined): string | undefined {
  if (!reading) return undefined;
  if (reading.state === "ready")
    return typeof reading.observation === "string" ? reading.observation : undefined;
  const previous = "previous" in reading ? reading.previous : undefined;
  return typeof previous === "string" ? previous : undefined;
}

function SettingsWorkspace({
  scope,
  selectFile,
}: {
  scope: WorkKey;
  selectFile: (id: SettingsDocumentId) => Promise<void>;
}) {
  const routeManifest = useMemo(() => settingsManifest({ scope, selectFile }), [scope, selectFile]);
  const handle = useRoute(routeManifest);
  const doc = handle.work.doc;
  const snapshot = useMemo(() => (doc ? settingsWorkSnapshot(doc) : null), [doc]);
  const candidate = useMemo(() => (doc ? settingsWorkSnapshot(doc, true) : null), [doc]);
  const fields: Record<string, SettingsFieldState> = doc?.fields ?? {};
  const validation = candidate?.validation ?? null;
  const values = useMemo(() => formObject(candidate?.rawContent ?? "{}"), [candidate?.rawContent]);
  const schemaJson = readingText(handle.readings.schema);
  const busy = handle.busy != null;
  const proposals = Object.values(fields).filter((field) => field.proposal != null);
  const formDirty = Object.values(fields).some((field) => field.staged != null);
  const rows = useMemo(
    () => (snapshot ? buildFieldRows(snapshot.rawContent, fields) : []),
    [fields, snapshot],
  );
  const formModel = useMemo(
    () => schemaFormModel(snapshot?.rawContent ?? "", schemaJson),
    [schemaJson, snapshot?.rawContent],
  );
  const stagedCount = Object.values(fields).filter((field) => field.staged != null).length;
  const proposalRows = rows.filter((row) => row.field?.proposal && row.field.staged == null);
  const aside = (
    <>
      <FactChip
        tone={handle.work.revision === null ? "caution" : "meta"}
        title="Route-state transport status."
      >
        {handle.work.revision === null ? "work disconnected" : "work connected"}
      </FactChip>
      <FactChip title="Open Pea proposals." tone={proposals.length ? "pea" : "meta"}>
        {proposals.length} proposed
      </FactChip>
      <FactChip title="Fields staged for save." tone={formDirty ? "caution" : "meta"}>
        {stagedCount} staged
      </FactChip>
      {validation ? (
        <FactChip
          title="Authored JSON syntax; run validate for host diagnostics."
          tone={validation.isValid ? "done" : "caution"}
        >
          {validation.isValid ? "JSON parses" : `${validation.issues.length} invalid`}
        </FactChip>
      ) : null}
    </>
  );

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden" data-surface="page">
      <RouteShell manifest={routeManifest} aside={aside} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5">
        <div className="mx-auto max-w-5xl space-y-1.5">
          {handle.failure ? (
            <OutcomeLine
              kind="error"
              label={`settings ${handle.failure.code}`}
              says={handle.failure.message}
            />
          ) : null}

          {snapshot && (
            <details open={!validation?.isValid}>
              <summary>Authored basis / candidate JSON</summary>
              <RawEditor content={candidate?.rawContent ?? snapshot.rawContent} handle={handle} />
              {validation?.issues.map((issue, index) => (
                <OutcomeLine
                  key={index}
                  kind="error"
                  label={issue.path ?? "$"}
                  says={issue.message}
                />
              ))}
            </details>
          )}
          {snapshot && formModel ? (
            <>
              <ArtifactFrame
                head={
                  <>
                    <Tag>schema ledger</Tag>
                    <span className="t-small t-upper min-w-0 flex-1 truncate text-ink">
                      {snapshot.documentId.relativePath}
                    </span>
                    {snapshot.versionToken ? (
                      <FactChip title="The open document version token.">
                        v{snapshot.versionToken}
                      </FactChip>
                    ) : null}
                    {snapshot.modifiedUtc ? (
                      <FactChip title="The open file's modification time.">
                        read {timeAgo(snapshot.modifiedUtc)}
                      </FactChip>
                    ) : null}
                  </>
                }
              >
                <div className="px-3 py-1.5">
                  <SchemaToFieldRender
                    schema={formModel.schema}
                    moduleKey={snapshot.documentId.moduleKey}
                    rootKey={snapshot.documentId.rootKey}
                    baselineValues={formModel.baseline}
                    values={values}
                    onChange={(path, value) =>
                      void stage(handle, settingsFieldPointer(path.split(".")), value)
                    }
                    validationResult={toValidationResult(validation)}
                  />
                </div>
              </ArtifactFrame>
              {proposalRows.length ? (
                <ArtifactFrame
                  head={
                    <>
                      <Tag>pea proposals</Tag>
                      <FactChip tone="pea" title="Open field proposals in this document.">
                        {proposalRows.length} open
                      </FactChip>
                    </>
                  }
                >
                  <div className="hairline-rows">
                    {proposalRows.map((row) => (
                      <FieldRow key={row.path} row={row} busy={busy} handle={handle} />
                    ))}
                  </div>
                </ArtifactFrame>
              ) : null}
            </>
          ) : snapshot && rows.length ? (
            <ArtifactFrame
              head={
                <>
                  <Tag>field readout</Tag>
                  <span className="t-small t-upper min-w-0 flex-1 truncate text-ink">
                    {snapshot.documentId.relativePath}
                  </span>
                </>
              }
            >
              <div className="hairline-rows">
                {rows.map((row) => (
                  <FieldRow key={row.path} row={row} busy={busy} handle={handle} />
                ))}
              </div>
            </ArtifactFrame>
          ) : (
            <EmptyState story="scope" exit="bind the settings address and run open">
              {snapshot
                ? "Structured fields are unavailable; raw JSON is preserved above."
                : "no settings document is open"}
            </EmptyState>
          )}
        </div>
      </div>
    </main>
  );
}

function formObject(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw.replace(/^﻿/, ""));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const stage = (handle: Handle, path: string, value: unknown) =>
  handle.actions.stage.run({ path, value });

const patchField = (handle: Handle, patches: RouteStatePatch[]) => void handle.work.write(patches);

interface FieldRowModel {
  path: string;
  current: unknown;
  field?: SettingsFieldState;
}

function buildFieldRows(
  rawContent: string,
  fields: Record<string, SettingsFieldState>,
): FieldRowModel[] {
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(rawContent);
    if (value && typeof value === "object" && !Array.isArray(value))
      parsed = value as Record<string, unknown>;
  } catch {
    // The route stream owns the parse error; staged fields remain reviewable.
  }
  const paths = new Set([...flattenLeafPaths(parsed), ...Object.keys(fields)]);
  return [...paths].sort().map((path) => ({
    path,
    current: valueAtPath(parsed, settingsFieldSegments(path)),
    field: fields[path],
  }));
}

function FieldRow({ row, busy, handle }: { row: FieldRowModel; busy: boolean; handle: Handle }) {
  const staged = row.field?.staged != null;
  const proposal = staged ? null : row.field?.proposal;
  const shown = staged ? row.field?.staged?.value : proposal ? proposal.value : row.current;
  return (
    <div className="grid min-h-9 grid-cols-[minmax(15rem,0.75fr)_minmax(0,1.25fr)_auto] items-center gap-2 px-3 py-0.5">
      <div className="t-small t-upper min-w-0 break-words text-ink-2">{row.path}</div>
      <StateCell
        scale="row"
        value={display(shown)}
        stage={staged ? "staged" : proposal ? "proposed" : "clean"}
        stagedBy="you"
        cap={busy ? "locked" : "editable"}
        capReason={busy ? "A settings action is running." : undefined}
        onCommit={(value) => void stage(handle, row.path, parseLike(shown, value))}
        note={proposal?.note ?? undefined}
      />
      {staged ? (
        <ActionButton
          label="unstage"
          disabled={busy}
          reason="Return this field to its saved value."
          onClick={() => patchField(handle, [{ path: ["fields", row.path, "staged"] }])}
        />
      ) : proposal ? (
        <span className="flex shrink-0 gap-1.5">
          <ActionButton
            label="deny"
            disabled={busy}
            reason="Clear Pea's proposal."
            onClick={() => patchField(handle, [{ path: ["fields", row.path, "proposal"] }])}
          />
          <ActionButton
            label="approve"
            disabled={busy}
            reason="Stage Pea's proposed value."
            onClick={() =>
              patchField(handle, [
                { path: ["fields", row.path, "staged"], value: { value: proposal.value } },
              ])
            }
          />
        </span>
      ) : null}
    </div>
  );
}

function toValidationResult(
  validation: SettingsValidation | null | undefined,
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

function flattenLeafPaths(value: Record<string, unknown>, prefix: string[] = []): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const segments = [...prefix, key];
    return child != null && typeof child === "object" && !Array.isArray(child)
      ? flattenLeafPaths(child as Record<string, unknown>, segments)
      : [settingsFieldPointer(segments)];
  });
}

function valueAtPath(root: Record<string, unknown>, segments: string[]): unknown {
  return segments.reduce<unknown>(
    (value, segment) =>
      value != null && typeof value === "object"
        ? (value as Record<string, unknown>)[segment]
        : undefined,
    root,
  );
}

function display(value: unknown): string {
  if (value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseLike(before: unknown, value: string): unknown {
  if (typeof before === "number") return Number(value);
  if (typeof before === "boolean") return value.toLowerCase() === "true";
  if (before != null && typeof before === "object") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function RawEditor({ content, handle }: { content: string; handle: Handle }) {
  const [buffer, setBuffer] = useState(content);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setBuffer(content);
  }, [content, focused]);
  return (
    <textarea
      aria-label="Authored raw JSON"
      className="min-h-48 w-full"
      value={buffer}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        const value = event.target.value;
        setBuffer(value);
        void stage(handle, "", value);
      }}
    />
  );
}
