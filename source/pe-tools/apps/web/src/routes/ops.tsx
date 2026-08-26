import { useEffect, useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { OpsReceipt } from "@pe/agent-contracts";

import { FactChip, type FactTone } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Provenance } from "#/components/lang/section";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { useFieldOptions } from "#/host/field-options";
import { useFleet } from "#/host/fleet";
import { useHostOp } from "#/host/queries";
import { resolveTarget } from "#/host/target";
import { syntheticOps } from "#/ops/glance";
import { opViews } from "#/ops/op-views";
import { bindOpsVerb, opsRefusal, type HostOperationCatalogEntry } from "#/ops/product";
import { createOpsStore, type OpsStore } from "#/ops/store";
import { SyntheticRunner } from "#/ops/synthetic";
import { appAtomRegistry } from "#/state/registry";
import type { Feed } from "#/state/route-store";
import { useRouteStore } from "#/state/use-route-store";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingState } from "#/targeting/kit";
import type { Feeds } from "#/targeting/model";
import { worldTrunk } from "#/targeting/trunks";
import { withThread } from "./-with-thread";

type HostOperationJsonSchema = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");

export const Route = createFileRoute("/ops")({
  validateSearch: (search: Record<string, unknown>) => ({
    world: str(search.world),
    op: str(search.op),
    thread: str(search.thread) || undefined,
  }),
  beforeLoad: withThread,
  component: OpsRoute,
});

function OpsRoute() {
  const { thread } = Route.useSearch();
  if (!thread) return null;
  return <OpsStoreOwner key={thread} thread={thread} />;
}

function OpsStoreOwner({ thread }: { thread: string }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/ops" });
  const store = useRouteStore(() =>
    createOpsStore({
      registry: appAtomRegistry,
      scope: { threadId: thread },
      search: {
        ...search,
        patch: (patch) => void navigate({ search: (previous) => ({ ...previous, ...patch }) }),
      },
    }),
  );
  return <OpsPage store={store} />;
}

