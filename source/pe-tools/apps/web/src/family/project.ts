/**
 * /family — THE PROJECTION, both directions, and the only place the two schemas meet.
 *
 * The page renders a `FamilySpecModel` (a reading of a family, in the page's own vocabulary). The host
 * owns a `FamilyModel` (the authored `family.json`, in Revit's). Phase B's whole job is that this
 * module is the ONE translator between them, so nothing above it has to know which lane it is on:
 *
 *   FORWARD   `projectFamilyModel` — document + Revit evidence → the page world.
 *   REVERSE   `draftToPatches`     — the page's draft, diffed against the last-saved draft, into
 *                                    staged `route:settings` field patches addressed by JSON
 *                                    Pointer into the document's own paths.
 *
 * THE REVERSE PATH DIFFS, IT DOES NOT DUMP. A save that staged every value would rewrite lines
 * nobody touched and make the version-token guard fire on documents two people are editing. So
 * every patch here corresponds to a cell that actually MOVED, and a draft equal to its baseline
 * produces exactly zero patches — which is also what makes "nothing to save" an honest refusal
 * rather than a guess.
 *
 * WHAT IT DELIBERATELY DOES NOT PROJECT (page-scoped, later phases): the spec document, pea's
 * proposals, and the grounding link table. They arrive on the `route:family` slice through its own
 * commands, and a projection that invented them from the fixture would be the one lie these
 * surfaces may not tell.
 */
import { settingsFieldPointer } from "@pe/agent-contracts";

import type { RouteStatePatch } from "@pe/agent-contracts";
import { timeAgo } from "#/lib/utils";
import type { ConnectorSpec, FamilyModel, ParamSpec, SolidSpec } from "#/family/family-model";
import {
  paramRef,
  paramSpec,
  parameterSpecs,
  parameterSection,
  parameterText,
} from "#/family/family-model";
import type { EvidenceSlice } from "#/family/host";
import { bindingOf, isFormula, type Draft, type FamilyPageModel } from "#/family/model";
import type {
  GeomConstituent,
  GeomDim,
  GeomMeta,
  ProtoLive,
  ProtoLiveValue,
  ProtoParam,
  FamilySpecModel,
} from "#/family/world";

/** The length dataType a promoted literal inherits when nothing in the document says otherwise.
 * Real documents write "Length (Common)"; the bind picker matches candidates on this string, so a
 * literal has to arrive wearing the SAME spelling the document's own length parameters use. */
const FALLBACK_LENGTH_TYPE = "Length (Common)";

/** Which system classifications a select may offer, per connector domain. The document does not
 * carry its own enum, so the options are a fixed per-domain list — and the authored value is
 * always spliced in, because a picker that could not re-select what the file already says would be
 * refusing to round-trip. */
const SYSTEM_TYPES: Record<string, string[]> = {
  Duct: ["SupplyAir", "ReturnAir", "ExhaustAir", "OtherAir"],
  Pipe: ["Sanitary", "HydronicSupply", "HydronicReturn", "DomesticColdWater", "DomesticHotWater"],
  Electrical: ["PowerBalanced", "PowerUnBalanced", "Data", "Communication"],
  Cable: ["Data", "Communication"],
};

/* ── forward: document → page world ──────────────────────────────────────── */

export interface ProjectionOptions {
  /** The document's relative path — the sentence's document label. */
  path?: string;
}

