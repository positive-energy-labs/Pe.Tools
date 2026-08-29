import type { OpsReceipt } from "@pe/agent-contracts";
import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
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
import { opViews } from "#/ops/op-views";
import { type HostOperationCatalogEntry } from "#/ops/product";
import { type OpsStore } from "#/ops/store";
import type { HostOperationJsonSchema } from "#/ops/route-workspace";
import {
  costTone,
  fieldOptionsKey,
  isRecord,
  readFormSeed,
  resolveSchema,
  scalarText,
  schemaProperties,
  schemaType,
} from "#/ops/schema-form";

export function OperationPane({
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
          <h1 className="">{operation.displayName ?? operation.key}</h1>
          <FactChip
            tone={operation.intent.toLowerCase() === "mutate" ? "caution" : "meta"}
            title={operation.intent.toLowerCase() === "mutate" ? "writes to Revit" : "read-only"}
          >
            {operation.intent}
          </FactChip>
          <FactChip tone={costTone(operation.costTier)} title="host-declared cost tier">
            {operation.costTier}
          </FactChip>
          {operation.needs !== "nothing" ? (
            <FactChip tone="caution" title="host-declared document requirement">
              {operation.needs}
            </FactChip>
          ) : null}
        </div>
        <p className="">{operation.key}</p>
        <p className="max-w-2xl">{operation.description}</p>
      </header>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="">Request</h2>
          <span className="flex gap-1">
            {operation.requestExamples.map((example) => (
              <Press
                key={example.name}
                size="xs"
                tone="neutral"
                title={example.description}
                onClick={() => {
                  setArgs(example.json);
                  setFormValues(readFormSeed(example.json, schema));
                }}
              >
                {example.name}
              </Press>
            ))}
            {schema ? (
              <Press
                size="xs"
                tone="bordered"
                onClick={() => setMode(mode === "form" ? "raw" : "form")}
              >
                {mode === "form" ? "raw" : "form"}
              </Press>
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
            className="min-h-32"
          />
        )}
      </section>

      {result ? (
        <section className="flex flex-col gap-2">
          <h2 className="">Result</h2>
          {Curated ? (
            <Curated data={result.value} opKey={operation.key} request={result.request} />
          ) : (
            <OutputBlock value={result.value} />
          )}
          {Curated ? (
            <details>
              <summary className="cursor-pointer">raw response</summary>
              <OutputBlock value={result.value} />
            </details>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

export function JsonSchemaForm({
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
  if (!fields.length) return <p className="">This operation has no request fields.</p>;
  return (
    <div className="grid gap-3 p-3">
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

export function SchemaInput({
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

export function OutputBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[32rem] overflow-auto p-3">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function parseSchema(json: string): HostOperationJsonSchema | undefined {
  try {
    const value: unknown = JSON.parse(json);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
