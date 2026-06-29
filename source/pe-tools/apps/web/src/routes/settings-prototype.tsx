import { useForm, useStore } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, type ReactNode } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import {
  useHostProbeQuery,
  useSchemaQuery,
  useSessionSummaryQuery,
  useTreeQuery,
  useWorkspacesQuery,
} from "#/host/queries";
import {
  type SettingsFileEntry,
  SettingsFileKind,
  type SettingsValidationResult,
} from "#/host/settings-contracts";
import { settingsStore, useSettingsSnapshot } from "#/host/settings-store";
import { validateSettingsDocument } from "@pe/host-client/settings-validation";
import { HostConnectionPill, HostIssuePanel } from "#/host/issues";
import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import {
  type RenderSchemaNode,
  applySchemaDefaultsToValue,
  parseSchema,
  removeSchemaDefaultsFromValue,
} from "@pe/schema-core";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/settings-prototype")({
  component: SettingsPrototypeRoute,
});

function areJsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function asSettingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isAuthoringFile(entry: SettingsFileEntry) {
  return (
    entry.kind !== SettingsFileKind.Fragment &&
    entry.kind !== SettingsFileKind.Schema &&
    !entry.isFragment &&
    !entry.isSchema &&
    entry.relativePath.toLowerCase().endsWith(".json")
  );
}

function asyncTone(status: string) {
  return status === "success" || status === "ready"
    ? "success"
    : status === "pending" || status === "loading"
      ? "warning"
      : status === "error"
        ? "danger"
        : "neutral";
}

const STATUS_TONE = {
  neutral: "outline",
  success: "green",
  warning: "clay",
  danger: "destructive",
} as const;

function StatusChip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: keyof typeof STATUS_TONE;
}) {
  return (
    <Badge variant={STATUS_TONE[tone]} className="rounded-full px-2 py-1 uppercase tracking-wide">
      {label}
    </Badge>
  );
}

function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <CardAction>{actions}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function LabeledSelect({
  id,
  label,
  value,
  placeholder,
  disabled,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string | undefined;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string | undefined) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? "__none"}
        onValueChange={(v: string | null) => onChange(v === "__none" || !v ? undefined : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{placeholder}</SelectItem>
          {children}
        </SelectContent>
      </Select>
    </div>
  );
}

function SettingsForm({
  schema,
  schemaJson,
  moduleKey,
  rootKey,
  initialValues,
  validationResult,
  isSaving,
  onSave,
}: {
  schema: RenderSchemaNode;
  schemaJson?: string;
  moduleKey: string;
  rootKey?: string;
  initialValues: Record<string, unknown>;
  validationResult?: SettingsValidationResult;
  isSaving: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      const authoredValue = removeSchemaDefaultsFromValue(schema, value, schema);
      await onSave(asSettingsRecord(authoredValue));
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const isDirty = !areJsonEqual(initialValues, values);

  // Instant client-side validation against the same JSON Schema the host uses,
  // merged with the (round-trip) server result so field errors show as you type.
  const mergedValidation = useMemo<SettingsValidationResult | undefined>(() => {
    if (!schemaJson) return validationResult;
    const client = validateSettingsDocument(schemaJson, values);
    const issues = [...(validationResult?.issues ?? []), ...client.issues];
    return { isValid: (validationResult?.isValid ?? true) && client.isValid, issues };
  }, [schemaJson, values, validationResult]);

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <SchemaToFieldRender
        // tanstack-form's full api is a structural superset of the lib's SettingsForm.
        form={form as unknown as Parameters<typeof SchemaToFieldRender>[0]["form"]}
        schema={schema}
        moduleKey={moduleKey}
        rootKey={rootKey}
        baselineValues={initialValues}
        validationResult={mergedValidation}
      />

      <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
        <Button type="submit" disabled={!isDirty || isSubmitting || isSaving}>
          {isSaving ? "Saving…" : "Save authoring file"}
        </Button>
        {!isDirty ? (
          <p className="self-center text-sm text-muted-foreground">No unsaved authoring changes.</p>
        ) : null}
      </div>
    </form>
  );
}

