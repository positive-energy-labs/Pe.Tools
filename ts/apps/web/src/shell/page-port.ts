import {
  identityCodecs,
  identityPartSchema,
  decodeFailure,
} from "../../../../packages/agent-contracts/src/route-kernel-codecs.ts";
export { identityCodecs } from "../../../../packages/agent-contracts/src/route-kernel-codecs.ts";
import { z } from "zod";
import { deepEqual } from "@tanstack/react-router";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import {
  InvocationToken,
  LeaseToken,
  RestoreToken,
  ScopeToken,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type {
  DecodeResult,
  FieldControls,
  MoveOrigin,
  MoveResult,
  PageOf,
  PageOwner,
  PagePort,
  SchemaTable,
  SelectionItem,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";

const selectionItem = z.strictObject({ kind: identityPartSchema, id: identityPartSchema });
const selectionShape = z.array(selectionItem);
type Item = z.output<typeof selectionItem>;

/** Fixed shape and kind-specific identity validation; membership is evidence, not syntax. */
export function selectionCodec<
  G extends RouteGraphJson,
  const K extends readonly string[],
  All extends boolean = false,
>(graph: G, kinds: K, allowAll: All = false as All) {
  type Selected = Extract<SelectionItem<G>, { kind: K[number] }>;
  const isSelected = (item: Item): item is Selected => {
    const identity = Object.hasOwn(graph.identities, item.kind)
      ? graph.identities[item.kind]
      : undefined;
    return (
      !!identity && kinds.includes(item.kind) && identityCodecs[identity.kind].decode(item.id).ok
    );
  };
  type Value = readonly Selected[] | (All extends true ? "all" : never);
  const normalize = (value: unknown): DecodeResult<Value> => {
    if (allowAll && value === "all") return { ok: true, value: "all" as Value };
    const parsed = selectionShape.safeParse(value);
    if (!parsed.success) return decodeFailure("Selection must be an array of {kind,id}");
    const seen = new Set<string>();
    const items: Selected[] = [];
    for (const item of parsed.data) {
      if (!isSelected(item)) return decodeFailure(`Invalid ${item.kind} identity`);
      const key = JSON.stringify([item.kind, item.id]);
      if (!seen.has(key)) items.push(item);
      seen.add(key);
    }
    return { ok: true, value: freezePage(items) };
  };
  return Object.freeze({
    normalize,
    encode(value: unknown): DecodeResult<string> {
      const result = normalize(value);
      return result.ok
        ? { ok: true, value: result.value === "all" ? "all" : JSON.stringify(result.value) }
        : result;
    },
    decode(text: string): DecodeResult<Value> {
      try {
        return normalize(text === "all" ? text : JSON.parse(text));
      } catch {
        return decodeFailure("Invalid selection JSON");
      }
    },
  });
}

/** Clone before freezing, so callers retain ownership of their inputs. Page values are data. */
export function freezePage<T>(value: T): T {
  const clone: T = structuredClone(value);
  const freeze = (part: unknown): void => {
    if (part && typeof part === "object" && !Object.isFrozen(part)) {
      for (const child of Object.values(part)) freeze(child);
      Object.freeze(part);
    }
  };
  freeze(clone);
  return clone;
}

// Reject unsafe keys before Zod's record parser drops __proto__ from its output.
const record = z
  .unknown()
  .refine((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return (
      (prototype === Object.prototype || prototype === null) &&
      Reflect.ownKeys(value).every(
        (key) =>
          typeof key === "string" &&
          key !== "__proto__" &&
          key !== "constructor" &&
          key !== "prototype" &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"),
      )
    );
  })
  .pipe(z.record(z.string(), z.unknown()));
const originSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("human"),
    source: z.enum([
      "subject",
      "stage",
      "selection",
      "setting",
      "pose",
      "query",
      "draft",
      "device",
      "transient",
    ]),
    history: z.enum(["push", "replace"]),
  }),
  z.strictObject({
    kind: z.literal("restore"),
    source: z.enum(["url", "tab", "initial"]),
    token: z.custom<RestoreToken>((value) => value instanceof RestoreToken),
  }),
  z.strictObject({
    kind: z.literal("pea"),
    lease: z.custom<LeaseToken>((value) => value instanceof LeaseToken),
  }),
  z.strictObject({
    kind: z.literal("invocation"),
    token: z.custom<InvocationToken>((value) => value instanceof InvocationToken),
    purpose: z.enum(["review", "result"]),
  }),
  z.strictObject({
    kind: z.literal("scope"),
    token: z.custom<ScopeToken>((value) => value instanceof ScopeToken),
  }),
]);

