import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "#/components/ui/badge";
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
import { callHostDynamic } from "#/host/client";
import { type HostIssue, HostIssuePanel, toHostIssue } from "#/host/issues";
import { useBridgeSessionsListQuery, useHostOp, useHostOpDynamic } from "#/host/queries";
import { cn } from "#/lib/utils";

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
  rawBody: unknown;
  data: unknown;
}

function OpsPlayground() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HostOperationCatalogEntry | undefined>();
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? ops.filter((op) =>
          [op.key, op.displayName, op.description, ...(op.searchTerms ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : ops;
    return [...matched].sort((a, b) => a.key.localeCompare(b.key));
  }, [ops, query]);

  function select(op: HostOperationCatalogEntry) {
    const nextSchema = requestJsonSchema(op);
    const nextArgs = op.requestExamples?.[0]?.json ?? op.safeDefaultRequestJson ?? "{}";
    setSelected(op);
    setRequestSeed(nextArgs, nextSchema);
    setMode(nextSchema ? "form" : "raw");
    setResult(undefined);
    setIssue(undefined);
  }

  function setRequestSeed(json: string, schema?: HostOperationJsonSchema) {
    setArgs(json);
    setFormValues(readFormSeed(json, schema));
  }

  async function run() {
    if (!selected) return;
    setRunning(true);
    setIssue(undefined);
    setResult(undefined);
    const started = performance.now();
    try {
      const parsed =
        mode === "form" && requestSchema
          ? buildFormRequest(requestSchema, formValues, requestSchema)
          : args.trim()
            ? JSON.parse(args)
            : undefined;
      // The playground calls whatever the live catalog lists — dynamic by nature.
      const data = await callHostDynamic(selected.key, parsed, { bridgeSessionId });
      setResult({
        status: 200,
        elapsedMs: Math.round(performance.now() - started),
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
    <main className="grid h-screen grid-cols-[20rem_1fr] gap-0 bg-background text-foreground">
      {/* Op list */}
      <aside className="flex min-h-0 flex-col border-r border-border">
        <div className="border-b border-border p-2">
          <Input
            placeholder={
              catalogQuery.isPending ? "Loading op catalog..." : `Search ${ops.length} host ops...`
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1">
          {filtered.map((op) => (
            <li key={op.key}>
              <button
                onClick={() => select(op)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
                  selected?.key === op.key && "bg-muted",
                )}
              >
                <div className="truncate text-xs font-medium">{op.displayName ?? op.key}</div>
                <div className="truncate font-mono text-[0.625rem] text-muted-foreground">
                  {op.key}
                </div>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-muted-foreground">
              {catalogQuery.isError
                ? "Couldn't load the op catalog — is Revit connected?"
                : "No ops match."}
            </li>
          )}
        </ul>
      </aside>

      {/* Detail / runner */}
      <section className="min-h-0 overflow-y-auto p-4">
        {!selected ? (
          <p className="text-sm text-muted-foreground">
            Pick a host op. The list is the live session catalog (<code>host.ops.catalog</code>);
            calls go through <code>/call</code> (default <code>localhost:5180</code>).
          </p>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <header>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold">{selected.displayName ?? selected.key}</h1>
                {selected.intent && <Badge variant="secondary">{selected.intent}</Badge>}
                {selected.costTier && <Badge variant="secondary">{selected.costTier}</Badge>}
              </div>
              {selected.description && (
                <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
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

            <div>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase text-muted-foreground">Request</h2>
                <div className="flex gap-1">
                  {selected.requestExamples?.map((ex) => (
                    <Button
                      key={ex.name}
                      variant="ghost"
                      size="xs"
                      onClick={() => setRequestSeed(ex.json, requestSchema)}
                      title={ex.description}
                    >
                      {ex.name}
                    </Button>
                  ))}
                  {requestSchema && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setMode(mode === "form" ? "raw" : "form")}
                    >
                      {mode === "form" ? "Raw JSON" : "Form"}
                    </Button>
                  )}
                </div>
              </div>
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
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={run} disabled={running}>
                {running ? "Running..." : "Run"}
              </Button>
              {result && (
                <span className="text-xs text-muted-foreground">
                  {result.status} / {result.elapsedMs}ms
                </span>
              )}
            </div>

            <HostIssuePanel issue={issue} />
            {result && (
              <>
                <ProjectedOutput value={result.data} />
                <div className="grid gap-3 lg:grid-cols-2">
                  <OutputBlock title="Validated data" value={result.data} />
                  <OutputBlock title="Raw response" value={result.rawBody} />
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </main>
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
    return <p className="text-xs text-muted-foreground">This operation has no request fields.</p>;
  }

  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      {fields.map(([name, fieldSchema]) => {
        const description = readDescription(fieldSchema, root);
        return (
          <div key={name} className="grid gap-1">
            <Label htmlFor={`op-field-${depth}-${name}`}>
              <span className="font-mono">{name}</span>
              {required.has(name) && <span className="ml-1 text-destructive">required</span>}
            </Label>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
            <SchemaInput
              id={`op-field-${depth}-${name}`}
              name={name}
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
  name,
  schema,
  root,
  depth,
  value,
  onChange,
  bridgeSessionId,
}: {
  id: string;
  name: string;
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
      <div className="flex h-7 items-center gap-2">
        <Switch id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
        <Label htmlFor={id} className="text-muted-foreground">
          {name}
        </Label>
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

type FieldOptionsData = {
  mode?: string;
  allowsCustomValue?: boolean;
  items?: { value: string; label: string; description?: string | null }[];
};

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
  const optionsQuery = useHostOpDynamic(
    "revit.catalog.field-options",
    { sourceKey },
    { bridgeSessionId, staleTime: 5 * 60_000 },
  );
  const data = optionsQuery.data as FieldOptionsData | undefined;
  const items = data?.items ?? [];

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
        <h2 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          {projection.title}
        </h2>
        <ul className="max-h-[24rem] overflow-auto rounded-md border border-border text-xs">
          {rows.map((row, index) => (
            <li key={index} className="border-b border-border px-2 py-1 last:border-b-0">
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
      <h2 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
        {projection.title}
      </h2>
      <div className="max-h-[24rem] overflow-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-background">
            <tr>
              {columns.map((column) => (
                <th key={column} className="border-b border-border px-2 py-1 font-mono">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {objectRows.map((row, index) => (
              <tr key={index} className="border-b border-border last:border-b-0">
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
      <h2 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{title}</h2>
      <pre className="max-h-[32rem] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
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
