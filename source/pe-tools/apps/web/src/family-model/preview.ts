type JsonObject = Record<string, unknown>;

export interface FamilyModelPreview {
  source: JsonObject;
  family: { name: string; category: string; template: string; placement: string };
  typeName: string;
  typeNames: string[];
  parameters: ReadonlyArray<{ name: string; authored: string; origin: string }>;
  constituents: ReadonlyArray<{
    label: string;
    items: ReadonlyArray<{ name: string; facts: string[] }>;
  }>;
  warnings: string[];
}

export function parseFamilyModel(json: string): JsonObject {
  const value: unknown = JSON.parse(json);
  const model = object(value, "family.json must contain a JSON object");
  const family = object(model.family, "family is required");
  requiredString(family.name, "family.name");
  requiredString(family.category, "family.category");
  requiredString(family.template, "family.template");
  requiredString(family.placement, "family.placement");
  return model;
}

/**
 * Presentation-only projection. It deliberately preserves authored strings: validation,
 * references, formulas, units, and lowering remain authoritative in the C# Family Model.
 */
export function buildFamilyModelPreview(
  source: JsonObject,
  requestedType?: string,
): FamilyModelPreview {
  const familySource = object(source.family, "family is required");
  const family = {
    name: requiredString(familySource.name, "family.name"),
    category: requiredString(familySource.category, "family.category"),
    template: requiredString(familySource.template, "family.template"),
    placement: requiredString(familySource.placement, "family.placement"),
  };
  const types = map(source.types);
  const typeNames = Object.keys(types);
  const typeName =
    requestedType && typeNames.includes(requestedType)
      ? requestedType
      : (typeNames[0] ?? "Default");
  const overrides = map(types[typeName]);
  const parameterEntries = [
    ...Object.entries(map(source.familyParameters)).map(([name, spec]) => ({
      name,
      spec: map(spec),
      origin: "family",
    })),
    ...Object.entries(map(source.sharedParameters)).map(([name, spec]) => ({
      name,
      spec: map(spec),
      origin: "shared",
    })),
  ];
  const parameters = parameterEntries.map(({ name, spec, origin }) => {
    const override = string(overrides[name]);
    const value = string(spec.value);
    const formula = string(spec.formula);
    return {
      name,
      authored: override ?? value ?? (formula ? `= ${formula}` : "—"),
      origin: override ? `${typeName} override` : formula ? `${origin} formula` : origin,
    };
  });
  const bindings = (value: unknown) =>
    Object.entries(map(value)).flatMap(([target, sourceValue]) => {
      const sourceText = string(sourceValue);
      return sourceText ? [`${target} ← ${sourceText}`] : [];
    });
  const facts = (...values: Array<string | undefined | false>) =>
    values.filter((value): value is string => Boolean(value));
  const items = (
    section: unknown,
    describe: (entry: JsonObject) => Array<string | undefined | false>,
  ) =>
    Object.entries(map(section)).map(([name, value]) => ({
      name,
      facts: facts(...describe(map(value))),
    }));

  const constituents = [
    {
      label: "Planes",
      items: items(source.planes, (plane) => [
        string(plane.label),
        text("from", plane.from),
        string(plane.direction) && string(plane.by)
          ? `${string(plane.direction)} by ${string(plane.by)}`
          : undefined,
      ]),
    },
    {
      label: "Frames",
      items: items(source.frames, (frame) => [
        string(frame.label),
        array(frame.origin).length ? `origin ${array(frame.origin).join(" ∩ ")}` : undefined,
        text("normal", frame.normal),
        text("up", frame.up),
      ]),
    },
    {
      label: "Solids",
      items: items(source.solids, (solid) => [
        string(solid.label),
        string(solid.kind),
        string(solid.frame),
        text("W", solid.width),
        text("D", solid.depth),
        text("H", solid.height),
        text("Ø", solid.diameter),
      ]),
    },
    {
      label: "Nested families",
      items: items(source.nestedFamilies, (nested) => [
        string(nested.label),
        string(nested.family),
        text("type", nested.type),
        string(nested.frame),
        ...bindings(nested.parameterBindings),
      ]),
    },
    {
      label: "Connectors",
      items: items(source.connectors, (connector) => {
        const stub = map(connector.stub);
        const domain = string(connector.domain);
        const shape = string(connector.shape);
        return [
          string(connector.label),
          domain && shape ? `${domain} / ${shape}` : domain || shape,
          string(connector.frame),
          text("Ø", connector.diameter),
          text("W", connector.width),
          text("H", connector.height),
          string(stub.direction) && string(stub.depth)
            ? `stub ${string(stub.direction)} ${string(stub.depth)}${stub.isSolid === true ? " solid" : ""}`
            : undefined,
          text("system", connector.systemType),
          text("flow", connector.flowDirection),
          text("configuration", connector.flowConfiguration),
          text("loss", connector.lossMethod),
          ...bindings(connector.parameterBindings),
        ];
      }),
    },
    {
      label: "Arrays",
      items: items(source.arrays, (arraySpec) => {
        const limits = map(arraySpec.limits);
        return [
          string(arraySpec.label),
          string(arraySpec.kind),
          text("member", arraySpec.member),
          text("axis", arraySpec.axis),
          text("half-count", arraySpec.halfCount),
          string(limits.start) && string(limits.end)
            ? `limits ${string(limits.start)} → ${string(limits.end)}`
            : undefined,
        ];
      }),
    },
  ];
  const unmodeledCount = Array.isArray(source.unmodeled) ? source.unmodeled.length : 0;

  return {
    source,
    family,
    typeName,
    typeNames,
    parameters,
    constituents,
    warnings: unmodeledCount ? [`${unmodeledCount} unmodeled fact(s) cannot be replayed.`] : [],
  };
}

function object(value: unknown, message: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as JsonObject;
}

function map(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function array(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredString(value: unknown, path: string): string {
  const result = string(value);
  if (!result) throw new Error(`${path} is required`);
  return result;
}

function text(label: string, value: unknown): string | undefined {
  const result = string(value);
  return result ? `${label} ${result}` : undefined;
}