export type PagePreparation<G extends RouteGraphJson, S extends SchemaTable> = DecodeResult<{
  readonly page: PageOf<G, S>;
  readonly changed: boolean;
  readonly membership: "verified" | "unresolved";
}>;

/** Pure policy for B's acceptance owner. No registry, revision counter or second Page store.
 * TODO: S1 wires prepare into the acceptance owner's single synchronous commit, after token checks,
 * restores presence-aware URL/tab values, and routes setting edits to the existing settings owner. */
export function createPagePolicy<G extends RouteGraphJson, S extends SchemaTable>(
  graph: G,
  schemas: S,
  membership: (page: PageOf<G, S>) => "verified" | "unresolved" | { readonly reason: string },
  transition?: (current: PageOf<G, S>, patch: unknown, origin: MoveOrigin) => DecodeResult<unknown>,
  fixtureDefaults: unknown = {},
) {
  const fields = Object.entries(graph.fields);
  const subject = fields.filter(([, field]) => field.role === "subject");
  const selection = fields.filter(([, field]) => field.role === "selection");
  if (subject.length !== 1 || selection.length !== 1)
    throw new Error("Page requires one subject and one selection");
  const subjectKey = subject[0]![0];
  const selectionKey = selection[0]![0];
  const role = (key: string) =>
    Object.hasOwn(graph.fields, key) ? graph.fields[key]?.role : undefined;

  const decodeField = (key: string, value: unknown): DecodeResult<unknown> => {
    const field = graph.fields[key];
    if (!field) return decodeFailure(`Unknown Page field: ${key}`);
    if (field.role === "selection")
      return selectionCodec(graph, field.kinds, field.allowAll === true).normalize(value);
    const parsed = schemas[field.schema]?.safeParse(value);
    if (!parsed?.success) return decodeFailure(`Invalid Page field: ${key}`);
    if (field.role === "subject") {
      const identities = typeof field.identity === "string" ? [field.identity] : field.identity;
      const check = (id: unknown) => {
        if (typeof field.identity !== "string")
          return selectionCodec(graph, identities).normalize([id]).ok;
        const identity = graph.identities[field.identity];
        return typeof id === "string" && !!identity && identityCodecs[identity.kind].decode(id).ok;
      };
      if (field.cardinality === "one") {
        if (parsed.data !== null && !check(parsed.data))
          return decodeFailure(`Invalid subject identity: ${key}`);
      } else {
        const many = z
          .union([
            z.strictObject({ kind: z.literal("all") }),
            z.strictObject({
              kind: z.literal("ids"),
              ids: z.array(z.unknown()),
              active: z.unknown().optional(),
            }),
          ])
          .safeParse(parsed.data);
        if (
          !many.success ||
          (many.data.kind === "ids" &&
            (!many.data.ids.every(check) ||
              (many.data.active !== undefined && !check(many.data.active))))
        )
          return decodeFailure(`Invalid subject set: ${key}`);
      }
    }
    return { ok: true, value: parsed.data };
  };
  // This predicate checks every field before assigning the generic PageOf type.
  const isPage = (value: unknown): value is PageOf<G, S> => {
    const parsed = record.safeParse(value);
    return (
      parsed.success &&
      Object.keys(parsed.data).length === fields.length &&
      fields.every(
        ([key]) => Object.hasOwn(parsed.data, key) && decodeField(key, parsed.data[key]).ok,
      )
    );
  };
  const decode = (input: unknown): DecodeResult<PageOf<G, S>> => {
    const parsed = record.safeParse(input);
    if (!parsed.success || Object.keys(parsed.data).some((key) => !role(key)))
      return decodeFailure("Invalid Page fields");
    const out: Record<string, unknown> = {};
    for (const [key] of fields) {
      if (!Object.hasOwn(parsed.data, key)) return decodeFailure(`Missing Page field: ${key}`);
      const result = decodeField(key, parsed.data[key]);
      if (!result.ok) return result;
      out[key] = result.value;
    }
    return isPage(out) ? { ok: true, value: freezePage(out) } : decodeFailure("Invalid Page");
  };
  const fixture = record.safeParse(structuredClone(fixtureDefaults));
  const defaultFailure =
    !fixture.success ||
    Object.keys(fixture.data).some(
      (key) => !role(key) || ["setting", "device", "transient"].includes(role(key)!),
    )
      ? "Invalid fixture Page defaults"
      : null;
  const defaults = () => ({
    ...Object.fromEntries(
      fields.map(([key, field]) => [key, field.role === "selection" ? [] : field.initial]),
    ),
    ...(fixture.success ? fixture.data : {}),
  });
  type RestoreState = Parameters<PageOwner<G, S>["restorePage"]>[0];
  const isRestoreState = (input: Record<string, unknown>): input is RestoreState =>
    Object.hasOwn(input, subjectKey) &&
    Object.hasOwn(input, selectionKey) &&
    Object.keys(input).every((key) =>
      ["subject", "selection", "pose", "stage", "query", "draft"].includes(role(key) ?? ""),
    );
  const prepare = (
    current: PageOf<G, S>,
    patch: unknown,
    origin: MoveOrigin,
    runTransition = true,
  ): PagePreparation<G, S> => {
    if (!originSchema.safeParse(origin).success)
      return decodeFailure("Missing or invalid move origin");
    const parsed = record.safeParse(patch);
    if (!parsed.success) return decodeFailure("Invalid Page patch");
    const entries = Object.entries(parsed.data);
    for (const [key] of entries) {
      const r = role(key);
      if (!r || key === "__proto__" || key === "constructor")
        return decodeFailure(`Unknown Page field: ${key}`);
      if (origin.kind === "human" && r !== origin.source)
        return decodeFailure(`Human ${origin.source} cannot write ${key}`);
      if (
        origin.kind === "restore" &&
        !["subject", "selection", "pose", "stage", "query", "draft"].includes(r)
      )
        return decodeFailure(`Restore cannot write ${key}`);
      if (
        origin.kind === "pea" &&
        (r === "device" ||
          r === "transient" ||
          ("agent" in graph.fields[key]! && graph.fields[key]!.agent !== "set"))
      )
        return decodeFailure(`Pea cannot write ${key}`);
    }
    if (
      origin.kind === "restore" &&
      (!Object.hasOwn(parsed.data, subjectKey) || !Object.hasOwn(parsed.data, selectionKey))
    )
      return decodeFailure("Restore requires subject and selection together");
    if (transition && runTransition) {
      // Validate the proposed patch before route code, then validate its returned patch identically.
      const proposed = prepare(current, patch, origin, false);
      if (!proposed.ok) return proposed;
      const adjusted = transition(current, freezePage(parsed.data), origin);
      return adjusted.ok ? prepare(current, adjusted.value, origin, false) : adjusted;
    }
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of entries) {
      const decoded = decodeField(key, value);
      if (!decoded.ok) return decoded;
      next[key] = decoded.value;
    }
    if (origin.kind !== "restore" && !deepEqual(current[subjectKey], next[subjectKey])) {
      next[selectionKey] = [];
      for (const [key, field] of fields) if (field.role === "pose") next[key] = field.initial;
    } else if (
      origin.kind !== "restore" &&
      !deepEqual(current[selectionKey], next[selectionKey]) &&
      fields.some(([key, field]) => field.role === "pose" && !deepEqual(current[key], next[key]))
    ) {
      return decodeFailure("Selection and pose are separate moves");
    }
    const result = decode(next);
    if (!result.ok) return result;
    const checked = membership(result.value);
    if (typeof checked !== "string") return decodeFailure(checked.reason);
    return {
      ok: true,
      value: {
        page: result.value,
        changed: !deepEqual(current, result.value),
        membership: checked,
      },
    };
  };
  return Object.freeze({
    decode,
    initial: () => (defaultFailure ? decodeFailure(defaultFailure) : decode(defaults())),
    /** Inputs are decoded fields with presence retained. Empty values are never absence. */
    restoreState(url: unknown, memory: unknown): DecodeResult<RestoreState> {
      if (defaultFailure) return decodeFailure(defaultFailure);
      const u = record.safeParse(url);
      const m = record.safeParse(memory);
      if (!u.success || !m.success) return decodeFailure("Invalid restore fields");
      for (const input of [u.data, m.data]) {
        if (
          Object.keys(input).some(
            (key) => !role(key) || ["setting", "device", "transient"].includes(role(key)!),
          )
        )
          return decodeFailure("Field cannot be restored");
      }
      const decoded = decode({ ...defaults(), ...m.data, ...u.data });
      if (!decoded.ok) return decoded;
      const restored = Object.fromEntries(
        Object.entries(decoded.value).filter(
          ([key]) => !["setting", "device", "transient"].includes(role(key)!),
        ),
      );
      return isRestoreState(restored)
        ? { ok: true, value: freezePage(restored) }
        : decodeFailure("Invalid restore");
    },
    prepare,
  });
}