function OpsPage({ store }: { store: OpsStore }) {
  const search = Route.useSearch();
  const fleet = useFleet();
  const resolution = resolveTarget(fleet.sessions, search.world);
  const session = resolution.kind === "resolved" ? resolution.session : null;
  const catalog = useHostOp("host.ops.catalog", undefined, {
    bridgeSessionId: session?.sessionId,
    enabled: session !== null,
    staleTime: 60_000,
  });
  const operations = catalog.data?.operations ?? [];
  const selected = operations.find((operation) => operation.key === search.op);
  const requestSchema = selected ? parseSchema(selected.requestSchemaJson) : undefined;
  const args = useAtomValue(store.atoms.args);
  const mode = useAtomValue(store.atoms.mode);
  const formValues = useAtomValue(store.atoms.formValues);
  const picker = useAtomValue(store.atoms.picker);
  const selectedGlanceKey = useAtomValue(store.atoms.selectedGlance);
  const result = useAtomValue(store.atoms.result);
  const busyState = useAtomValue(store.atoms.busy);
  const failure = useAtomValue(store.atoms.failure);
  const selectedGlance = syntheticOps.find((glance) => glance.key === selectedGlanceKey);
  const currentIdentity = session
    ? {
        target: session.sdkSessionId ?? `pid:${session.processId}`,
        documentId: session.activeDocumentId,
      }
    : null;

  useEffect(() => {
    void store.actions
      .syncBindings(search.world, search.op, currentIdentity)
      .catch(() => undefined);
  }, [search.world, search.op, currentIdentity?.target, currentIdentity?.documentId, store]);
  useEffect(() => {
    const seed = selected?.requestExamples[0]?.json ?? selected?.safeDefaultRequestJson ?? "{}";
    store.actions.select(selected, readFormSeed(seed, requestSchema));
  }, [requestSchema, selected, store]);

  const opFeed: Feed = {
    options: operations.map((operation) => ({
      id: operation.key,
      label: operation.displayName ?? operation.key,
      sub: `${operation.intent} · ${operation.costTier}`,
    })),
    state: catalog.isPending ? "loading" : catalog.isError ? "error" : "ready",
    lane: "live",
    stale: catalog.isFetching && !catalog.isPending,
    at: catalog.dataUpdatedAt || undefined,
    basis: ["host.ops.catalog"],
    note: catalog.error instanceof Error ? catalog.error.message : undefined,
  };
  const feeds: Feeds = { world: worldTrunk.feed(fleet), op: opFeed };
  const state: BindingState = useMemo(
    () => ({
      bound: { world: search.world || null, op: search.op || null },
      multi: {},
      stage: "explore",
    }),
    [search.op, search.world],
  );
  const product = useMemo(
    () =>
      bindOpsVerb(
        () => {
          if (!selected || !session) throw Error("bind an operation and world first");
          return store.actions.run({
            opKey: selected.key,
            request: () =>
              mode === "form" && requestSchema
                ? buildFormRequest(requestSchema, formValues, requestSchema)
                : args.trim()
                  ? JSON.parse(args)
                  : undefined,
            from: {
              target: session.sdkSessionId ?? `pid:${session.processId}`,
              ...(selected.requiresActiveDocument && session.activeDocumentId
                ? { documentId: session.activeDocumentId }
                : {}),
            },
            bridgeSessionId: session.sessionId,
          });
        },
        () => opsRefusal(selected, session?.custody),
      ),
    [args, formValues, mode, requestSchema, selected, session, store],
  );
  const b = useBindings(
    product,
    feeds,
    state,
    (patch) => {
      const nextWorld = patch.bound?.world ?? search.world;
      const nextResolution = resolveTarget(fleet.sessions, nextWorld || "");
      const nextSession = nextResolution.kind === "resolved" ? nextResolution.session : null;
      void store.actions.setBindings(
        patch,
        nextSession
          ? {
              target: nextSession.sdkSessionId ?? `pid:${nextSession.processId}`,
              documentId: nextSession.activeDocumentId,
            }
          : null,
      );
    },
    picker.open,
    (open) => store.actions.setPicker((previous) => ({ ...previous, open })),
    picker.level,
    (level) => store.actions.setPicker((previous) => ({ ...previous, level })),
    picker.query,
    (query) => store.actions.setPicker((previous) => ({ ...previous, query })),
  );
  const runner = useRunner(product, b, busyState?.id ?? null);

  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <TargetingHead
          product={product}
          b={b}
          runner={runner}
          receipt={
            result ? (
              <OutcomeLine
                kind="receipt"
                label={`${result.opKey} · ${result.elapsedMs}ms · from.target = ${result.from.target}`}
              />
            ) : undefined
          }
        />

        <section className="flex flex-wrap items-center gap-1.5">
          <span className="t-label t-upper mr-1 text-[var(--r-ink-2)]">Glance</span>
          {syntheticOps.map((glance) => (
            <Button
              key={glance.key}
              variant={selectedGlanceKey === glance.key ? "secondary" : "ghost"}
              size="xs"
              onClick={() => store.actions.setSelectedGlance(glance.key)}
            >
              {glance.displayName}
            </Button>
          ))}
        </section>

        {selectedGlance && session ? (
          <section className="flex flex-col gap-3">
            <header>
              <div className="flex items-center gap-2">
                <h1 className="t-title">{selectedGlance.displayName}</h1>
                <FactChip dashed title="composed client-side from checked-in typed operations">
                  synthetic
                </FactChip>
              </div>
              <p className="t-prose text-[var(--r-ink-2)]">{selectedGlance.blurb}</p>
            </header>
            <SyntheticRunner op={selectedGlance} bridgeSessionId={session.sessionId} />
          </section>
        ) : selected ? (
          <OperationPane
            operation={selected}
            schema={requestSchema}
            bridgeSessionId={session?.sessionId}
            args={args}
            mode={mode}
            formValues={formValues}
            result={result}
            setArgs={store.actions.setArgs}
            setMode={store.actions.setMode}
            setFormValues={store.actions.setFormValues}
          />
        ) : (
          <EmptyState story="scope" exit="bind a world, then pick an operation">
            no operation selected
          </EmptyState>
        )}

        {failure ? <OutcomeLine kind="error" label={failure.message} /> : null}
        <Provenance>
          catalog = host.ops.catalog · selected live key is the route's one dynamic /call
        </Provenance>
      </div>
    </main>
  );
}

