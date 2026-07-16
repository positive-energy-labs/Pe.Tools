export interface FamilyModelDocument {
  family: { name: string; category: string; template: string; placement: string };
  familyParameters?: Record<string, ParameterSpec>;
  sharedParameters?: Record<string, ParameterSpec>;
  types?: Record<string, Record<string, string>>;
  planes?: Record<string, PlaneSpec>;
  frames?: Record<string, FrameSpec>;
  solids?: Record<string, SolidSpec>;
  nestedFamilies?: Record<string, NestedFamilySpec>;
  connectors?: Record<string, ConnectorSpec>;
  arrays?: Record<string, ArraySpec>;
  roomCalculationPoint?: { enabled: boolean };
  unmodeled?: unknown[];
}

interface ParameterSpec {
  value?: string;
  formula?: string;
}

interface SolidSpec {
  label?: string;
  kind: string;
  frame: string;
  width?: string;
  depth?: string;
  height?: string;
  diameter?: string;
}

interface PlaneSpec {
  label?: string;
  from: string;
  by: string;
  direction: string;
}

interface FrameSpec {
  label?: string;
  origin: string[];
  normal: string;
  up: string;
}

interface NestedFamilySpec {
  label?: string;
  family: string;
  type: string;
  frame: string;
  parameterBindings?: Record<string, string>;
}

interface ConnectorSpec {
  label?: string;
  domain: string;
  shape: string;
  frame: string;
  diameter?: string;
  width?: string;
  height?: string;
  stub: { depth: string; direction: string; isSolid?: boolean };
  systemType: string;
  flowDirection?: string;
  flowConfiguration?: string;
  lossMethod?: string;
  parameterBindings?: Record<string, string>;
}

interface ArraySpec {
  label?: string;
  kind: string;
  member: string;
  axis: string;
  halfCount: string;
  limits: { start: string; end: string };
}

export interface PreviewSolid {
  name: string;
  kind: string;
  width?: number;
  depth?: number;
  height?: number;
  diameter?: number;
}

export interface FamilyModelPreview {
  model: FamilyModelDocument;
  typeName: string;
  parameters: Record<string, number | string>;
  solids: PreviewSolid[];
  constituents: ReadonlyArray<{
    label: string;
    items: ReadonlyArray<{ name: string; facts: string[] }>;
  }>;
  warnings: string[];
}

export function parseFamilyModel(json: string): FamilyModelDocument {
  const model = JSON.parse(json) as FamilyModelDocument;
  if (!model?.family?.name || !model.family.category || !model.family.template)
    throw new Error("family.name, family.category, and family.template are required");
  return model;
}