export function projectFamilyModel(
  model: FamilyModel,
  evidence: EvidenceSlice | null,
  options: ProjectionOptions = {},
): FamilySpecModel {
  const params = projectParams(model);
  const lengthType = lengthDataType(model);
  return {
    profile: {
      path: options.path ?? `${model.family.name}.family.json`,
      familyName: model.family.name,
      category: model.family.category,
      template: model.family.template,
      placement: model.family.placement,
      params,
      types: Object.fromEntries(
        Object.entries(model.types ?? {}).map(([name, values]) => [
          name,
          Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, parameterText(value)]),
          ),
        ]),
      ),
      solids: Object.fromEntries(
        Object.entries(model.forms ?? model.solids ?? {}).map(([slug, solid]) => [
          slug,
          solidProse(solid),
        ]),
      ),
      connectors: Object.fromEntries(
        Object.entries(model.connectors ?? {}).map(([slug, connector]) => [
          slug,
          connectorProse(connector),
        ]),
      ),
      geometry: [
        ...Object.entries(model.forms ?? model.solids ?? {}).map(([slug, solid]) =>
          projectSolid(model, slug, solid, lengthType),
        ),
        ...Object.entries(model.connectors ?? {}).map(([slug, connector]) =>
          projectConnector(model, slug, connector, lengthType),
        ),
      ],
    },
    live: evidence ? projectEvidence(model, params, evidence) : null,
    // Page-scoped, and owed to a later phase rather than invented here.
    spec: null,
    proposals: [],
    grounding: {},
    profileDirty: false,
  };
}

/** Family and shared parameters, in document order, family first. A formula becomes `"= <text>"`,
 * which is the page's ONE spelling for "this value is derived" (`isFormula` reads exactly it). */
function projectParams(model: FamilyModel): ProtoParam[] {
  const project = ([name, spec]: [string, ParamSpec]): ProtoParam => ({
    name,
    dataType: spec.dataType ?? spec.sharedSpecId ?? "shared",
    value: spec.formula != null ? `= ${spec.formula}` : parameterText(spec.value),
    isInstance: spec.isInstance ?? false,
    group: spec.propertiesGroup ?? "other",
  });
  return Object.entries(parameterSpecs(model)).map(project);
}

/** The spelling this document uses for a length. Read off its own parameters rather than assumed,
 * so a document written in another vocabulary still binds literals to matching candidates. */
function lengthDataType(model: FamilyModel): string {
  for (const spec of Object.values(parameterSpecs(model)))
    if (spec.dataType?.startsWith("Length")) return spec.dataType;
  return FALLBACK_LENGTH_TYPE;
}

/** A dim's dataType: its parameter's when bound, the document's length spelling when frozen. A
 * literal has no dataType of its own, and guessing "Length" bare would make it unbindable. */
function dimDataType(model: FamilyModel, raw: string, lengthType: string): string {
  const param = paramRef(raw);
  return (param ? paramSpec(model, param)?.dataType : undefined) ?? lengthType;
}

/** `param:Body Width` → `Body Width`, a literal → itself. What the prose lines read as. */
const spoken = (raw: string | undefined) => (raw == null ? null : (paramRef(raw) ?? raw));

function solidProse(solid: SolidSpec): string {
  const size = [
    spoken(solid.diameter),
    spoken(solid.width),
    spoken(solid.depth),
    spoken(solid.height),
  ]
    .filter((part): part is string => part != null)
    .join(" × ");
  return size ? `${solid.kind} · ${size}` : solid.kind;
}