function OperationPane({
  operation,
  schema,
  bridgeSessionId,
  args,
  mode,
  formValues,
  result,
  setArgs,
  setMode,
  setFormValues,
}: {
  operation: HostOperationCatalogEntry;
  schema?: HostOperationJsonSchema;
  bridgeSessionId?: string;
  args: string;
  mode: "form" | "raw";
  formValues: Record<string, unknown>;
  result: OpsReceipt | null;
  setArgs: OpsStore["actions"]["setArgs"];
  setMode: OpsStore["actions"]["setMode"];
  setFormValues: OpsStore["actions"]["setFormValues"];
}) {
  const Curated = opViews[operation.key];
  return (
    <section className="flex flex-col gap-4">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="t-title">{operation.displayName ?? operation.key}</h1>
          <FactChip
            tone={operation.intent.toLowerCase() === "mutate" ? "caution" : "meta"}
            title={operation.intent.toLowerCase() === "mutate" ? "writes to Revit" : "read-only"}
          >
            {operation.intent}
          </FactChip>
          <FactChip tone={costTone(operation.costTier)} title="host-declared cost tier">
            {operation.costTier}
          </FactChip>
          {operation.requiresActiveDocument ? (
            <FactChip tone="caution" title="requires the active Revit document">
              active doc
            </FactChip>
          ) : null}
        </div>
        <p className="face-mono t-caption text-[var(--r-ink-2)]">{operation.key}</p>
        <p className="t-prose max-w-2xl text-[var(--r-ink-2)]">{operation.description}</p>
      </header>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="t-label t-upper text-[var(--r-ink-2)]">Request</h2>
          <span className="flex gap-1">
            {operation.requestExamples.map((example) => (
              <Button
                key={example.name}
                variant="ghost"
                size="xs"
                title={example.description}
                onClick={() => {
                  setArgs(example.json);
                  setFormValues(readFormSeed(example.json, schema));
                }}
              >
                {example.name}
              </Button>
            ))}
            {schema ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setMode(mode === "form" ? "raw" : "form")}
              >
                {mode === "form" ? "raw" : "form"}
              </Button>
            ) : null}
          </span>
        </div>
        {mode === "form" && schema ? (
          <JsonSchemaForm
            schema={schema}
            root={schema}
            value={formValues}
            onChange={setFormValues}
            bridgeSessionId={bridgeSessionId}
          />
        ) : (
          <Textarea
            value={args}
            onChange={(event) => setArgs(event.currentTarget.value)}
            spellCheck={false}
            className="min-h-32 font-mono"
          />
        )}
      </section>

      {result ? (
        <section className="flex flex-col gap-2">
          <h2 className="t-label t-upper text-[var(--r-ink-2)]">Result</h2>
          {Curated ? (
            <Curated data={result.value} opKey={operation.key} request={result.request} />
          ) : (
            <OutputBlock value={result.value} />
          )}
          {Curated ? (
            <details>
              <summary className="face-mono t-caption cursor-pointer text-[var(--r-ink-2)]">
                raw response
              </summary>
              <OutputBlock value={result.value} />
            </details>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function JsonSchemaForm({
  schema,
  root,
  value,
  onChange,
  bridgeSessionId,
}: {
  schema: HostOperationJsonSchema;
  root: HostOperationJsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  bridgeSessionId?: string;
}) {
  const fields = schemaProperties(schema);
  if (!fields.length)
    return <p className="t-label text-[var(--r-ink-2)]">This operation has no request fields.</p>;
  return (
    <div className="grid gap-3 rounded-[var(--radius)] border border-[var(--r-line)] p-3">
      {fields.map(([name, field]) => (
        <div key={name} className="grid gap-1">
          <Label htmlFor={`op-field-${name}`}>{name}</Label>
          <SchemaInput
            id={`op-field-${name}`}
            schema={field}
            root={root}
            value={value[name]}
            onChange={(next) => onChange({ ...value, [name]: next })}
            bridgeSessionId={bridgeSessionId}
          />
        </div>
      ))}
    </div>
  );
}

function SchemaInput({
  id,
  schema,
  root,
  value,
  onChange,
  bridgeSessionId,
}: {
  id: string;
  schema: HostOperationJsonSchema;
  root: HostOperationJsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  bridgeSessionId?: string;
}) {
  const resolved = resolveSchema(schema, root);
  const options = Array.isArray(resolved.enum) ? resolved.enum : [];
  const type = schemaType(resolved);
  const sourceKey = fieldOptionsKey(resolved);
  const fieldOptions = useFieldOptions(sourceKey ?? "", {}, bridgeSessionId, Boolean(sourceKey));
  if (sourceKey && type !== "array" && type !== "object") {
    return (
      <>
        <Input
          id={id}
          list={`${id}-options`}
          value={scalarText(value)}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <datalist id={`${id}-options`}>
          {fieldOptions.items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </datalist>
      </>
    );
  }
  if (options.length) {
    return (
      <Select value={scalarText(value)} onValueChange={(next) => onChange(next ?? "")}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Unset" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={scalarText(option)} value={scalarText(option)}>
              {scalarText(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (type === "boolean")
    return <Switch id={id} checked={value === true} onCheckedChange={onChange} />;
  if (type === "object" && schemaProperties(resolved).length)
    return (
      <JsonSchemaForm
        schema={resolved}
        root={root}
        value={isRecord(value) ? value : {}}
        onChange={onChange}
        bridgeSessionId={bridgeSessionId}
      />
    );
  if (type === "array" || type === "object")
    return (
      <Textarea
        id={id}
        value={
          value == null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2)
        }
        onChange={(event) => onChange(event.currentTarget.value)}
        spellCheck={false}
      />
    );
  return (
    <Input
      id={id}
      type={type === "integer" || type === "number" ? "number" : "text"}
      value={scalarText(value)}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function OutputBlock({ value }: { value: unknown }) {
  return (
    <pre className="t-value max-h-[32rem] overflow-auto rounded-[var(--radius)] border border-[var(--r-line)] p-3">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function parseSchema(json: string): HostOperationJsonSchema | undefined {
  try {
    const value: unknown = JSON.parse(json);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveSchema(schema: HostOperationJsonSchema, root: HostOperationJsonSchema) {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").at(-1) ?? "";
    const definitions = isRecord(root.definitions) ? root.definitions : {};
    return isRecord(definitions[name]) ? definitions[name] : schema;
  }
  const branches = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : [];
  const concrete = branches.find((branch) => isRecord(branch) && branch.type !== "null");
  return isRecord(concrete) ? concrete : schema;
}

function readFormSeed(json: string, schema?: HostOperationJsonSchema) {
  let seed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(json);
    if (isRecord(value)) seed = value;
  } catch {
    // An invalid host example is represented by the empty draft; Run reports malformed raw JSON.
  }
  for (const [name, field] of schemaProperties(schema ?? {}))
    if (!(name in seed) && "default" in field) seed[name] = field.default;
  return seed;
}

function buildFormRequest(
  schema: HostOperationJsonSchema,
  values: Record<string, unknown>,
  root: HostOperationJsonSchema,
) {
  return Object.fromEntries(
    schemaProperties(schema).flatMap(([name, field]) => {
      const resolved = resolveSchema(field, root);
      const raw = values[name];
      let value: unknown = raw;
      if (raw === "" || raw == null) return [];
      if (schemaType(resolved) === "object" && isRecord(raw))
        value = buildFormRequest(resolved, raw, root);
      else if (schemaType(resolved) === "boolean") value = raw === true || raw === "true";
      else if (schemaType(resolved) === "integer" || schemaType(resolved) === "number")
        value = Number(raw);
      else if (
        (schemaType(resolved) === "array" || schemaType(resolved) === "object") &&
        typeof raw === "string"
      )
        value = JSON.parse(raw);
      return [[name, value]];
    }),
  );
}

const schemaProperties = (schema: HostOperationJsonSchema): [string, HostOperationJsonSchema][] =>
  isRecord(schema.properties)
    ? Object.entries(schema.properties).filter(
        (entry): entry is [string, HostOperationJsonSchema] => isRecord(entry[1]),
      )
    : [];
const schemaType = (schema: HostOperationJsonSchema) =>
  typeof schema.type === "string"
    ? schema.type
    : Array.isArray(schema.type)
      ? schema.type.find((value) => typeof value === "string" && value !== "null")
      : undefined;
const fieldOptionsKey = (schema: HostOperationJsonSchema) => {
  const options = schema["x-options"];
  return isRecord(options) && typeof options.key === "string" ? options.key : undefined;
};
const scalarText = (value: unknown) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const costTone = (tier: string): FactTone =>
  tier.toLowerCase() === "expensive" ? "caution" : "meta";