function SettingsPrototypeRoute() {
  const snapshot = useSettingsSnapshot();
  const { selection, document, validation, save } = snapshot;

  const probeQuery = useHostProbeQuery();
  const sessionQuery = useSessionSummaryQuery();
  const bridgeConnected = probeQuery.data?.bridgeIsConnected ?? false;
  const activeDocumentTitle = sessionQuery.data?.activeDocument?.title;

  const workspacesQuery = useWorkspacesQuery();
  const workspaces = workspacesQuery.data?.workspaces ?? [];

  useEffect(() => {
    settingsStore.ensureWorkspaceSelection(workspaces);
  }, [workspaces]);

  const selectedWorkspace = workspaces.find((w) => w.workspaceKey === selection.workspaceKey);
  const modules = selectedWorkspace?.modules ?? [];
  const selectedModule = modules.find((m) => m.moduleKey === selection.moduleKey);
  const roots = selectedModule?.roots ?? [];

  const treeRequest = useMemo(
    () =>
      selection.moduleKey && selection.rootKey
        ? {
            moduleKey: selection.moduleKey,
            rootKey: selection.rootKey,
            subDirectory: "",
            recursive: true,
            includeFragments: false,
            includeSchemas: false,
          }
        : undefined,
    [selection.moduleKey, selection.rootKey],
  );
  const treeQuery = useTreeQuery(treeRequest, { enabled: Boolean(treeRequest) });
  const candidateFiles = useMemo(
    () => (treeQuery.data?.files ?? []).filter(isAuthoringFile),
    [treeQuery.data?.files],
  );

  const schemaRequest = useMemo(
    () =>
      selection.moduleKey && selection.rootKey
        ? { moduleKey: selection.moduleKey, rootKey: selection.rootKey }
        : undefined,
    [selection.moduleKey, selection.rootKey],
  );
  const schemaQuery = useSchemaQuery(schemaRequest, { enabled: Boolean(schemaRequest) });
  const renderSchema = useMemo(
    () => (schemaQuery.data?.schemaJson ? parseSchema(schemaQuery.data.schemaJson) : undefined),
    [schemaQuery.data?.schemaJson],
  );

  const formBaseline = useMemo(() => {
    if (!renderSchema || snapshot.parsedRaw === undefined) return {} as Record<string, unknown>;
    const withDefaults = applySchemaDefaultsToValue(renderSchema, snapshot.parsedRaw, renderSchema);
    if (!withDefaults || typeof withDefaults !== "object" || Array.isArray(withDefaults)) {
      return {} as Record<string, unknown>;
    }
    return withDefaults as Record<string, unknown>;
  }, [renderSchema, snapshot.parsedRaw]);
  const formResetToken = `${selection.selectedFilePath ?? ""}:${document.baselineRawContent}:${schemaQuery.data?.schemaJson ?? ""}`;

  return (
    <main className="page-wrap space-y-6 px-4 py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Prototype Route
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Host settings pipeline
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Pick a workspace, module, root, and authoring file. The schema drives the form; validate
            and save run through the host over HTTP.
          </p>
        </div>
        <HostConnectionPill connected={bridgeConnected} label={activeDocumentTitle ?? undefined} />
      </header>

      <SectionCard
        title="Selection"
        description="Workspace → module → root → authoring file."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void workspacesQuery.refetch();
              if (treeRequest) void treeQuery.refetch();
            }}
          >
            Refresh host
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <LabeledSelect
            id="workspace"
            label="Workspace"
            value={selection.workspaceKey}
            placeholder="Choose a workspace"
            onChange={(v) =>
              settingsStore.selectWorkspace(workspaces.find((w) => w.workspaceKey === v))
            }
          >
            {workspaces.map((w) => (
              <SelectItem key={w.workspaceKey} value={w.workspaceKey}>
                {w.displayName || w.workspaceKey}
              </SelectItem>
            ))}
          </LabeledSelect>

          <LabeledSelect
            id="module"
            label="Module"
            value={selection.moduleKey}
            placeholder="Choose a module"
            disabled={modules.length === 0}
            onChange={(v) => settingsStore.selectModule(modules.find((m) => m.moduleKey === v))}
          >
            {modules.map((m) => (
              <SelectItem key={m.moduleKey} value={m.moduleKey}>
                {m.moduleKey}
              </SelectItem>
            ))}
          </LabeledSelect>

          <LabeledSelect
            id="root"
            label="Root"
            value={selection.rootKey}
            placeholder="Choose a root"
            disabled={roots.length === 0}
            onChange={(v) => settingsStore.selectRoot(roots.find((r) => r.rootKey === v))}
          >
            {roots.map((r) => (
              <SelectItem key={r.rootKey} value={r.rootKey}>
                {r.displayName || r.rootKey}
              </SelectItem>
            ))}
          </LabeledSelect>

          <LabeledSelect
            id="settings-file"
            label="Authoring file"
            value={selection.selectedFilePath}
            placeholder="Choose a JSON file"
            disabled={candidateFiles.length === 0}
            onChange={(v) => settingsStore.selectFile(v)}
          >
            {candidateFiles.map((entry) => (
              <SelectItem key={entry.path || entry.relativePath} value={entry.relativePath}>
                {entry.relativePath}
              </SelectItem>
            ))}
          </LabeledSelect>
        </div>
      </SectionCard>

      <SectionCard
        title="Schema, validation, and save"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void schemaQuery.refetch()}
              disabled={!schemaRequest}
            >
              Refresh schema
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void settingsStore.refreshCurrentDocument()}
              disabled={!selection.selectedFilePath}
            >
              Refresh document
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <StatusChip label={`schema ${schemaQuery.status}`} tone={asyncTone(schemaQuery.status)} />
          <StatusChip label={`document ${document.status}`} tone={asyncTone(document.status)} />
          <StatusChip
            label={`parse ${snapshot.rawParseStatus}`}
            tone={asyncTone(snapshot.rawParseStatus === "parsed" ? "success" : "error")}
          />
          <StatusChip
            label={`validation ${validation.status}`}
            tone={asyncTone(validation.status)}
          />
          <StatusChip
            label={`save ${save.status}`}
            tone={save.status === "conflict" ? "warning" : asyncTone(save.status)}
          />
          <StatusChip label={`deps ${snapshot.dependencySummary.total}`} />
          <StatusChip label={`version ${document.versionToken ?? "—"}`} />
        </div>

        <HostIssuePanel issue={document.issue} />
        <HostIssuePanel issue={validation.issue} />
        <HostIssuePanel issue={save.issue} />

        {document.message && !document.issue ? (
          <p className="mt-3 text-sm text-muted-foreground">{document.message}</p>
        ) : null}
        {snapshot.rawParseError ? (
          <p className="mt-2 text-sm text-destructive">{snapshot.rawParseError}</p>
        ) : null}

        {document.isStale ? (
          <div className="mt-4 rounded-xl border border-[var(--cat-clay)]/30 bg-[var(--cat-clay)]/10 p-3 text-sm text-[var(--cat-clay)]">
            {document.staleMessage}
          </div>
        ) : null}

        {validation.result?.issues?.length ? (
          <div className="mt-4 rounded-xl border border-[var(--cat-clay)]/30 bg-[var(--cat-clay)]/10 p-3">
            <p className="text-sm font-medium text-[var(--cat-clay)]">Validation issues</p>
            <ul className="mt-2 space-y-2 text-sm text-[var(--cat-clay)]">
              {validation.result.issues.map((issue) => (
                <li key={`${issue.code}:${issue.path || "$"}`}>
                  <code>{issue.path || "$"}</code>: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {save.message && !save.issue ? (
          <div
            className={cn(
              "mt-4 rounded-xl border p-3 text-sm",
              save.status === "ready" &&
                "border-[var(--cat-green)]/30 bg-[var(--cat-green)]/12 text-[var(--cat-green)]",
              save.status === "conflict" &&
                "border-[var(--cat-clay)]/30 bg-[var(--cat-clay)]/12 text-[var(--cat-clay)]",
              save.status === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
              (save.status === "idle" || save.status === "saving") &&
                "border-border/70 bg-muted/20 text-muted-foreground",
            )}
          >
            {save.message}
            {save.lastConflictMessage ? ` — ${save.lastConflictMessage}` : ""}
          </div>
        ) : null}

        {document.dependencies.length > 0 ? (
          <div className="mt-4 rounded-xl border border-border/70 bg-muted/20 p-3">
            <p className="text-sm font-medium text-foreground">Resolved dependencies</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {document.dependencies.map((dependency) => (
                <li key={`${dependency.directivePath}:${dependency.documentId.relativePath}`}>
                  <code>{dependency.directivePath}</code> {"->"}{" "}
                  <code>{dependency.documentId.relativePath}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {document.composedContent ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-foreground">Composed content preview</p>
            <Textarea readOnly rows={10} value={document.composedContent} />
          </div>
        ) : null}

        <div className="mt-6">
          {renderSchema &&
          selection.moduleKey &&
          selection.selectedFilePath &&
          snapshot.rawParseStatus === "parsed" ? (
            <SettingsForm
              key={formResetToken}
              schema={renderSchema}
              schemaJson={schemaQuery.data?.schemaJson}
              moduleKey={selection.moduleKey}
              rootKey={selection.rootKey}
              initialValues={formBaseline}
              validationResult={validation.result}
              isSaving={save.status === "saving"}
              onSave={(values) => settingsStore.saveDraft(values)}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              Choose a workspace, module, root, and authoring file to load a schema form.
            </div>
          )}
        </div>
      </SectionCard>
    </main>
  );
}
