import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { hostOperations } from "@pe/host-contracts/contracts";
import type { HostOperationDefinition, HostOperationKey } from "@pe/host-contracts/contracts";
import { hostEffectOperationSchemas } from "@pe/host-contracts/effect/registry";
import { Schema } from "effect";
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
import { callHostRpc } from "#/host/client";
import { type HostIssue, HostIssuePanel, toHostIssue } from "#/host/issues";
import { useBridgeSessionsListQuery } from "#/host/queries";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/ops")({ component: OpsPlayground });

type HostOperationCatalogEntry = HostOperationDefinition & { key: HostOperationKey };
const OPS = Object.values(hostOperations) as HostOperationCatalogEntry[];
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
  const requestSchema = selected ? requestJsonSchema(selected.key) : undefined;
  const sessionsQuery = useBridgeSessionsListQuery();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ops = q
      ? OPS.filter((op) =>
          [op.key, op.displayName, op.description, ...(op.searchTerms ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : OPS;
    return [...ops].sort((a, b) => a.key.localeCompare(b.key));
  }, [query]);

  function select(op: HostOperationCatalogEntry) {
    const nextSchema = requestJsonSchema(op.key);
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
          ? buildFormRequest(requestSchema, formValues)
          : args.trim()
            ? JSON.parse(args)
            : undefined;
      const data = await callHostRpc(selected.key, parsed, { bridgeSessionId });
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
            placeholder={`Search ${OPS.length} host ops...`}
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
            <li className="px-2 py-4 text-center text-xs text-muted-foreground">No ops match.</li>
          )}
        </ul>
      </aside>

      {/* Detail / runner */}
      <section className="min-h-0 overflow-y-auto p-4">
        {!selected ? (
          <p className="text-sm text-muted-foreground">
            Pick a host op. Calls the TS host via <code>/pe-host/rpc</code> (default{" "}
            <code>localhost:5180</code>). Start the host if requests 502.
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
                  value={formValues}
                  onChange={setFormValues}
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

function requestJsonSchema(
  key: HostOperationCatalogEntry["key"],
): HostOperationJsonSchema | undefined {
  const schemas = hostEffectOperationSchemas[key];
  const schema = "request" in schemas ? schemas.request : undefined;
  if (!schema) return undefined;
  try {
    return Schema.toJsonSchemaDocument(schema, { additionalProperties: true })
      .schema as HostOperationJsonSchema;
  } catch {
    return undefined;
  }
}

function JsonSchemaForm({
  schema,
  value,
  onChange,
}: {
  schema: HostOperationJsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const fields = schemaProperties(schema);
  const required = new Set(readStringArray(schema.required));
  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground">This operation has no request fields.</p>;
  }

  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      {fields.map(([name, fieldSchema]) => (
        <div key={name} className="grid gap-1">
          <Label htmlFor={`op-field-${name}`}>
            <span className="font-mono">{name}</span>
            {required.has(name) && <span className="ml-1 text-destructive">required</span>}
          </Label>
          <SchemaInput
            id={`op-field-${name}`}
            name={name}
            schema={fieldSchema}
            value={value[name]}
            onChange={(next) => onChange({ ...value, [name]: next })}
          />
        </div>
      ))}
    </div>
  );
}

function SchemaInput({
  id,
  name,
  schema,
  value,
  onChange,
}: {
  id: string;
  name: string;
  schema: HostOperationJsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const options = readEnum(schema);
  const type = readSchemaType(schema);

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
): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  for (const [name, fieldSchema] of schemaProperties(schema)) {
    const value = coerceFormValue(name, fieldSchema, values[name]);
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
