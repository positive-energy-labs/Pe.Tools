import { isWritePreviewKey } from "./semantic-actions.ts";
import { routeWorkSubject } from "./route-work-subject.ts";
import { z } from "zod";
import type { SchemaTable } from "./route-kernel-page.ts";
import {
  RouteGraphJson,
  type RouteDiagnostic,
  type ReadingDependencies,
  type LayoutJson,
} from "./route-kernel-data.ts";
import { canonicalRouteJson } from "./route-graph.ts";
import { bare } from "./route-field.ts";
import { linkCatalog, type CatalogLink } from "./catalog.ts";

const fn = z.custom<(...args: unknown[]) => unknown>((value) => typeof value === "function");
const schema = z.custom<z.ZodType>((value) => value instanceof z.ZodType);
const bodySchema = z.strictObject({
  slot: z.string(),
  kind: z.string(),
  source: z.strictObject({ module: z.string().min(1), export: z.string().min(1) }),
  run: fn,
});
export const routeBindingSchema = z.object({
  sources: z
    .record(
      z.string(),
      z
        .object({
          kind: z.enum(["use", "derive"]),
          open: fn.optional(),
          derive: fn.optional(),
          key: fn.optional(),
          effects: fn.optional(),
          dirties: z.array(z.string()).optional(),
          recovers: z.boolean().optional(),
        })
        .refine((source) => (source.kind === "use" ? !!source.open : !!source.derive)),
    )
    .default({}),
  schemas: z
    .custom<SchemaTable>(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        z.record(z.string(), schema).safeParse(Object.fromEntries(Object.entries(value))).success,
    )
    .transform((value): SchemaTable => ({ ...value })),
  codecs: z.record(z.string(), z.object({ encode: fn, decode: fn })),
  identities: z.record(
    z.string(),
    z.object({
      kind: z.enum(["local", "element", "document", "link"]),
      encode: fn,
      decode: fn,
      parts: fn,
    }),
  ),
  entries: z.record(
    z.string(),
    z.object({ input: schema, output: schema, axes: z.record(z.string(), z.unknown()) }),
  ),
  bodies: z.record(z.string(), bodySchema),
});
export type RouteBindings = z.output<typeof routeBindingSchema>;
export function routeDiagnostic(
  data: { key?: string; version?: number },
  path: string,
  reference: string,
  expected: string,
  message: string,
  code: RouteDiagnostic["code"] = "reference",
  source: RouteDiagnostic["source"] = null,
): RouteDiagnostic {
  return {
    path,
    reference,
    expected,
    message,
    code,
    source,
    namespace: data.key ?? "unknown",
    version: data.version ?? 1,
  };
}
export function decodeRouteGraph(
  input: unknown,
): { ok: true; data: RouteGraphJson } | { ok: false; diagnostics: RouteDiagnostic[] } {
  try {
    canonicalRouteJson(input);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [routeDiagnostic({}, "data", "", "JSON data", String(error), "schema")],
    };
  }
  const decoded = RouteGraphJson.safeParse(input);
  return decoded.success
    ? { ok: true, data: decoded.data }
    : {
        ok: false,
        diagnostics: decoded.error.issues.map((issue) =>
          routeDiagnostic({}, issue.path.join("."), "", "RouteGraphJson", issue.message, "schema"),
        ),
      };
}

