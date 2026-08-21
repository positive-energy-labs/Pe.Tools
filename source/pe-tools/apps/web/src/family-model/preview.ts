type JsonObject = Record<string, unknown>;

export type FamilyModelAxis = "x" | "y" | "z";

export function familyModelPlaneOffset(direction: "In" | "Out", distance: number): number {
  return direction === "In" ? -distance : distance;
}

export function familyModelPrismFaceCoordinate(
  face: string,
  width: number,
  depth: number,
  height: number,
): { axis: FamilyModelAxis; coordinate: number } | null {
  switch (face) {
    case "Left":
      return { axis: "x", coordinate: -width / 2 };
    case "Right":
      return { axis: "x", coordinate: width / 2 };
    case "Back":
      return { axis: "y", coordinate: -depth / 2 };
    case "Front":
      return { axis: "y", coordinate: depth / 2 };
    case "Bottom":
      return { axis: "z", coordinate: 0 };
    case "Top":
      return { axis: "z", coordinate: height };
    default:
      return null;
  }
}

export function familyModelCylinderBounds(
  diameter: number,
  height: number,
): Record<FamilyModelAxis, [number, number]> {
  const radius = diameter / 2;
  return {
    x: [-radius, radius],
    y: [-radius, radius],
    z: [0, height],
  };
}

export interface FamilyModelProfilePointValue {
  x: number;
  y: number;
}

/**
 * The bounds of an extruded polygon in its own frame: the extremes of the resolved profile points, and
 * the bottom plane up to the height. C# authority:
 * `FamilyModelEvaluatorConventions.ResolvePolygonBounds`.
 */
export function familyModelPolygonBounds(
  profile: ReadonlyArray<FamilyModelProfilePointValue>,
  height: number,
): Record<FamilyModelAxis, [number, number]> {
  if (profile.length < 3)
    throw new Error("An extruded polygon needs at least three profile points");
  const xs = profile.map((point) => point.x);
  const ys = profile.map((point) => point.y);
  return {
    x: [Math.min(...xs), Math.max(...xs)],
    y: [Math.min(...ys), Math.max(...ys)],
    z: [0, height],
  };
}

const LENGTH_UNITS_IN_FEET: Record<string, number> = {
  ft: 1,
  in: 1 / 12,
  mm: 1 / 304.8,
  cm: 1 / 30.48,
  m: 1 / 0.3048,
};

/**
 * Resolves one authored length driver to FEET, the unit Revit reports. A `param:` reference reads the
 * resolved table, which already carries feet. C# authority:
 * `FamilyModelEvaluatorConventions.ResolveLengthFeet`.
 */
export function familyModelLengthFeet(
  driver: string | undefined,
  parameterValuesInFeet: Record<string, number>,
): number {
  if (!driver?.trim()) throw new Error("The length driver is missing");
  const parameter = /^param:(.+)$/.exec(driver);
  if (parameter) {
    const value = parameterValuesInFeet[parameter[1]];
    if (value === undefined)
      throw new Error(`Length driver '${driver}' has no resolved parameter value`);
    return value;
  }

  const literal = /^\s*([+-]?(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+))\s*(mm|cm|in|ft|m)\s*$/.exec(
    driver,
  );
  if (!literal) throw new Error(`Length driver '${driver}' is not a portable length literal`);
  const [whole, fraction] = literal[1].split(/\s+/);
  const magnitude = fraction ? Number(whole) + evaluateFraction(fraction) : evaluateFraction(whole);
  return magnitude * LENGTH_UNITS_IN_FEET[literal[2]];
}

function evaluateFraction(text: string): number {
  const parts = text.split("/");
  return parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(text);
}

export function centeredLinearTotal(halfCount: number): number {
  return 2 * halfCount - 1;
}

export type FamilyModelVector = readonly [number, number, number];

export interface FamilyModelTransform {
  origin: FamilyModelVector;
  basisX: FamilyModelVector;
  basisY: FamilyModelVector;
  basisZ: FamilyModelVector;
}

/**
 * One of the three stock family reference planes, and the direction an `Out` offset travels from it.
 * `Out` goes right (+X), FRONT (−Y), and up (+Z). The Y sign is the Revit convention: a family's front
 * elevation looks from −Y, so the front side of `Center (Front/Back)` is −Y. C# authority:
 * `FamilyModelEvaluatorConventions.ResolveFamilyPlane`.
 */
export function familyModelFamilyPlane(
  member: string,
): { axis: FamilyModelAxis; outward: FamilyModelVector } | null {
  switch (member) {
    case "CenterLR":
      return { axis: "x", outward: [1, 0, 0] };
    case "CenterFB":
      return { axis: "y", outward: [0, -1, 0] };
    case "Bottom":
      return { axis: "z", outward: [0, 0, 1] };
    default:
      return null;
  }
}

