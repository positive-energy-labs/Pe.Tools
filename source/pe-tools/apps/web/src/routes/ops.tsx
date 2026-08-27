import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { FactChip, type FactTone } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Provenance } from "#/components/lang/section";
import { Verb } from "#/components/lang/verb";
import { callHostDynamic } from "#/host/client";
import { useFieldOptions } from "#/host/field-options";
import { type HostIssue, HostIssuePanel, toHostIssue } from "#/host/issues";
import { useBridgeSessionsListQuery, useHostOp } from "#/host/queries";
import { cn } from "#/lib/utils";
import { syntheticOps } from "#/ops/glance";
import { opViews } from "#/ops/op-views";
import { type SyntheticOp, SyntheticRunner } from "#/ops/synthetic";

export const Route = createFileRoute("/ops")({ component: OpsPlayground });

// Runtime op catalog entry as served by host.ops.catalog — the connected Revit
// session is the source of truth, so the list always matches what's callable.
type HostOperationCatalogEntry = {
  key: string;
  displayName?: string | null;
  intent?: string;
  costTier?: string;
  visibility?: string;
  requiresActiveDocument?: boolean;
  supportedActiveDocumentKind?: string;
  description?: string;
  searchTerms?: readonly string[];
  requestExamples?: readonly { name: string; description: string; json: string }[];
  safeDefaultRequestJson?: string | null;
  requestSchemaJson?: string;
  responseSchemaJson?: string;
};
type HostOperationJsonSchema = Record<string, unknown>;
const DEFAULT_SESSION_VALUE = "__host_default__";

interface RunResult {
  status: number;
  elapsedMs: number;
  observedAtMs: number;
  request: unknown;
  rawBody: unknown;
  data: unknown;
}

// Sidebar grammar: ops group by key prefix into the domains an operator thinks
// in. Order is the exploration ladder — orient, discover, inspect, join, act.
const DOMAIN_ORDER = [
  "Context",
  "Catalog",
  "Detail",
  "Matrix",
  "Family",
  "Apply",
  "Scripting",
  "Settings",
  "Host",
] as const;
type Domain = (typeof DOMAIN_ORDER)[number];

function opDomain(key: string): Domain {
  if (key.startsWith("revit.context.") || key.startsWith("revit.resolve.")) return "Context";
  if (key.startsWith("revit.catalog.")) return "Catalog";
  if (key.startsWith("revit.detail.")) return "Detail";
  if (key.startsWith("revit.matrix.")) return "Matrix";
  if (key.startsWith("family.") || key === "revit.apply.family-model") return "Family";
  if (key.startsWith("revit.apply.")) return "Apply";
  if (key.startsWith("scripting.")) return "Scripting";
  if (key.startsWith("settings.")) return "Settings";
  return "Host";
}

/** Cost tier is STATE (cost-as-risk): expensive earns caution; the word carries the
 * rest of the ladder — no taxonomy hue is spent on it. */
function costTone(tier: string | undefined): FactTone {
  return tier?.toLowerCase() === "expensive" ? "caution" : "meta";
}