/** Runtime half of BodySlots. Each reference is diagnosed at its declaration slot. */
export function linkRouteBodies(
  data: RouteGraphJson,
  bindings: RouteBindings,
  catalog: readonly CatalogLink[],
): RouteDiagnostic[] {
  const errors: RouteDiagnostic[] = [];
  const fail = (
    path: string,
    ref: string,
    expected: string,
    message: string,
    code: RouteDiagnostic["code"] = "reference",
  ) =>
    errors.push(
      routeDiagnostic(
        data,
        path,
        ref,
        expected,
        message,
        code,
        bindings.bodies[ref]?.source ?? null,
      ),
    );
  const reference = (table: object, ref: string | undefined, path: string, kind: string) => {
    if (ref !== undefined && !Object.hasOwn(table, ref))
      fail(path, ref, kind, `Unknown ${kind}: ${ref}`, "missing");
  };
  const slots = new Map<string, string>();
  const body = (id: string | undefined, path: string, kind: string) => {
    if (id === undefined) return;
    const previous = slots.get(id);
    if (previous) fail(path, id, kind, `Body already belongs to ${previous}`, "kind");
    slots.set(id, path);
    const binding = bindings.bodies[id];
    if (!binding) fail(path, id, kind, `Missing ${kind} body`, "missing");
    else if (binding.slot !== path || binding.kind !== kind)
      fail(
        path,
        id,
        kind,
        `Expected ${kind} at ${path}, got ${binding.kind} at ${binding.slot}`,
        "kind",
      );
  };
  const schemaRef = (id: string | undefined, path: string) =>
    reference(bindings.schemas, id, path, "schema");
  const requireCapability = (group: RouteGraphJson["capabilities"][number], path: string) => {
    if (!data.capabilities.includes(group))
      fail(path, group, "declared capability", `Missing ${group} capability`, "policy");
  };
  if (data.work) requireCapability("work", "work");
  if (data.capabilities.includes("work") && !data.work)
    fail("capabilities", "work", "Work declaration", "Work capability requires Work", "policy");
  schemaRef(data.historyDetail, "historyDetail");
  const workSchema = data.work?.schema && bindings.schemas[data.work.schema];
  const workObject = workSchema && bare(workSchema);
  const workKeys = workObject instanceof z.ZodObject ? workObject.shape : {};
  const deps = (d: ReadingDependencies, path: string) => {
    for (const group of ["page", "work", "readings"] as const) {
      const table = group === "page" ? data.fields : group === "work" ? workKeys : data.readings;
      d[group].forEach((key, i) =>
        reference(table, key, `${path}.${group}.${i}`, `${group} dependency`),
      );
      if (new Set(d[group]).size !== d[group].length)
        fail(`${path}.${group}`, "", "distinct dependencies", "Duplicate dependency");
    }
  };
  const list = (table: object, ids: readonly string[], path: string, kind: string) =>
    ids.forEach((id, i) => reference(table, id, `${path}.${i}`, kind));
  if (
    Object.values(data.fields).filter((f) => f.role === "subject").length !== 1 ||
    data.fields[data.subject.field]?.role !== "subject"
  )
    fail("subject.field", data.subject.field, "one subject field", "Declare exactly one subject");
  if (Object.values(data.fields).filter((f) => f.role === "selection").length !== 1)
    fail("fields", "", "one selection field", "Declare exactly one selection");
  reference(data.panes, data.subject.pane, "subject.pane", "pane");
  reference(data.readings, data.subject.roster, "subject.roster", "reading");
  reference(data.readings, data.subject.detail, "subject.detail", "reading");
  body(data.subject.show, "subject.show", "show");
  body(data.subjectText, "subjectText", "subject");
  body(data.transition, "transition", "transition");
  if (data.transitionDeps) {
    deps(data.transitionDeps, "transitionDeps");
    if (!data.transition)
      fail("transitionDeps", "", "transition body", "Dependencies require transition");
  }
  body(data.salvage, "salvage", "salvage");
  body(data.salvagePresent, "salvagePresent", "present");
  if (data.salvageDeps) {
    deps(data.salvageDeps, "salvageDeps");
    if (!data.salvagePresent)
      fail("salvageDeps", "", "salvage presentation", "Dependencies require salvagePresent");
  }
  if (data.salvagePresent && !data.salvage)
    fail("salvagePresent", "", "salvage body", "Presentation requires salvage");
  for (const [key, identity] of Object.entries(data.identities)) {
    reference(bindings.identities, identity.codec, `identities.${key}.codec`, "identity codec");
    if (bindings.identities[identity.codec]?.kind !== identity.kind)
      fail(
        `identities.${key}.kind`,
        identity.codec,
        identity.kind,
        "Identity codec kind mismatch",
        "identity",
      );
  }
  for (const [key, field] of Object.entries(data.fields)) {
    const path = `fields.${key}`;
    if (field.role === "selection") {
      list(data.identities, field.kinds, `${path}.kinds`, "identity");
      continue;
    }
    schemaRef(field.schema, `${path}.schema`);
    reference(bindings.codecs, field.codec, `${path}.codec`, "codec");
    const s = bindings.schemas[field.schema];
    if (s && !s.safeParse(field.initial).success)
      fail(`${path}.initial`, field.schema, "field value", "Initial value fails schema", "schema");
    if (s && bare(s).def.type === "array")
      fail(
        `${path}.schema`,
        field.schema,
        "scalar or named kernel collection",
        "Bare arrays are not Page fields",
        "schema",
      );
    const codec = bindings.codecs[field.codec];
    if (s && codec) {
      try {
        const encoded = codec.encode(field.initial);
        const result = z
          .discriminatedUnion("ok", [
            z.object({ ok: z.literal(true), value: z.unknown() }),
            z.object({ ok: z.literal(false), reason: z.string() }),
          ])
          .safeParse(typeof encoded === "string" ? codec.decode(encoded) : null);
        if (
          !result.success ||
          !result.data.ok ||
          !s.safeParse(result.data.value).success ||
          canonicalRouteJson(result.data.value) !== canonicalRouteJson(field.initial)
        )
          fail(
            `${path}.codec`,
            field.codec,
            "lossless field codec",
            "Initial value does not round-trip",
            "schema",
          );
      } catch (error) {
        fail(`${path}.codec`, field.codec, "lossless field codec", String(error), "schema");
      }
    }
    if (field.role === "stage") {
      const unwrapped = s && bare(s);
      if (
        !(unwrapped instanceof z.ZodEnum) ||
        canonicalRouteJson(
          [...unwrapped.options].sort((a, b) =>
            String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
          ),
        ) !== canonicalRouteJson(Object.keys(data.stages).sort())
      )
        fail(
          `${path}.schema`,
          field.schema,
          "stage enum",
          "Stage schema must exactly match stage ids",
          "schema",
        );
    }
    if (field.role === "subject") {
      list(
        data.identities,
        typeof field.identity === "string" ? [field.identity] : field.identity,
        `${path}.identity`,
        "identity",
      );
      if (Array.isArray(field.identity) && new Set(field.identity).size !== field.identity.length)
        fail(
          `${path}.identity`,
          "",
          "distinct identities",
          "Duplicate subject identity",
          "identity",
        );
      reference(data.readings, field.picker.reading, `${path}.picker.reading`, "reading");
      body(field.picker.options, `${path}.picker.options`, "picker");
      if (s) validateSubjectSchema(field, s, fail, path);
    }
  }
  if (data.work?.schema) {
    schemaRef(data.work.schema, "work.schema");
    if (!(workObject instanceof z.ZodObject))
      fail(
        "work.schema",
        data.work.schema,
        "object schema",
        "Work needs finite top-level keys",
        "schema",
      );
    if (data.work.route !== data.key)
      fail(
        "work.route",
        data.work.route,
        data.key,
        "Work belongs to its declaring route",
        "policy",
      );
    for (let version = 1; version < data.work.version; version++)
      if (!Object.hasOwn(data.work.migrations, String(version)))
        fail(
          `work.migrations.${version}`,
          "",
          "migration",
          "Incomplete migration chain",
          "missing",
        );
    for (const [version, id] of Object.entries(data.work.migrations)) {
      if (Number(version) >= data.work.version)
        fail(
          `work.migrations.${version}`,
          id,
          "older version",
          "Migration exceeds current version",
        );
      body(id, `work.migrations.${version}`, "migration");
    }
  }
  const linked = new Map(catalog.map((entry) => [entry.key, entry]));
  for (const message of linkCatalog(catalog))
    fail("entries", "", "linked catalog", message, "policy");
  const checkEffects = (key: string, path: string, read: boolean, seen = new Set<string>()) => {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = linked.get(key);
    if (!entry) return;
    if (entry.touches.includes("Geometry")) requireCapability("geometry", path);
    if (entry.effect !== "Read" && entry.effect !== "TransactRead") {
      requireCapability("native-write", path);
      if (read)
        fail(path, key, "read closure", "A reading/query dependency cannot write", "policy");
    }
    for (const child of entry.uses)
      checkEffects(typeof child === "string" ? child : child.key, path, read, seen);
    if (entry.previewBy) checkEffects(entry.previewBy, path, true, seen);
  };
  const entryRef = (key: string, path: string, read: boolean) => {
    reference(bindings.entries, key, path, "entry");
    checkEffects(key, path, read);
    const entry = linked.get(key);
    if (!entry)
      fail(path, key, "linked catalog entry", "Entry is absent from admitted catalog", "missing");
    else {
      const {
        key: _key,
        uses: _uses,
        previewBy: _previewBy,
        derive: _derive,
        preview: _preview,
        ...axes
      } = entry;
      if (
        bindings.entries[key] &&
        canonicalRouteJson(bindings.entries[key].axes) !== canonicalRouteJson(axes)
      )
        fail(path, key, "catalog axes", "Entry axes differ from linked catalog", "policy");
      if (read && entry.effect !== "Read" && entry.effect !== "TransactRead")
        fail(path, key, "read entry", "A reading/query cannot write", "policy");
    }
  };
  for (const key of Object.keys(bindings.entries)) entryRef(key, `entries.${key}`, false);
  for (const [key, reading] of Object.entries(data.readings)) {
    const path = `readings.${key}`;
    deps(reading.deps, `${path}.deps`);
    if (reading.kind === "work") {
      schemaRef(reading.output, `${path}.output`);
    } else if (reading.kind === "derive") {
      schemaRef(reading.output, `${path}.output`);
      body(reading.derive, `${path}.derive`, "derive");
    } else {
      entryRef(reading.entry, `${path}.entry`, true);
      if (reading.kind === "use") body(reading.args, `${path}.args`, "args");
      else body(reading.adapter, `${path}.adapter`, "adapter");
    }
  }
  const closures = new Map<string, Set<string>>();
  const visit = (id: string, active: Set<string>): Set<string> => {
    if (active.has(id)) {
      fail(
        `readings.${id}.deps.readings`,
        id,
        "acyclic readings",
        "Reading dependency cycle",
        "cycle",
      );
      return new Set();
    }
    const cached = closures.get(id);
    if (cached) return cached;
    const found = new Set([id]);
    const next = new Set([...active, id]);
    for (const child of data.readings[id]?.deps.readings ?? [])
      for (const member of visit(child, next)) found.add(member);
    closures.set(id, found);
    return found;
  };
  const geometryEntry = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const entry = linked.get(id);
    // Journal plans (a Read, or a rehearsal that rolls back) own their reads; Touches does not select the geometry door.
    if (
      isWritePreviewKey(id) &&
      (entry?.effect === "Read" || (entry?.effect === "TransactRead" && entry.rollsBack))
    )
      return false;
    return (
      !!entry &&
      (entry.touches.includes("Geometry") ||
        entry.uses.some((use) => geometryEntry(typeof use === "string" ? use : use.key, seen)))
    );
  };
  for (const [key, reading] of Object.entries(data.readings)) {
    const closure = visit(key, new Set());
    if (
      reading.kind !== "derive" && reading.kind !== "work" &&
      geometryEntry(reading.entry) &&
      (reading.kind !== "use" || !reading.geometry)
    )
      fail(
        `readings.${key}.geometry`,
        reading.entry,
        "geometry policy",
        "Geometry dependency requires an explicit policy",
        "policy",
      );
    if (reading.kind === "use" && reading.geometry) {
      if (reading.geometry.entry !== reading.entry)
        fail(
          `readings.${key}.geometry.entry`,
          reading.geometry.entry,
          reading.entry,
          "Geometry policy must bind the actual entry",
          "policy",
        );
      if (reading.geometry.representation === "detailed") {
        const overview = data.readings[reading.geometry.overview];
        if (overview?.kind !== "use" || overview.geometry?.representation !== "overview")
          fail(
            `readings.${key}.geometry.overview`,
            reading.geometry.overview,
            "overview reading",
            "Detail requires an overview",
            "policy",
          );
      }
    }
    if (
      reading.demand !== "explicit" ||
      reading.refresh !== "explicit" ||
      (reading.kind === "use" && reading.geometry?.representation === "overview")
    )
      for (const dep of closure) {
        const child = data.readings[dep];
        if (child?.kind === "use" && child.geometry?.representation === "detailed")
          fail(
            `readings.${key}.deps.readings`,
            dep,
            "overview-only automatic closure",
            "Automatic reading reaches detailed geometry",
            "policy",
          );
      }
  }
  const chords = new Set<string>();
  for (const [key, verb] of Object.entries(data.verbs)) {
    const path = `verbs.${key}`;
    if (key === "work.start-fresh" || key === "work.salvage")
      fail(path, key, "authored verb", "Recovery verbs are kernel reserved", "policy");
    deps(verb.deps, `${path}.deps`);
    schemaRef(verb.input, `${path}.input`);
    list(data.readings, verb.captures, `${path}.captures`, "reading");
    body(verb.ready, `${path}.ready`, "ready");
    body(verb.present, `${path}.present`, "present");
    if (verb.chord) {
      if (chords.has(verb.chord))
        fail(`${path}.chord`, verb.chord, "unique chord", "Chord collision");
      chords.add(verb.chord);
    }
    switch (verb.kind) {
      case "work":
        if (!data.work) fail(path, key, "Work", "Work verb requires Work");
        body(verb.patches, `${path}.patches`, "work");
        body(verb.describe, `${path}.describe`, "describe");
        break;
      case "page":
        body(verb.patch, `${path}.patch`, "page");
        for (const field of verb.fields)
          if (!["query", "draft"].includes(data.fields[field]?.role ?? ""))
            fail(
              `${path}.fields`,
              field,
              "query or draft",
              "Page verbs cannot write this role",
              "policy",
            );
        break;
      case "command":
        entryRef(verb.entry, `${path}.entry`, false);
        body(verb.intent, `${path}.intent`, "intent");
        body(verb.lands, `${path}.lands`, "lands");
        break;
      case "query":
        entryRef(verb.entry, `${path}.entry`, true);
        body(verb.args, `${path}.args`, "args");
        body(verb.lands, `${path}.lands`, "lands");
        break;
    }
  }
  for (const [key, pane] of Object.entries(data.panes)) {
    const path = `panes.${key}`;
    list(data.readings, pane.draws, `${path}.draws`, "reading");
    body(pane.body, `${path}.body`, "pane");
    if ((pane.body !== undefined) === (pane.history !== undefined))
      fail(path, key, "pane body or history", "Exactly one renderer is required");
    reference(data.readings, pane.history?.receipts, `${path}.history.receipts`, "reading");
    if ("choose" in pane.verbs) {
      body(pane.verbs.choose, `${path}.verbs.choose`, "placement");
      schemaRef(pane.verbs.row, `${path}.verbs.row`);
      list(data.verbs, pane.verbs.allowed, `${path}.verbs.allowed`, "verb");
    } else list(data.verbs, pane.verbs, `${path}.verbs`, "verb");
  }
  const layoutIds = new Set<string>();
  const layout = (node: LayoutJson, path: string) => {
    if (node.kind === "pane") reference(data.panes, node.id, `${path}.id`, "pane");
    else if (node.kind === "gate") {
      reference(data.predicates, node.when, `${path}.when`, "predicate");
      layout(node.child, `${path}.child`);
    } else {
      if (layoutIds.has(node.id)) fail(`${path}.id`, node.id, "unique split", "Duplicate split id");
      layoutIds.add(node.id);
      node.children.forEach((child, i) => layout(child, `${path}.children.${i}`));
    }
  };
  layout(data.layout, "layout");
  if (
    canonicalRouteJson([...data.stageOrder].sort()) !==
    canonicalRouteJson(Object.keys(data.stages).sort())
  )
    fail("stageOrder", "", "all stages exactly once", "Stage order mismatch");
  for (const [id, stage] of Object.entries(data.stages)) {
    list(data.panes, stage.panes, `stages.${id}.panes`, "pane");
    list(data.verbs, stage.verbs, `stages.${id}.verbs`, "verb");
  }
  for (const [id, ref] of Object.entries(data.predicates))
    body(ref, `predicates.${id}`, "predicate");
  for (const [id, seed] of Object.entries(data.seeds)) body(seed.load, `seeds.${id}.load`, "seed");
  for (const [id, cell] of Object.entries(data.cells)) {
    const path = `cells.${id}`;
    if (cell.segment !== null) reference(workKeys, cell.segment, `${path}.segment`, "Work segment");
    schemaRef(cell.key, `${path}.key`);
    schemaRef(cell.value, `${path}.value`);
    deps(cell.deps, `${path}.deps`);
    body(cell.groupOf, `${path}.groupOf`, "group");
    for (const key of ["show", "label", "focus", "take", "admit"] as const)
      body(cell[key], `${path}.${key}`, key);
  }
  list(workKeys, Object.keys(data.workFields), "workFields", "Work field");
  list(data.fields, data.resetOnTarget, "resetOnTarget", "field");
  list(data.readings, data.observe, "observe", "reading");
  reference(data.verbs, data.refresh, "refresh", "verb");
  reference(data.fields, data.workSubject, "workSubject", "field");
  reference(data.fields, data.capture, "capture", "field");
  if (data.workSubject && !data.work)
    fail(
      "workSubject",
      data.workSubject,
      "Work",
      "Only a route with Work can select it by subject",
    );
  if (data.workSubject) {
    try {
      routeWorkSubject(
        data,
        bindings,
        Object.fromEntries(
          Object.entries(data.fields).map(([key, field]) => [
            key,
            "initial" in field ? field.initial : null,
          ]),
        ),
      );
    } catch (error) {
      fail("workSubject", data.workSubject, "decoded Work key", String(error), "identity");
    }
  }
  for (const id of Object.keys(bindings.bodies))
    if (!slots.has(id)) fail(`bodies.${id}`, id, "referenced body", "Unreferenced body", "extra");
  return errors;
}