export function familyModelAxis(axis: string): FamilyModelVector {
  switch (axis) {
    case "+X":
      return [1, 0, 0];
    case "-X":
      return [-1, 0, 0];
    case "+Y":
      return [0, 1, 0];
    case "-Y":
      return [0, -1, 0];
    case "+Z":
      return [0, 0, 1];
    case "-Z":
      return [0, 0, -1];
    default:
      throw new Error(`Unknown axis token '${axis}'`);
  }
}

/** Local Z is the frame normal, local Y is up, local X completes a right-handed set (X = Y × Z). */
export function familyModelFrameBasis(
  origin: FamilyModelVector,
  normal: string,
  up: string,
): FamilyModelTransform {
  const basisZ = familyModelAxis(normal);
  const basisY = familyModelAxis(up);
  return { origin, basisX: cross(basisY, basisZ), basisY, basisZ };
}

/** `normal` and `up` name the frame's own axes; an axis token names a family axis. */
export function familyModelRotationAxis(
  about: string,
  frame: FamilyModelTransform,
): FamilyModelVector {
  if (about === "normal") return frame.basisZ;
  if (about === "up") return frame.basisY;
  return familyModelAxis(about);
}

/** Turns a frame about one axis through its own origin (Rodrigues, right-hand rule). */
export function familyModelRotate(
  frame: FamilyModelTransform,
  axis: FamilyModelVector,
  degrees: number,
): FamilyModelTransform {
  const radians = (degrees * Math.PI) / 180;
  return {
    origin: frame.origin,
    basisX: rotateVector(frame.basisX, axis, radians),
    basisY: rotateVector(frame.basisY, axis, radians),
    basisZ: rotateVector(frame.basisZ, axis, radians),
  };
}

/** A `param:` driver reads the resolved table, where Revit reports angles in RADIANS; literals are degrees. */
export function familyModelAngleDegrees(
  by: string,
  parameterValuesInRadians: Record<string, number>,
): number {
  const parameter = /^param:(.+)$/.exec(by);
  if (parameter) {
    const radians = parameterValuesInRadians[parameter[1]];
    if (radians === undefined)
      throw new Error(`Rotation driver '${by}' has no resolved parameter value`);
    return (radians * 180) / Math.PI;
  }

  const literal = /^\s*([+-]?\d+(?:\.\d+)?)\s*deg\s*$/.exec(by);
  if (!literal)
    throw new Error(`Rotation driver '${by}' is not a param: reference or an angle literal`);
  return Number(literal[1]);
}

export function familyModelApply(
  frame: FamilyModelTransform,
  local: FamilyModelVector,
): FamilyModelVector {
  return add(
    frame.origin,
    add(
      add(scale(frame.basisX, local[0]), scale(frame.basisY, local[1])),
      scale(frame.basisZ, local[2]),
    ),
  );
}

/** Three planes meet in one point unless two of them are parallel, which is an authoring error. */
export function familyModelIntersectPlanes(
  planes: ReadonlyArray<{ point: FamilyModelVector; normal: FamilyModelVector }>,
): FamilyModelVector {
  const [a, b, c] = planes.map((plane) => plane.normal);
  const determinant = dot(a, cross(b, c));
  if (Math.abs(determinant) < 1e-9) {
    throw new Error("Frame origin planes do not meet in one point");
  }

  const distances = planes.map((plane) => dot(plane.normal, plane.point));
  const numerator = add(
    add(scale(cross(b, c), distances[0]), scale(cross(c, a), distances[1])),
    scale(cross(a, b), distances[2]),
  );
  return scale(numerator, 1 / determinant);
}

function cross(a: FamilyModelVector, b: FamilyModelVector): FamilyModelVector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: FamilyModelVector, b: FamilyModelVector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add(a: FamilyModelVector, b: FamilyModelVector): FamilyModelVector {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(vector: FamilyModelVector, factor: number): FamilyModelVector {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function rotateVector(
  vector: FamilyModelVector,
  axis: FamilyModelVector,
  radians: number,
): FamilyModelVector {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return add(
    add(scale(vector, cos), scale(cross(axis, vector), sin)),
    scale(axis, dot(axis, vector) * (1 - cos)),
  );
}

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
      label: "Settings",
      items: Object.entries(map(source.settings)).map(([name, value]) => ({
        name,
        facts: [String(value)],
      })),
    },
    {
      // The CSV itself is Revit's own transport and is not re-parsed here: the preview says a table exists
      // and how big it is, and the authored file stays the place to read its rows.
      label: "Lookup tables",
      items: Object.entries(map(source.lookupTables)).map(([name, value]) => {
        const csv = string(map(value).csv) ?? "";
        const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
        return {
          name,
          facts: lines.length ? [`${lines.length - 1} row(s)`, `${lines[0]}`] : ["empty"],
        };
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