const refused = (message: string): MoveResult => ({ kind: "refused", code: "page-role", message });

/** The returned objects contain only their capabilities, including for untyped JS callers.
 * TODO: S1 gives panes only page; chrome keeps controls and the lease bridge uses owner snapshots. */
export function createPagePorts<G extends RouteGraphJson, S extends SchemaTable>(
  graph: G,
  owner: PageOwner<G, S> & { readPage(): PageOf<G, S> },
): { readonly page: PagePort<G, S>; readonly controls: FieldControls<G, S> } {
  return createRolePagePorts(graph.fields, owner);
}

/** Applies the same role boundary to legacy mounts without fabricating an admitted graph. */
export function createRolePagePorts<P>(
  fields: Readonly<Record<string, { readonly role: string }>>,
  owner: {
    readPage(): P;
    movePage(patch: Partial<P>, origin: Extract<MoveOrigin, { kind: "human" }>): MoveResult;
  },
) {
  const send = (
    patch: unknown,
    source: Extract<MoveOrigin, { kind: "human" }>["source"],
    history: "push" | "replace",
  ): MoveResult => {
    try {
      const parsed = record.safeParse(patch);
      if (
        !parsed.success ||
        Object.keys(parsed.data).some(
          (key) => !Object.hasOwn(fields, key) || fields[key]?.role !== source,
        )
      )
        return refused(`Only ${source} fields are allowed`);
      // The owner decodes values. Build only declared role keys; the pane never receives this writer.
      const checked: Partial<P> = {};
      for (const [key, value] of Object.entries(parsed.data))
        Object.defineProperty(checked, key, { value, enumerable: true });
      return owner.movePage(checked, { kind: "human", source, history });
    } catch {
      return refused("Invalid Page patch");
    }
  };
  const field = (
    key: unknown,
    value: unknown,
    source: "setting" | "query" | "draft" | "device" | "transient",
  ) =>
    typeof key === "string"
      ? send({ [key]: value }, source, "replace")
      : refused("Invalid field key");
  const one = (source: "subject" | "selection" | "stage", value: unknown) => {
    const keys = Object.keys(fields).filter((key) => fields[key]!.role === source);
    return keys.length === 1
      ? send({ [keys[0]!]: value }, source, "push")
      : refused(`Expected one ${source} field`);
  };
  return Object.freeze({
    page: Object.freeze({
      read: () => freezePage(owner.readPage()),
      select: (next: unknown) => one("selection", next),
      set: (key: keyof P, value: P[keyof P]) => field(key, value, "setting"),
      device: (key: keyof P, value: P[keyof P]) => field(key, value, "device"),
      transient: (key: keyof P, value: P[keyof P]) => field(key, value, "transient"),
      pose: (patch: unknown, intent: "gesture" | "named") =>
        intent === "gesture" || intent === "named"
          ? send(patch, "pose", intent === "gesture" ? "replace" : "push")
          : refused("Invalid pose intent"),
    }),
    controls: Object.freeze({
      subject: (value: unknown) => one("subject", value),
      stage: (value: unknown) => one("stage", value),
      query: (key: keyof P, value: P[keyof P]) => field(key, value, "query"),
      draft: (key: keyof P, value: P[keyof P]) => field(key, value, "draft"),
      device: (key: keyof P, value: P[keyof P]) => field(key, value, "device"),
      transient: (key: keyof P, value: P[keyof P]) => field(key, value, "transient"),
    }),
  });
}