export function buildFamilyModelPreview(
  model: FamilyModelDocument,
  requestedType?: string,
): FamilyModelPreview {
  const typeNames = Object.keys(model.types ?? {});
  const typeName =
    requestedType && typeNames.includes(requestedType)
      ? requestedType
      : (typeNames[0] ?? "Default");
  const specs = { ...model.familyParameters, ...model.sharedParameters };
  const overrides = model.types?.[typeName] ?? {};
  const warnings = new Set<string>();
  const parameters: Record<string, number | string> = {};

  const resolveParameter = (name: string, stack = new Set<string>()): number | string => {
    if (name in parameters) return parameters[name];
    if (stack.has(name)) throw new Error(`Circular parameter formula: ${name}`);
    const spec = specs[name];
    if (!spec) throw new Error(`Unknown parameter: ${name}`);
    stack.add(name);
    const authored = overrides[name] ?? spec.value;
    let value: number | string;
    if (authored !== undefined) value = parsePortableNumber(authored) ?? authored;
    else if (spec.formula) {
      const evaluated = evaluateFormula(spec.formula, (atom) => {
        if (atom in specs) return resolveParameter(atom, stack);
        return parsePortableNumber(atom);
      });
      if (evaluated === undefined) {
        warnings.add(`Formula not previewed: ${name} = ${spec.formula}`);
        value = spec.formula;
      } else value = evaluated;
    } else value = "";
    stack.delete(name);
    parameters[name] = value;
    return value;
  };

  for (const name of Object.keys(specs)) resolveParameter(name);
  const dimension = (reference?: string) => {
    if (!reference) return undefined;
    const value = reference.startsWith("param:")
      ? resolveParameter(reference.slice("param:".length))
      : parsePortableNumber(reference);
    return typeof value === "number" ? value : undefined;
  };
  const solids = Object.entries(model.solids ?? {}).flatMap(([name, solid]) => {
    if (solid.frame && solid.frame !== "frame:family") {
      warnings.add(`Spatial frame not previewed: ${name} uses ${solid.frame}`);
      return [];
    }
    if (!["Prism", "VoidPrism", "Cylinder", "VoidCylinder"].includes(solid.kind)) {
      warnings.add(`Solid kind not previewed: ${name} uses ${solid.kind}`);
      return [];
    }
    return [
      {
        name,
        kind: solid.kind,
        width: dimension(solid.width),
        depth: dimension(solid.depth),
        height: dimension(solid.height),
        diameter: dimension(solid.diameter),
      },
    ];
  });

  const bindings = (value?: Record<string, string>) =>
    Object.entries(value ?? {}).map(([target, source]) => `${target} ← ${source}`);
  const facts = (...values: Array<string | undefined | false>) =>
    values.filter((value): value is string => Boolean(value));
  const constituents = [
    {
      label: "Planes",
      items: Object.entries(model.planes ?? {}).map(([name, plane]) => ({
        name,
        facts: facts(plane.label, `from ${plane.from}`, `${plane.direction} by ${plane.by}`),
      })),
    },
    {
      label: "Frames",
      items: Object.entries(model.frames ?? {}).map(([name, frame]) => ({
        name,
        facts: facts(
          frame.label,
          `origin ${frame.origin.join(" ∩ ")}`,
          `normal ${frame.normal}`,
          `up ${frame.up}`,
        ),
      })),
    },
    {
      label: "Solids",
      items: Object.entries(model.solids ?? {}).map(([name, solid]) => ({
        name,
        facts: facts(
          solid.label,
          solid.kind,
          solid.frame,
          solid.width && `W ${solid.width}`,
          solid.depth && `D ${solid.depth}`,
          solid.height && `H ${solid.height}`,
          solid.diameter && `Ø ${solid.diameter}`,
        ),
      })),
    },
    {
      label: "Nested families",
      items: Object.entries(model.nestedFamilies ?? {}).map(([name, nested]) => ({
        name,
        facts: facts(
          nested.label,
          nested.family,
          `type ${nested.type}`,
          nested.frame,
          ...bindings(nested.parameterBindings),
        ),
      })),
    },
    {
      label: "Connectors",
      items: Object.entries(model.connectors ?? {}).map(([name, connector]) => ({
        name,
        facts: facts(
          connector.label,
          `${connector.domain} / ${connector.shape}`,
          connector.frame,
          connector.diameter && `Ø ${connector.diameter}`,
          connector.width && `W ${connector.width}`,
          connector.height && `H ${connector.height}`,
          `stub ${connector.stub.direction} ${connector.stub.depth}${connector.stub.isSolid ? " solid" : ""}`,
          `system ${connector.systemType}`,
          connector.flowDirection && `flow ${connector.flowDirection}`,
          connector.flowConfiguration && `configuration ${connector.flowConfiguration}`,
          connector.lossMethod && `loss ${connector.lossMethod}`,
          ...bindings(connector.parameterBindings),
        ),
      })),
    },
    {
      label: "Arrays",
      items: Object.entries(model.arrays ?? {}).map(([name, array]) => ({
        name,
        facts: facts(
          array.label,
          array.kind,
          `member ${array.member}`,
          `axis ${array.axis}`,
          `half-count ${array.halfCount}`,
          `limits ${array.limits.start} → ${array.limits.end}`,
        ),
      })),
    },
  ];

  return {
    model,
    typeName,
    parameters,
    solids,
    constituents,
    warnings: [
      ...warnings,
      ...(model.unmodeled?.length
        ? [`${model.unmodeled.length} unmodeled fact(s) cannot be replayed.`]
        : []),
    ],
  };
}

function evaluateFormula(
  formula: string,
  resolve: (atom: string) => number | string | undefined,
): number | undefined {
  const match = formula.match(/^(.+?)\s*([+*/-])\s*(.+)$/);
  if (!match) {
    const value = resolve(formula.trim());
    return typeof value === "number" ? value : undefined;
  }
  const left = resolve(match[1].trim());
  const right = resolve(match[3].trim());
  if (typeof left !== "number" || typeof right !== "number") return undefined;
  if (match[2] === "+") return left + right;
  if (match[2] === "-") return left - right;
  if (match[2] === "*") return left * right;
  return right === 0 ? undefined : left / right;
}

function parsePortableNumber(value: string): number | undefined {
  const match = value.trim().match(/^(-?)(?:(\d+)\s+)?(\d+(?:\.\d+)?|\d+\/\d+)(mm|cm|m|in|ft)?$/i);
  if (!match) return undefined;
  const whole = Number(match[2] ?? 0);
  const fraction = match[3].includes("/")
    ? match[3]
        .split("/")
        .map(Number)
        .reduce((a, b) => a / b)
    : Number(match[3]);
  const inches =
    (whole + fraction) *
    ({ mm: 1 / 25.4, cm: 1 / 2.54, m: 39.37007874, ft: 12, in: 1 }[
      match[4]?.toLowerCase() ?? "in"
    ] ?? 1);
  return match[1] ? -inches : inches;
}
