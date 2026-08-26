import { useCallback, useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  settingsFieldPointer,
  settingsFieldSegments,
  type RouteStatePatch,
  type SettingsFieldState,
  type SettingsValidation,
} from "@pe/agent-contracts";
import type { SettingsValidationResult } from "@pe/host-contracts/operation-types";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { StateCell } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import { timeAgo } from "#/lib/utils";
import { createFixtureSettingsHost } from "#/settings-panes/fixture-route";
import { schemaFormModel } from "#/settings-panes/schema-form";
import { SETTINGS_PRODUCT } from "#/settings/product";
import { createLiveSettingsHost } from "#/settings/host";
import { createSettingsStore, type SettingsStore } from "#/settings/store";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingState } from "#/targeting/kit";
import { withThread } from "./-with-thread";

export const Route = createFileRoute("/settings")({
  beforeLoad: withThread,
  validateSearch: (search: Record<string, unknown>): { thread?: string; source?: "fixture" } => ({
    thread:
      typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
    source: search.source === "fixture" ? "fixture" : undefined,
  }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const search = Route.useSearch();
  if (!search.thread) return null;
  return (
    <SettingsStoreOwner
      key={`${search.thread}:${search.source ?? "read"}`}
      thread={search.thread}
      source={search.source}
    />
  );
}

function SettingsStoreOwner({ thread, source }: { thread: string; source?: "fixture" }) {
  const store = useRouteStore(() => {
    const scope = { threadId: thread };
    const host =
      source === "fixture" ? createFixtureSettingsHost(appAtomRegistry) : createLiveSettingsHost();
    return createSettingsStore({
      registry: appAtomRegistry,
      scope,
      host,
      search: { source },
    });
  });
  return <SettingsWorkspace store={store} />;
}

function SettingsWorkspace({ store }: { store: SettingsStore }) {
  const navigate = useNavigate({ from: "/settings" });
  const snapshot = useAtomValue(store.atoms.snapshot);
  const fields = useAtomValue(store.atoms.fields);
  const validation = useAtomValue(store.atoms.validation);
  const proposals = useAtomValue(store.atoms.proposals);
  const formDirty = useAtomValue(store.atoms.formDirty);
  const values = useAtomValue(store.atoms.formValues);
  const schemaJson = useAtomValue(store.atoms.schemaJson);
  const connected = useAtomValue(store.atoms.connected);
  const peaActive = useAtomValue(store.atoms.peaActive);
  const sliceError = useAtomValue(store.atoms.sliceError);
  const failure = useAtomValue(store.atoms.failure);
  const busy = useAtomValue(store.atoms.busy);
  const rows = useMemo(
    () => (snapshot ? buildFieldRows(snapshot.rawContent, fields) : []),
    [fields, snapshot],
  );
  const formModel = useMemo(
    () => schemaFormModel(snapshot?.rawContent ?? "", schemaJson),
    [schemaJson, snapshot?.rawContent],
  );
  const stagedCount = Object.values(fields).filter((field) => field.staged != null).length;
  const attentionCount = Object.values(fields).filter(
    (field) => field.review === "attention" && field.staged != null,
  ).length;
  const proposalRows = rows.filter((row) => row.field?.proposal && row.field.staged == null);
  const fixture = store.search.source === "fixture";
  const setSource = (source: "fixture" | undefined) =>
    void navigate({
      search: (previous) => ({ ...previous, source }),
      replace: true,
    });
  const aside = (
    <>
      <FactChip
        dashed={fixture}
        tone={fixture ? "caution" : connected === false ? "caution" : "meta"}
        title={
          fixture
            ? "The explicit fixture capability runs in memory."
            : "Route-state transport status."
        }
      >
        {fixture
          ? "fixture lane"
          : connected === null
            ? "bridge unknown"
            : connected
              ? "bridge connected"
              : "bridge disconnected"}
      </FactChip>
      <FactChip title="Open Pea proposals." tone={proposals.length ? "pea" : "meta"}>
        {proposals.length} proposed
      </FactChip>
      <FactChip title="Fields staged for save." tone={formDirty ? "caution" : "meta"}>
        {stagedCount} staged
      </FactChip>
      {validation ? (
        <FactChip
          title="The last settings validation result."
          tone={validation.isValid ? "done" : "caution"}
        >
          {validation.isValid ? "valid" : `${validation.issues.length} invalid`}
        </FactChip>
      ) : null}
      <Verb
        label={fixture ? "leave fixture" : "open fixture"}
        reason={
          fixture
            ? "Return to the host-backed lane."
            : "Use the declared in-memory settings capability."
        }
        onClick={() => setSource(fixture ? undefined : "fixture")}
      />
    </>
  );
  const picker = useAtomValue(store.atoms.picker);
  const targeting = useAtomValue(store.atoms.targeting);
  const binding = useAtomValue(store.atoms.binding);
  const receipt = useAtomValue(store.atoms.receipt);
  const feeds = {
    workspace: useAtomValue(store.feeds.workspace),
    module: useAtomValue(store.feeds.module),
    root: useAtomValue(store.feeds.root),
    file: useAtomValue(store.feeds.file),
  };
  const product = SETTINGS_PRODUCT({
    open: store.actions.open,
    refresh: store.actions.refresh,
    validate: store.actions.validate,
    save: store.actions.save,
  });
  const state: BindingState = {
    bound: {
      workspace: picker.workspaceKey ?? null,
      module: picker.moduleKey ?? null,
      root: picker.rootKey ?? null,
      file: picker.filePath ?? null,
    },
    multi: {},
    stage: "document",
  };
  const setState = useCallback(
    (patch: Partial<BindingState>) => {
      if (!patch.bound) return;
      store.actions.setPicker({
        workspaceKey: patch.bound.workspace ?? undefined,
        moduleKey: patch.bound.module ?? undefined,
        rootKey: patch.bound.root ?? undefined,
        filePath: patch.bound.file ?? undefined,
      });
      const file = patch.bound.file ?? null;
      if (file !== (binding.target ?? null)) void store.actions.bind(file).catch(() => undefined);
    },
    [binding.target, store],
  );
  const bindings = useBindings(
    product,
    feeds,
    state,
    setState,
    targeting.open,
    (open) => store.actions.setTargeting((previous) => ({ ...previous, open })),
    targeting.level,
    (level) => store.actions.setTargeting((previous) => ({ ...previous, level })),
    targeting.query,
    (query) => store.actions.setTargeting((previous) => ({ ...previous, query })),
  );
  const runner = useRunner(product, bindings, busy?.id ?? null);

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--r-page)]">
      <TargetingHead
        product={product}
        b={bindings}
        runner={runner}
        receipt={receipt ? <OutcomeLine kind="receipt" label={receipt.text} /> : undefined}
        aside={aside}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <div className="mx-auto max-w-3xl space-y-3">
          {peaActive ? <OutcomeLine kind="busy" label="pea is working" /> : null}
          {busy ? <OutcomeLine kind="busy" label={`${busy.id} · ${busy.seconds}s`} /> : null}
          {failure ? <OutcomeLine kind="error" label={failure.message} /> : null}
          {sliceError ? (
            <OutcomeLine kind="error" label="route stream failed" says={sliceError} />
          ) : null}
          {snapshot?.from.documentVersionToken ? (
            <FactChip title="The open document version token.">
              v{snapshot.from.documentVersionToken}
            </FactChip>
          ) : null}
          {snapshot?.modifiedUtc ? (
            <FactChip title="The open file's modification time.">
              read {timeAgo(snapshot.modifiedUtc)}
            </FactChip>
          ) : null}

          {snapshot && formModel ? (
            <>
              <ArtifactFrame>
                <div className="px-4 py-3">
                  <SchemaToFieldRender
                    schema={formModel.schema}
                    moduleKey={snapshot.from.settingsDocumentId.moduleKey}
                    rootKey={snapshot.from.settingsDocumentId.rootKey}
                    baselineValues={formModel.baseline}
                    values={values}
                    onChange={(path, value) =>
                      void store.actions
                        .stage(settingsFieldPointer(path.split(".")), value)
                        .catch(() => undefined)
                    }
                    validationResult={toValidationResult(validation)}
                  />
                </div>
              </ArtifactFrame>
              {proposalRows.length ? (
                <ArtifactFrame>
                  <div className="divide-y divide-[var(--r-line)]">
                    {proposalRows.map((row) => (
                      <FieldRow key={row.path} row={row} busy={busy != null} store={store} />
                    ))}
                  </div>
                </ArtifactFrame>
              ) : null}
            </>
          ) : snapshot && rows.length ? (
            <ArtifactFrame>
              <div className="divide-y divide-[var(--r-line)]">
                {rows.map((row) => (
                  <FieldRow key={row.path} row={row} busy={busy != null} store={store} />
                ))}
              </div>
            </ArtifactFrame>
          ) : (
            <EmptyState story="scope" exit="bind the settings address and run open">
              no settings document is open
            </EmptyState>
          )}

          {attentionCount > 0 ? (
            <OutcomeLine
              kind="error"
              label={`${attentionCount} staged field${attentionCount === 1 ? "" : "s"} need attention before save`}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

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

function FieldRow({
  row,
  busy,
  store,
}: {
  row: FieldRowModel;
  busy: boolean;
  store: SettingsStore;
}) {
  const staged = row.field?.staged != null;
  const proposal = staged ? null : row.field?.proposal;
  const shown = staged ? row.field?.staged?.value : proposal ? proposal.value : row.current;
  return (
    <div className="flex min-h-12 items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="face-mono t-label truncate text-[var(--r-ink-2)]">{row.path}</div>
        <StateCell
          scale="row"
          className="face-mono t-value"
          value={display(shown)}
          stage={staged ? "staged" : proposal ? "proposed" : "clean"}
          stagedBy="you"
          cap={busy ? "readonly" : "editable"}
          capReason={busy ? "A settings verb is running." : undefined}
          onCommit={(value) =>
            void store.actions.stage(row.path, parseLike(shown, value)).catch(() => undefined)
          }
          note={
            row.field?.review === "attention" ? "needs attention" : (proposal?.note ?? undefined)
          }
        />
      </div>
      {staged ? (
        <Verb
          label="unstage"
          disabled={busy}
          reason="Return this field to its saved value."
          onClick={() => patchField(store, [{ path: ["fields", row.path, "staged"] }])}
        />
      ) : proposal ? (
        <span className="flex shrink-0 gap-1.5">
          <Verb
            label="deny"
            disabled={busy}
            reason="Clear Pea's proposal."
            onClick={() =>
              patchField(store, [
                { path: ["fields", row.path, "proposal"] },
                { path: ["fields", row.path, "review"], value: "none" },
              ])
            }
          />
          <Verb
            label="approve"
            disabled={busy}
            reason="Stage Pea's proposed value."
            onClick={() =>
              patchField(store, [
                { path: ["fields", row.path, "staged"], value: { value: proposal.value } },
                { path: ["fields", row.path, "review"], value: "good" },
              ])
            }
          />
        </span>
      ) : null}
    </div>
  );
}

function patchField(store: SettingsStore, patches: RouteStatePatch[]) {
  void store.actions.apply(patches).catch(() => undefined);
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
