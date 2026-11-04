import { generatedJsonSchema } from "./decoders.ts";

export interface FixtureEntry {
  key: string;
  responseSchemaJson?: string;
  effect: string;
}

/** A catalog example is data, never an alternate implementation of an operation. */
export function createFixtureHost(
  catalog: readonly FixtureEntry[],
  examples: Readonly<Record<string, unknown>>,
) {
  const entries = new Map(catalog.map((entry) => [entry.key, entry]));
  const values = new Map<string, unknown>();
  for (const [key, example] of Object.entries(examples)) {
    const entry = entries.get(key);
    if (!entry) throw Error(`Fixture example is not in the catalog: ${key}`);
    if (entry.effect === "ModelWrite") throw Error(`Fixture cannot execute a model write: ${key}`);
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
  return {
    read(key: string, page?: unknown, work?: unknown) {
      if (!values.has(key)) throw Error(`Fixture has no response example: ${key}`);
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
        const { key } = (await request.json()) as { key: string };
        return Response.json(this.read(key));
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 409 });
      }
    },
  };
}