function connectorProse(connector: ConnectorSpec): string {
  const size =
    connector.shape === "Round"
      ? spoken(connector.diameter)
      : [spoken(connector.width), spoken(connector.height)]
          .filter((part): part is string => part != null)
          .join(" × ");
  return [
    connector.domain,
    connector.shape,
    size,
    connector.systemType,
    connector.flowDirection?.toLowerCase(),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** The frame a constituent sits on, as the two READ metadata rows the page shows: where its origin
 * is, and which way it faces. Both are computed from the sketch in Revit, so neither is editable
 * here — a text box would be claiming an edit nothing downstream would make. */
function frameMeta(model: FamilyModel, frameRef: string | undefined): GeomMeta[] {
  if (!frameRef) return [];
  const slug = frameRef.startsWith("frame:") ? frameRef.slice("frame:".length) : frameRef;
  const frame = model.frames?.[slug];
  const origin = frame
    ? frame.origin.map((ref) => ref.replace(/^(face|plane|frame):/, "")).join(" · ")
    : slug === "family"
      ? "family origin · on the reference level"
      : `${slug} — the document declares no frame by this name`;
  return [
    {
      key: "origin",
      label: "frame origin",
      control: "read",
      value: origin,
      note: `Where the constituent's own frame sits, read from ${frameRef} in the document. Read-only here because moving it is a sketch edit in the family editor, not a value — a text box pretending otherwise would be lying about what would happen.`,
    },
    {
      key: "normal",
      label: "normal",
      control: "read",
      value: frame?.normal ?? "—",
      note: "The direction this constituent's frame faces. Computed from the work plane, so it is reported rather than chosen.",
    },
  ];
}

const DIM_NOTE: Record<string, string> = {
  width: "X extent, in the constituent's own frame.",
  depth: "Y extent, in the constituent's own frame.",
  height: "Extrusion depth along the frame's normal.",
  diameter: "Outside diameter.",
  "stub.depth": "How far the stub runs before the connection face.",
};

function dim(model: FamilyModel, property: string, raw: string, lengthType: string): GeomDim {
  return {
    property,
    dataType: dimDataType(model, raw, lengthType),
    binding: raw,
    note:
      paramRef(raw) == null
        ? `UNBOUND — ${raw} is frozen into the document here. No type can differ, no schedule can read it, and no formula can reach it. ${DIM_NOTE[property] ?? ""}`
        : (DIM_NOTE[property] ?? "A bindable dimension of this constituent."),
  };
}

function projectSolid(
  model: FamilyModel,
  slug: string,
  solid: SolidSpec,
  lengthType: string,
): GeomConstituent {
  const dims: GeomDim[] = [];
  for (const property of ["width", "depth", "height", "diameter"] as const) {
    const raw = solid[property];
    if (raw != null) dims.push(dim(model, property, raw, lengthType));
  }
  return {
    slug,
    kind: solid.kind,
    dims,
    meta: solid.center
      ? [
          {
            key: "center",
            label: "center / bottom",
            control: "read",
            value: [...solid.center, solid.bottom ?? ""].join(" / "),
            note: "Native authored plane references.",
          },
        ]
      : frameMeta(model, solid.frame),
  };
}

function projectConnector(
  model: FamilyModel,
  slug: string,
  connector: ConnectorSpec,
  lengthType: string,
): GeomConstituent {
  const dims: GeomDim[] = [];
  for (const property of ["diameter", "width", "height"] as const) {
    const raw = connector[property];
    if (raw != null) dims.push(dim(model, property, raw, lengthType));
  }
  if (connector.stub) dims.push(dim(model, "stub.depth", connector.stub.depth, lengthType));

  const meta: GeomMeta[] = [];
  // Only what the document actually authors gets a control. A toggle over an absent field would
  // be offering to edit a claim the file never made.
  if (connector.flowDirection != null)
    meta.push({
      key: "flowDirection",
      label: "flow direction",
      control: "toggle",
      value: connector.flowDirection,
      options: ["In", "Out"],
      note: "Which way the medium crosses this connector. Get it backwards and the system still connects — it just solves the wrong way round, silently.",
    });
  if (connector.systemType != null)
    meta.push({
      key: "systemType",
      label: "system type",
      control: "select",
      value: connector.systemType,
      options: [...new Set([connector.systemType, ...(SYSTEM_TYPES[connector.domain] ?? [])])],
      note: `The ${connector.domain} system classification Revit matches on when it decides what may connect to what. The list is a fixed per-domain set — the document carries no enum of its own, so an unlisted value stays selectable rather than being silently dropped.`,
    });
  if (connector.stub)
    meta.push({
      key: "stub.direction",
      label: "stub direction",
      control: "toggle",
      value: connector.stub.direction,
      options: ["In", "Out"],
      note: "Which side of the connection face the stub runs on. In pulls it back into the family; Out stands it off.",
    });
  meta.push({
    key: "shape",
    label: "shape",
    control: "read",
    value: connector.shape ?? (connector.diameter ? "Round" : "Unspecified"),
    note: "Round or Rectangular. Read-only: a round connector does not become rectangular because a word changed — its dims would have to change with it, which is a document edit, not a value.",
  });
  return {
    slug,
    kind: `${connector.domain}Connector`,
    dims,
    meta: [
      ...meta,
      ...(connector.on
        ? [
            {
              key: "on",
              label: "on / at",
              control: "read" as const,
              value: [connector.on, ...(connector.at ?? [])].join(" / "),
              note: "Native authored plane intersections; reference-plane positions are seeds until Revit solves constraints.",
            },
          ]
        : frameMeta(model, connector.frame)),
    ],
  };
}

/* ── forward: evidence → the live substrate ──────────────────────────────── */

function projectEvidence(
  model: FamilyModel,
  params: ProtoParam[],
  evidence: EvidenceSlice,
): ProtoLive {
  const authored = new Set(params.map((param) => param.name));
  const values: Record<string, Record<string, ProtoLiveValue>> = {};
  if ("modelJson" in evidence) {
    const captured = JSON.parse(evidence.modelJson) as FamilyModel;
    const reported = parameterSpecs(captured);
    for (const [typeName, cells] of Object.entries(captured.types ?? {}))
      for (const [name, value] of Object.entries(cells)) {
        if (reported[name]?.formula != null || value == null) continue;
        (values[name] ??= {})[typeName] = { value: parameterText(value) };
      }
    return {
      familyName: evidence.familyName,
      worldLabel: evidence.rfaPath ?? evidence.origin,
      readAgo: timeAgo(evidence.reading.observedAt) || "just now",
      typeNames: Object.keys(captured.types ?? {}),
      values,
      extraParams: Object.keys(reported).filter((name) => !authored.has(name)),
      missingParams:
        evidence.coverage.parameters === "Read"
          ? [...authored].filter((name) => !(name in reported))
          : [],
    };
  }
  for (const parameter of evidence.parameters) {
    const perType: Record<string, ProtoLiveValue> = {};
    for (const [typeName, resolved] of Object.entries(parameter.valuesPerType)) {
      if (resolved.value == null) continue;
      perType[typeName] = {
        value: resolved.value,
        // A formula's number is an OUTPUT, not a competing value — which is exactly what the
        // page's `derived` verdict says, and the only thing `readOnly` is read for.
        ...(resolved.source === "Formula" ? { readOnly: true as const } : {}),
      };
    }
    if (Object.keys(perType).length > 0) values[parameter.name] = perType;
  }
  const reported = new Set(evidence.parameters.map((parameter) => parameter.name));
  return {
    familyName: evidence.familyName,
    worldLabel: evidence.rfaPath ?? evidence.origin,
    readAgo: timeAgo(evidence.reading.observedAt) || "just now",
    values,
    extraParams: [...reported].filter((name) => !authored.has(name)),
    // A parameter the read did not report is UNREAD, not missing — only a read that saw the whole
    // family can say "absent", and this projection cannot tell the two apart, so it claims neither
    // beyond what the model authors and the evidence never mentioned.
    missingParams: [...authored].filter(
      (name) => !reported.has(name) && paramSpec(model, name)?.formula == null,
    ),
  };
}

/* ── forward: draft over document → the model the anatomy draws ──────────── */

const SOLID_DIM_FIELDS = ["width", "depth", "height", "diameter"] as const;
const CONNECTOR_DIM_FIELDS = ["diameter", "width", "height"] as const;

/**
 * The DRAFT laid over the parsed document — what the anatomy triptych actually draws.
 *
 * The page's live truth is the draft: edits staged but not yet saved. `buildSheet` reads a
 * `FamilyModel`, so without this composition the drawing would show the DISK while the table
 * shows your keystroke — two truths on one page. The mapping is deliberately the same one the
 * reverse projection stages (`draftToPatches` → `dimSegments`/`metaSegments`): a value the save
 * path could not write is a value the drawing may not preview, and a dim with no document path
 * is skipped in silence here exactly as it stages nothing there.
 *
 * Pure, and conservative about what it touches: an untouched cell is left alone, so a formula's
 * evidence-resolved values survive (a blanket rewrite would erase them); an untouched draft
 * returns a model that draws identically to the document.
 */
export function draftedModel(
  model: FamilyModel,
  draft: Draft,
  world: FamilyPageModel,
): FamilyModel {
  const next = structuredClone(model);

  // Promoted literals are WHOLE new parameters — seeded first, so their authored value below
  // has a spec to land on and the drawing moves in the same beat as the promotion.
  for (const param of draft.newParams) {
    (next.parameters ?? next.familyParameters)[param.name] = {
      dataType: param.dataType,
      ...(param.group ? { propertiesGroup: param.group } : {}),
    };
  }

  // Family-level values: value XOR formula, applied only where the draft MOVED the cell.
  for (const [name, value] of Object.entries(draft.authored)) {
    const spec = paramSpec(next, name);
    if (!spec) continue;
    const seeded = spec.formula != null ? `= ${spec.formula}` : parameterText(spec.value);
    if (value === seeded) continue;
    if (isFormula(value)) spec.formula = value.replace(/^\s*=\s*/, "");
    else {
      spec.value = value;
      delete spec.formula;
    }
    if (isFormula(value)) delete spec.value;
    // Either way the old resolved values described a value that no longer stands.
    delete spec.resolvedValues;
  }

  // The type matrix is the draft's, wholesale: an override typed and an override cleared are
  // both just the record as it now stands.
  next.types = structuredClone(draft.types);

  // Geometry: a dim's drafted value IS its binding, written to exactly the paths the reverse
  // projection stages — solids' four fields, connectors' three plus the nested stub. Metadata
  // lands only on its editable connector homes; `read` rows have no path and get none.
  for (const part of world.geom) {
    const solid = (next.forms ?? next.solids)?.[part.slug];
    const connector = next.connectors?.[part.slug];
    for (const dim of part.dims) {
      const binding = bindingOf(world, draft, part.slug, dim.property);
      if (binding === "") continue;
      if (solid && (SOLID_DIM_FIELDS as readonly string[]).includes(dim.property)) {
        solid[dim.property as (typeof SOLID_DIM_FIELDS)[number]] = binding;
      } else if (connector) {
        if (dim.property === "stub.depth") {
          if (connector.stub) connector.stub.depth = binding;
        } else if ((CONNECTOR_DIM_FIELDS as readonly string[]).includes(dim.property)) {
          connector[dim.property as (typeof CONNECTOR_DIM_FIELDS)[number]] = binding;
        }
      }
    }
    if (!connector) continue;
    for (const [key, value] of Object.entries(draft.geom[part.slug]?.meta ?? {})) {
      if (key === "flowDirection" || key === "systemType") connector[key] = value;
      else if (key === "stub.direction" && connector.stub) connector.stub.direction = value;
    }
  }

  return next;
}

/* ── reverse: draft → staged field patches ───────────────────────────────── */

/** Stage a value at one JSON Pointer. `undefined` DELETES the property, which is a different act
 * from writing an empty string and the settings schema keeps them apart. */
function stage(segments: string[], value: string | undefined): RouteStatePatch {
  return {
    path: ["fields", settingsFieldPointer(segments), "staged"],
    value: value === undefined ? { delete: true } : { value },
  };
}

/**
 * Every cell the draft moved, as staged `route:settings` field patches.
 *
 * `savedDraft` is the draft as the last-read snapshot seeded it — the page's record of the DISK.
 * Diffing against it (rather than against the model) is what makes a save after a save write
 * nothing: the snapshot refreshes, the baseline re-seeds, and the difference is genuinely empty.
 */
export function draftToPatches(
  model: FamilyModel,
  draft: Draft,
  savedDraft: Draft,
): RouteStatePatch[] {
  const patches: RouteStatePatch[] = [];
  const promoted = new Set(draft.newParams.map((param) => param.name));

  // ── the family level: a value XOR a formula, and the swap costs two patches ──────────────────
  for (const [name, value] of Object.entries(draft.authored)) {
    if (savedDraft.authored[name] === value) continue;

    // A PROMOTED LITERAL is a whole new parameter, not a changed value: it needs the object the
    // document has no line for at all, seeded with the literal so the geometry does not move.
    if (promoted.has(name) && !(name in savedDraft.authored)) {
      const seed = draft.newParams.find((param) => param.name === name);
      patches.push({
        path: [
          "fields",
          settingsFieldPointer([model.parameters ? "parameters" : "familyParameters", name]),
          "staged",
        ],
        value: {
          value: {
            dataType: seed?.dataType ?? FALLBACK_LENGTH_TYPE,
            ...(seed?.group ? { propertiesGroup: seed.group } : {}),
            ...(isFormula(value) ? { formula: value.replace(/^\s*=\s*/, "") } : { value }),
          },
        },
      });
      continue;
    }

    const section = parameterSection(model, name);
    const spec = paramSpec(model, name);
    if (isFormula(value)) {
      patches.push(stage([section, name, "formula"], value.replace(/^\s*=\s*/, "")));
      if (spec?.value != null) patches.push(stage([section, name, "value"], undefined));
    } else {
      patches.push(stage([section, name, "value"], value));
      if (spec?.formula != null) patches.push(stage([section, name, "formula"], undefined));
    }
  }

  // ── the type overrides: present → set, absent → delete the property ──────────────────────────
  for (const typeName of new Set([...Object.keys(draft.types), ...Object.keys(savedDraft.types)])) {
    const now = draft.types[typeName] ?? {};
    const disk = savedDraft.types[typeName] ?? {};
    for (const name of new Set([...Object.keys(now), ...Object.keys(disk)])) {
      if (now[name] === disk[name]) continue;
      patches.push(stage(["types", typeName, name], now[name]));
    }
  }

  // ── the geometry: a dim's binding IS its value, so a rebind and a retype are one patch ───────
  for (const [slug, part] of Object.entries(draft.geom)) {
    const diskPart = savedDraft.geom[slug];
    for (const [property, binding] of Object.entries(part.dims)) {
      if (diskPart?.dims[property] === binding) continue;
      const segments = dimSegments(model, slug, property);
      if (segments) patches.push(stage(segments, binding));
    }
    for (const [key, value] of Object.entries(part.meta)) {
      if (diskPart?.meta[key] === value) continue;
      const segments = metaSegments(model, slug, key);
      if (segments) patches.push(stage(segments, value));
    }
  }

  return patches;
}

/** Where a bindable dim lives in the document. A property the projection did not come from returns
 * null and stages nothing — silence beats inventing a path the schema does not have. */
function dimSegments(model: FamilyModel, slug: string, property: string): string[] | null {
  if ((model.forms ?? model.solids)?.[slug])
    return ["width", "depth", "height", "diameter"].includes(property)
      ? [model.forms ? "forms" : "solids", slug, property]
      : null;
  if (model.connectors?.[slug]) {
    if (property === "stub.depth") return ["connectors", slug, "stub", "depth"];
    return ["diameter", "width", "height"].includes(property)
      ? ["connectors", slug, property]
      : null;
  }
  return null;
}

/** The EDITABLE half of a constituent's metadata. Everything else is `control: "read"` — reported
 * from the sketch — and has no document path a value could be written to. */
function metaSegments(model: FamilyModel, slug: string, key: string): string[] | null {
  if (!model.connectors?.[slug]) return null;
  if (key === "flowDirection" || key === "systemType") return ["connectors", slug, key];
  if (key === "stub.direction") return ["connectors", slug, "stub", "direction"];
  return null;
}