function validateSubjectSchema(
  field: Extract<RouteGraphJson["fields"][string], { role: "subject" }>,
  schema: z.ZodType,
  fail: (
    path: string,
    ref: string,
    expected: string,
    message: string,
    code?: RouteDiagnostic["code"],
  ) => unknown,
  path: string,
) {
  const tagged = (value: z.ZodType) => {
    const alternatives = new Map<string, z.ZodObject>();
    if (value instanceof z.ZodUnion)
      for (const option of value.options)
        if (option instanceof z.ZodObject && option.shape.kind instanceof z.ZodLiteral)
          for (const key of option.shape.kind.values)
            if (typeof key === "string") alternatives.set(key, option);
    return alternatives;
  };
  let memberSchema = bare(schema);
  if (field.cardinality === "many") {
    const alternatives = tagged(memberSchema);
    const ids = alternatives.get("ids")?.shape.ids;
    if (
      canonicalRouteJson([...alternatives.keys()].sort()) !== '["all","ids"]' ||
      !(ids instanceof z.ZodArray)
    )
      fail(
        `${path}.schema`,
        field.schema,
        "kernel Many",
        "Many subjects require the ids/all tagged union",
        "identity",
      );
    if (ids instanceof z.ZodArray && ids.element instanceof z.ZodType) memberSchema = ids.element;
  }
  if (typeof field.identity !== "string") {
    const kinds = [...tagged(memberSchema).keys()].sort();
    if (canonicalRouteJson(kinds) !== canonicalRouteJson([...field.identity].sort()))
      fail(
        `${path}.schema`,
        field.schema,
        "declared identity alternatives",
        "Mixed-subject tags differ from declared identities",
        "identity",
      );
  }
  const wrap = (value: unknown) =>
    field.cardinality === "many" ? { kind: "ids", ids: [value] } : value;
  const invalid =
    typeof field.identity === "string"
      ? "invalid-identity"
      : { kind: "undeclared-kind", id: "invalid" };
  if (
    schema.safeParse(wrap(invalid)).success ||
    !schema.safeParse(field.cardinality === "many" ? { kind: "all" } : null).success ||
    schema.safeParse([]).success
  )
    fail(
      `${path}.schema`,
      field.schema,
      "kernel subject cardinality and identity",
      "Subject schema accepts invalid identity or rejects kernel shape",
      "identity",
    );
}
