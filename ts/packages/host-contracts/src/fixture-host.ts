import { generatedJsonSchema, nativeRequestSchema, nativeResponseSchema } from "./decoders.ts";
import { hostOpCatalog } from "./generated/host-catalog.generated.ts";
import type { HostOperationKey } from "./operation-types.ts";

export interface FixtureEntry {
  key: string;
  responseSchemaJson?: string;
  effect: string;
}

export interface RecordedNativeFixtures {
  readonly sources: Readonly<Record<string, string>>;
  readonly actionLeaves: (action: string) => readonly string[] | undefined;
}

/** A catalog example is data, never an alternate implementation of an operation. */
export function createFixtureHost(
  catalog: readonly FixtureEntry[],
  examples: Readonly<Record<string, unknown>>,
  recorded?: RecordedNativeFixtures,
) {
  const entries = new Map(catalog.map((entry) => [entry.key, entry]));
  const values = new Map<string, unknown>();
  for (const [key, example] of Object.entries(examples)) {
    const entry = entries.get(key);
    if (!entry) throw Error(`Fixture example is not in the catalog: ${key}`);
    if (entry.effect === "ModelWrite" && !recorded)
      throw Error(`Fixture cannot execute a model write: ${key}`);
    if (recorded) {
      if (!recorded.sources[key]) throw Error(`UNPROVEN[no recording]: ${key}`);
      if (!hostOpCatalog.some(op => op.key === key))
        throw Error(`Fixture native operation is not in the generated catalog: ${key}`);
      values.set(key, example);
      continue;
    }
    const schema = entry.responseSchemaJson
      ? generatedJsonSchema(JSON.parse(entry.responseSchemaJson))
      : null;
    values.set(
      key,
      typeof example === "function" ||
        (example && typeof example === "object" && "fixtureSelect" in example)
        ? example
        : schema
          ? schema.parse(example)
          : example,
    );
  }
  const admit = (action: string, key: string, request: unknown) => {
    if (!recorded) throw Error("Fixture native replay requires recorded sources");
    if (!hostOpCatalog.some(op => op.key === key))
      throw Error(`Fixture native operation is not in the generated catalog: ${key}`);
    if (!recorded.actionLeaves(action)?.includes(key))
      throw Error(`Command '${action}' does not declare native leaf '${key}'`);
    return nativeRequestSchema(key as HostOperationKey).parse(request);
  };
  return {
    admit,
    // Recorded replies prove wiring/admission only; Revit semantics require fresh/session proof.
    reply(action: string, key: string, request: unknown) {
      admit(action, key, request);
      if (!recorded!.sources[key] || !values.has(key))
        throw Error(`UNPROVEN[no recording]: ${key}`);
      return nativeResponseSchema(key as HostOperationKey).parse(values.get(key));
    },
    read(key: string, page?: unknown, work?: unknown) {
      if (!values.has(key)) throw Error(`Fixture has no response example: ${key}`);
      if (entries.get(key)?.effect === "ModelWrite")
        throw Error(`Fixture cannot execute a model write: ${key}`);
      let value = values.get(key);
      if (typeof value === "function") value = value(page, work);
      else if (value && typeof value === "object" && "fixtureSelect" in value) {
        const {
          fields,
          values: choices,
          fallback,
        } = value.fixtureSelect as {
          fields: string[];
          values: Record<string, unknown>;
          fallback: unknown;
        };
        value =
          choices[
            JSON.stringify(fields.map((field) => (page as Record<string, unknown>)[field]))
          ] ?? fallback;
      }
      const schema = entries.get(key)!.responseSchemaJson;
      // Derived graph readings can own decoded geometry with prototype getters. Only wire
      // responses cross a JSON/schema boundary; cloning graph values erases those prototypes.
      return schema ? generatedJsonSchema(JSON.parse(schema)).parse(value) : value;
    },
    async fetch(request: Request): Promise<Response> {
      if (new URL(request.url).pathname !== "/call" || request.method !== "POST")
        return Response.json(
          { error: "Fixture serves catalog reads through POST /call only" },
          { status: 404 },
        );
      try {
        const { key, action, request: input } = (await request.json()) as { key: string; action?: string; request?: unknown };
        return Response.json(recorded ? this.reply(action ?? "", key, input) : this.read(key));
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 409 });
      }
    },
  };
}