function OpsPlayground() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HostOperationCatalogEntry | undefined>();
  const [selectedGlance, setSelectedGlance] = useState<SyntheticOp | undefined>();
  const [args, setArgs] = useState("{}");
  const [mode, setMode] = useState<"form" | "raw">("raw");
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [bridgeSessionId, setBridgeSessionId] = useState<string | undefined>();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | undefined>();
  const [issue, setIssue] = useState<HostIssue | undefined>();
  const requestSchema = selected ? requestJsonSchema(selected) : undefined;
  const sessionsQuery = useBridgeSessionsListQuery();
  const catalogQuery = useHostOp("host.ops.catalog", undefined, {
    bridgeSessionId,
    staleTime: 60_000,
  });
  const ops = useMemo(
    () =>
      (catalogQuery.data as { operations?: HostOperationCatalogEntry[] } | undefined)?.operations ??
      [],
    [catalogQuery.data],
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? ops.filter((op) =>
          [op.key, op.displayName, op.description, ...(op.searchTerms ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : ops;
    const byDomain = new Map<Domain, HostOperationCatalogEntry[]>();
    for (const op of matched) {
      const domain = opDomain(op.key);
      byDomain.set(domain, [...(byDomain.get(domain) ?? []), op]);
    }
    return DOMAIN_ORDER.flatMap((domain) => {
      const members = byDomain.get(domain);
      if (!members) return [];
      // Reads first, mutations demoted to the tail of each domain.
      const sorted = [...members].sort((a, b) => {
        const mutA = a.intent?.toLowerCase() === "mutate" ? 1 : 0;
        const mutB = b.intent?.toLowerCase() === "mutate" ? 1 : 0;
        return mutA - mutB || a.key.localeCompare(b.key);
      });
      return [{ domain, ops: sorted }];
    });
  }, [ops, query]);

  /** Glances match the search exactly like ops do — key, name, and blurb. */
  const matchedGlances = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return syntheticOps;
    return syntheticOps.filter((glance) =>
      [glance.key, glance.displayName, glance.blurb].join(" ").toLowerCase().includes(q),
    );
  }, [query]);

  function select(op: HostOperationCatalogEntry) {
    const nextSchema = requestJsonSchema(op);
    const nextArgs = op.requestExamples?.[0]?.json ?? op.safeDefaultRequestJson ?? "{}";
    setSelected(op);
    setSelectedGlance(undefined);
    setRequestSeed(nextArgs, nextSchema);
    setMode(nextSchema ? "form" : "raw");
    setResult(undefined);
    setIssue(undefined);
  }

  // Cheap reads run on select — the route reads as a live surface, not a console.
  // Anything bounded/expensive/mutating stays behind the explicit Run.
  const autoRunKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selected) return;
    const cheapRead =
      selected.intent?.toLowerCase() !== "mutate" && selected.costTier?.toLowerCase() === "cheap";
    if (cheapRead && autoRunKey.current !== selected.key) {
      autoRunKey.current = selected.key;
      void run(selected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function setRequestSeed(json: string, schema?: HostOperationJsonSchema) {
    setArgs(json);
    setFormValues(readFormSeed(json, schema));
  }

  async function run(op?: HostOperationCatalogEntry) {
    const target = op ?? selected;
    if (!target) return;
    setRunning(true);
    setIssue(undefined);
    setResult(undefined);
    const started = performance.now();
    try {
      const schema = requestJsonSchema(target);
      const parsed =
        mode === "form" && schema
          ? buildFormRequest(schema, formValues, schema)
          : args.trim()
            ? (JSON.parse(args) as unknown)
            : undefined;
      // The playground calls whatever the live catalog lists — dynamic by nature.
      const data = await callHostDynamic(target.key, parsed, { bridgeSessionId });
      setResult({
        status: 200,
        elapsedMs: Math.round(performance.now() - started),
        observedAtMs: Date.now(),
        request: parsed,
        rawBody: data,
        data,
      });
    } catch (err) {
      setIssue(toHostIssue(err, "Operation failed"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="grid h-screen grid-cols-[19rem_1fr] gap-0 bg-background text-foreground">
      {/* Op list */}
      <aside className="flex min-h-0 flex-col border-r border-line-2">
        <div className="border-b border-line p-2">
          <Input
            placeholder={
              catalogQuery.isPending ? "Loading op catalog..." : `Search ${ops.length} host ops...`
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {/* Glance: synthetic composed surfaces, pinned above the raw op domains. They match
              the search like ops do (fit reviews, 2026-08-16 — pinning that vanished under any
              query was search-hostile). */}
          {matchedGlances.length > 0 && (
            <section>
              <h2 className="t-label t-upper sticky top-0 z-10 bg-page px-3 pb-1 pt-3 text-ink-2">
                Glance
                <span className="face-mono t-caption ml-1.5 text-ink-2">
                  {matchedGlances.length}
                </span>
              </h2>
              <ul className="px-1">
                {matchedGlances.map((glance) => {
                  const active = selectedGlance?.key === glance.key;
                  return (
                    <li key={glance.key}>
                      <button
                        onClick={() => {
                          setSelectedGlance(glance);
                          setSelected(undefined);
                        }}
                        className={cn(
                          "w-full rounded-[2px] px-2 py-1 text-left transition-colors",
                          !active &&
                            "hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))]",
                          active && "bg-select [--r-on:var(--r-select)]",
                        )}
                      >
                        <div className="t-value min-w-0 truncate font-medium">
                          {glance.displayName}
                        </div>
                        <div className="face-mono t-caption truncate text-ink-2">{glance.key}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {grouped.map(({ domain, ops: members }) => (
            <section key={domain}>
              <h2 className="t-label t-upper sticky top-0 z-10 bg-page px-3 pb-1 pt-3 text-ink-2">
                {domain}
                <span className="face-mono t-caption ml-1.5 text-ink-2">{members.length}</span>
              </h2>
              <ul className="px-1">
                {members.map((op) => {
                  const mutate = op.intent?.toLowerCase() === "mutate";
                  const active = selected?.key === op.key;
                  return (
                    <li key={op.key}>
                      <button
                        onClick={() => select(op)}
                        className={cn(
                          "w-full rounded-[2px] px-2 py-1 text-left transition-colors",
                          !active &&
                            "hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))]",
                          active && "bg-select [--r-on:var(--r-select)]",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "t-value min-w-0 truncate",
                              mutate ? "text-ink-2" : "font-medium",
                            )}
                          >
                            {op.displayName ?? op.key}
                          </span>
                          {mutate && (
                            <span
                              className="face-mono t-caption shrink-0 text-caution"
                              title="mutating op — writes to the model"
                            >
                              M
                            </span>
                          )}
                          {opViews[op.key] && (
                            <span
                              className="ml-auto size-[5px] shrink-0 rounded-[1px] bg-ink-2"
                              title="curated view"
                            />
                          )}
                        </div>
                        <div className="face-mono t-caption truncate text-ink-2">{op.key}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {grouped.length === 0 && (
            <div className="px-3 py-4">
              {catalogQuery.isError ? (
                <EmptyState story="scope" exit="start the host, then reload">
                  the op catalog is unreachable
                </EmptyState>
              ) : (
                <EmptyState story="filter" exit="clear the search">
                  no ops match
                </EmptyState>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Detail / runner */}
      <section className="min-h-0 overflow-y-auto p-4">
        {selectedGlance ? (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            <header>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="t-title">{selectedGlance.displayName}</h1>
                {/* a synthetic op IS a stand-in for a contract that doesn't exist —
                    the dashed seam slot, worn honestly. */}
                <FactChip
                  dashed
                  title="composed client-side from real ops — a prototype of a contract that doesn't exist yet"
                >
                  synthetic
                </FactChip>
              </div>
              <p className="face-mono t-caption mt-0.5 text-ink-2">{selectedGlance.key}</p>
              <p className="t-prose mt-1 max-w-2xl text-ink-2">{selectedGlance.blurb}</p>
              {selectedGlance.contractNote && (
                <p className="t-label mt-1 max-w-2xl text-ink-2">
                  <span className="face-mono t-caption t-upper mr-1 text-ink-2">contract</span>
                  {selectedGlance.contractNote}
                </p>
              )}
            </header>
            <SyntheticRunner op={selectedGlance} bridgeSessionId={bridgeSessionId} />
          </div>
        ) : !selected ? (
          <div className="flex flex-col gap-2">
            <EmptyState story="scope" exit="pick an op from the catalog list">
              no op selected
            </EmptyState>
            <Provenance>
              list = the live session catalog (host.ops.catalog) · calls go through /call
            </Provenance>
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            <header>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="t-title">{selected.displayName ?? selected.key}</h1>
                {selected.intent && (
                  <FactChip
                    tone={selected.intent.toLowerCase() === "mutate" ? "caution" : "meta"}
                    title={
                      selected.intent.toLowerCase() === "mutate"
                        ? "this op writes to the model"
                        : "read-only op"
                    }
                  >
                    {selected.intent}
                  </FactChip>
                )}
                {selected.costTier && (
                  <FactChip
                    tone={costTone(selected.costTier)}
                    title="host-declared cost tier — expensive ops can stall a session"
                  >
                    {selected.costTier}
                  </FactChip>
                )}
                {selected.requiresActiveDocument && (
                  <FactChip tone="caution" title="refuses without an active Revit document">
                    active doc
                  </FactChip>
                )}
                {selected.supportedActiveDocumentKind &&
                  selected.supportedActiveDocumentKind !== "Any" && (
                    <FactChip tone="caution" title="refuses on the wrong active document kind">
                      {selected.supportedActiveDocumentKind === "FamilyOnly"
                        ? "family only"
                        : "project only"}
                    </FactChip>
                  )}
              </div>
              <p className="face-mono t-caption mt-0.5 text-ink-2">{selected.key}</p>
              {selected.description && (
                <p className="t-prose mt-1 max-w-2xl text-ink-2">{selected.description}</p>
              )}
            </header>

            <div className="grid max-w-sm gap-1.5">
              <Label htmlFor="bridge-session">Bridge session</Label>
              <Select
                value={bridgeSessionId ?? DEFAULT_SESSION_VALUE}
                onValueChange={(value) =>
                  setBridgeSessionId(!value || value === DEFAULT_SESSION_VALUE ? undefined : value)
                }
              >
                <SelectTrigger id="bridge-session">
                  <SelectValue placeholder="Host default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_SESSION_VALUE}>Host default</SelectItem>
                  {(sessionsQuery.data?.sessions ?? []).map((session) => (
                    <SelectItem key={session.sessionId} value={session.sessionId}>
                      {session.activeDocumentTitle || `Revit ${session.processId ?? ""}`.trim()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Request collapses once evidence is on screen; remount per (op, result) so the
                initial open state is right and user toggles stay free. */}
            <details key={`${selected.key}:${result ? "ran" : "idle"}`} open={!result}>
              <summary className="mb-1 flex cursor-pointer select-none list-none items-center justify-between">
                <h2 className="t-label t-upper text-ink-2">Request</h2>
                <div className="flex gap-1">
                  {selected.requestExamples?.map((ex) => (
                    <Verb
                      key={ex.name}
                      onClick={() => setRequestSeed(ex.json, requestSchema)}
                      label={ex.name}
                      reason={ex.description}
                    />
                  ))}
                  {requestSchema && (
                    <Verb
                      label={mode === "form" ? "Raw JSON" : "Form"}
                      onClick={() => setMode(mode === "form" ? "raw" : "form")}
                      reason={`Switch the request editor to ${mode === "form" ? "raw JSON" : "form"}.`}
                    />
                  )}
                </div>
              </summary>
              {requestSchema && mode === "form" ? (
                <JsonSchemaForm
                  schema={requestSchema}
                  root={requestSchema}
                  depth={0}
                  value={formValues}
                  onChange={setFormValues}
                  bridgeSessionId={bridgeSessionId}
                />
              ) : (
                <Textarea
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  spellCheck={false}
                  className="min-h-32 font-mono"
                />
              )}
            </details>

            <div className="flex items-center gap-3">
              <Verb
                label="Run"
                onClick={() => void run()}
                busy={running}
                reason="Run the selected operation against the selected host session."
              />
              {result && (
                <OutcomeLine
                  kind="receipt"
                  label={`${result.status} · ${result.elapsedMs}ms · obs ${new Date(result.observedAtMs).toLocaleTimeString()}`}
                />
              )}
            </div>

            <HostIssuePanel issue={issue} />
            {result && <OpResult opKey={selected.key} result={result} />}
          </div>
        )}
      </section>
    </main>
  );
}

/** Curated view when one is registered; otherwise the generic projection. The
 * raw wire payload stays one disclosure away either way — evidence, demoted. */
function OpResult({ opKey, result }: { opKey: string; result: RunResult }) {
  const Curated = opViews[opKey];
  return (
    <>
      {Curated ? (
        <Curated data={result.data} opKey={opKey} request={result.request} />
      ) : (
        <ProjectedOutput value={result.data} />
      )}
      <details className="group">
        <summary className="face-mono t-caption t-upper cursor-pointer select-none list-none text-ink-2 hover:text-ink">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
          raw response
        </summary>
        <div className="mt-2">
          <OutputBlock title="" value={result.rawBody} />
        </div>
      </details>
    </>
  );
}

function requestJsonSchema(op: HostOperationCatalogEntry): HostOperationJsonSchema | undefined {
  if (!op.requestSchemaJson) return undefined;
  try {
    const parsed = JSON.parse(op.requestSchemaJson) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Follow $ref and nullable oneOf/anyOf wrappers to the concrete schema so nested
// request objects (filter, projection, budget) render as fields, not JSON blobs.
function resolveSchema(
  schema: HostOperationJsonSchema,
  root: HostOperationJsonSchema,
): HostOperationJsonSchema {
  let current = schema;
  for (let hops = 0; hops < 4; hops++) {
    if (typeof current.$ref === "string") {
      const name = current.$ref.split("/").at(-1) ?? "";
      const definition = isRecord(root.definitions) ? root.definitions[name] : undefined;
      if (!isRecord(definition)) return current;
      current = definition;
      continue;
    }
    const branches = [current.oneOf, current.anyOf].find(Array.isArray);
    if (branches) {
      const concrete = branches.find((branch) => isRecord(branch) && branch.type !== "null");
      if (isRecord(concrete)) {
        current = concrete;
        continue;
      }
    }
    return current;
  }
  return current;
}

function JsonSchemaForm({
  schema,
  root,
  depth,
  value,
  onChange,
  bridgeSessionId,
}: {
  schema: HostOperationJsonSchema;
  root: HostOperationJsonSchema;
  depth: number;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  bridgeSessionId?: string;
}) {
  const fields = schemaProperties(schema);
  const required = new Set(readStringArray(schema.required));
  if (fields.length === 0) {
    return <p className="t-label text-ink-2">This operation has no request fields.</p>;
  }

  return (
    <div className="grid gap-3 rounded-md border border-line p-3">
      {fields.map(([name, fieldSchema]) => {
        const description = readDescription(fieldSchema, root);
        return (
          <div key={name} className="grid gap-1">
            <Label htmlFor={`op-field-${depth}-${name}`}>
              <span className="face-mono">{name}</span>
              {required.has(name) && <span className="ml-1 text-caution">required</span>}
            </Label>
            {description && <p className="t-label text-ink-2">{description}</p>}
            <SchemaInput
              id={`op-field-${depth}-${name}`}
              schema={fieldSchema}
              root={root}
              depth={depth}
              value={value[name]}
              onChange={(next) => onChange({ ...value, [name]: next })}
              bridgeSessionId={bridgeSessionId}
            />
          </div>
        );
      })}
    </div>
  );
}

function readDescription(
  schema: HostOperationJsonSchema,
  root: HostOperationJsonSchema,
): string | undefined {
  if (typeof schema.description === "string") return schema.description;
  const resolved = resolveSchema(schema, root);
  return typeof resolved.description === "string" ? resolved.description : undefined;
}

function SchemaInput({
  id,
  schema,
  root,
  depth,
  value,
  onChange,
  bridgeSessionId,
}: {
  id: string;
  schema: HostOperationJsonSchema;
  root: HostOperationJsonSchema;
  depth: number;
  value: unknown;
  onChange: (next: unknown) => void;
  bridgeSessionId?: string;
}) {
  const resolved = resolveSchema(schema, root);
  const options = readEnum(resolved);
  const type = readSchemaType(resolved);
  const fieldOptionsKey = readFieldOptionsKey(resolved);

  if (options.length === 0 && fieldOptionsKey && (type === "string" || type === undefined)) {
    return (
      <FieldOptionsInput
        id={id}
        sourceKey={fieldOptionsKey}
        value={value}
        onChange={onChange}
        bridgeSessionId={bridgeSessionId}
      />
    );
  }

  if (type === "object" && depth < 2 && schemaProperties(resolved).length > 0) {
    return (
      <JsonSchemaForm
        schema={resolved}
        root={root}
        depth={depth + 1}
        value={isRecord(value) ? value : {}}
        onChange={onChange}
        bridgeSessionId={bridgeSessionId}
      />
    );
  }

  if (options.length > 0) {
    return (
      <Select value={scalarText(value)} onValueChange={(next) => onChange(next ?? "")}>
        <SelectTrigger id={id} className="w-full">
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

  if (type === "boolean") {
    return (
      <div className="flex h-7 items-center">
        <Switch id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
      </div>
    );
  }

  if (type === "array" || type === "object") {
    return (
      <Textarea
        id={id}
        value={formatFormText(value)}
        onChange={(event) => onChange(event.currentTarget.value)}
        spellCheck={false}
        className="min-h-20 font-mono"
      />
    );
  }

  return (
    <Input
      id={id}
      type={type === "integer" || type === "number" ? "number" : "text"}
      step={type === "integer" ? 1 : "any"}
      value={scalarText(value)}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

// Request schemas annotate value-domain-backed fields with x-options (same shape the
// settings pipeline emits); the options themselves come from revit.catalog.field-options.
function readFieldOptionsKey(schema: HostOperationJsonSchema): string | undefined {
  const raw = schema["x-options"];
  return isRecord(raw) && typeof raw.key === "string" ? raw.key : undefined;
}

function FieldOptionsInput({
  id,
  sourceKey,
  value,
  onChange,
  bridgeSessionId,
}: {
  id: string;
  sourceKey: string;
  value: unknown;
  onChange: (next: unknown) => void;
  bridgeSessionId?: string;
}) {
  const optionsQuery = useFieldOptions(sourceKey, {}, bridgeSessionId);
  const data = optionsQuery.data as { mode?: string; allowsCustomValue?: boolean } | undefined;
  const items = optionsQuery.items;

  if (data && data.mode?.toLowerCase() === "constraint" && !data.allowsCustomValue) {
    return (
      <Select value={scalarText(value)} onValueChange={(next) => onChange(next ?? "")}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Unset" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label || item.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <>
      <Input
        id={id}
        list={`${id}-options`}
        value={scalarText(value)}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={optionsQuery.isPending ? "Loading options..." : `${items.length} options`}
      />
      <datalist id={`${id}-options`}>
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label !== item.value ? item.label : undefined}
          </option>
        ))}
      </datalist>
    </>
  );
}

function ProjectedOutput({ value }: { value: unknown }) {
  const projection = projectRows(value);
  if (!projection) return null;

  const rows = projection.rows;
  const objectRows = rows.filter(isRecord);
  if (objectRows.length !== rows.length) {
    return (
      <div>
        <h2 className="t-label t-upper mb-1 text-ink-2">{projection.title}</h2>
        <ul className="t-value max-h-96 overflow-auto rounded-md border border-line">
          {rows.map((row, index) => (
            <li key={index} className="border-b border-line px-2 py-1 last:border-b-0">
              {formatCell(row)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const columns = Array.from(
    new Set(objectRows.slice(0, 20).flatMap((row) => Object.keys(row))),
  ).slice(0, 8);
  if (columns.length === 0) return null;

  return (
    <div>
      <h2 className="t-label t-upper mb-1 text-ink-2">{projection.title}</h2>
      <div className="max-h-96 overflow-auto rounded-md border border-line">
        <table className="t-value w-full text-left">
          <thead className="sticky top-0 bg-recess [--r-on:var(--r-recess)]">
            <tr>
              {columns.map((column) => (
                <th key={column} className="face-mono t-label border-b border-line-2 px-2 py-1">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {objectRows.map((row, index) => (
              <tr key={index} className="border-b border-line last:border-b-0">
                {columns.map((column) => (
                  <td key={column} className="max-w-64 truncate px-2 py-1">
                    {formatCell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OutputBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0">
      {title && <h2 className="t-label t-upper mb-1 text-ink-2">{title}</h2>}
      <pre className="t-value max-h-128 overflow-auto rounded-md border border-line bg-recess [--r-on:var(--r-recess)] p-3">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function schemaProperties(schema: HostOperationJsonSchema): [string, HostOperationJsonSchema][] {
  if (!isRecord(schema.properties)) return [];
  return Object.entries(schema.properties).flatMap(([key, value]) =>
    isRecord(value) ? [[key, value]] : [],
  );
}

function readFormSeed(
  json: string,
  schema: HostOperationJsonSchema | undefined,
): Record<string, unknown> {
  let seed: Record<string, unknown> = {};
  try {
    const parsed = json.trim() ? JSON.parse(json) : {};
    if (isRecord(parsed)) seed = parsed;
  } catch {
    seed = {};
  }
  if (!schema) return seed;
  for (const [name, fieldSchema] of schemaProperties(schema)) {
    if (!(name in seed) && "default" in fieldSchema) seed[name] = fieldSchema.default;
  }
  return seed;
}

function buildFormRequest(
  schema: HostOperationJsonSchema,
  values: Record<string, unknown>,
  root: HostOperationJsonSchema,
): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  for (const [name, fieldSchema] of schemaProperties(schema)) {
    const resolved = resolveSchema(fieldSchema, root);
    const raw = values[name];
    let value: unknown;
    if (
      readSchemaType(resolved) === "object" &&
      schemaProperties(resolved).length > 0 &&
      isRecord(raw)
    ) {
      const nested = buildFormRequest(resolved, raw, root);
      value = Object.keys(nested).length > 0 ? nested : undefined;
    } else {
      value = coerceFormValue(name, resolved, raw);
    }
    if (value !== undefined) request[name] = value;
  }
  return request;
}

function coerceFormValue(name: string, schema: HostOperationJsonSchema, value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  const enumValues = readEnum(schema);
  if (enumValues.length > 0) {
    return enumValues.find((item) => scalarText(item) === scalarText(value)) ?? value;
  }

  const type = readSchemaType(schema);
  if (type === "boolean") return value === true || value === "true";
  if (type === "integer" || type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if ((type === "array" || type === "object") && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`${name} must be valid JSON.`);
    }
  }
  return value;
}

function readSchemaType(schema: HostOperationJsonSchema): string | undefined {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) {
    return schema.type.find((item): item is string => typeof item === "string" && item !== "null");
  }
  if (Array.isArray(schema.anyOf)) {
    for (const candidate of schema.anyOf) {
      if (isRecord(candidate)) {
        const type = readSchemaType(candidate);
        if (type) return type;
      }
    }
  }
  return undefined;
}

function readEnum(schema: HostOperationJsonSchema): unknown[] {
  return Array.isArray(schema.enum) ? schema.enum : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatFormText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function formatCell(value: unknown): string {
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value) : scalarText(value);
}

function scalarText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function projectRows(value: unknown): { title: string; rows: unknown[] } | undefined {
  if (Array.isArray(value)) return { title: "Projection", rows: value };
  if (!isRecord(value)) return undefined;

  // ponytail: first array wins; add explicit view mappers when a real route deserves one.
  const entry = Object.entries(value).find(([, item]) => Array.isArray(item));
  return entry ? { title: `Projection: ${entry[0]}`, rows: entry[1] as unknown[] } : undefined;
}
