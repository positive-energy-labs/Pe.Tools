export interface FamilyModelDocument {
  family: { name: string; category: string; template: string; placement: string };
  familyParameters?: Record<string, ParameterSpec>;
  sharedParameters?: Record<string, ParameterSpec>;
  types?: Record<string, Record<string, string>>;
  planes?: Record<string, unknown>;
  frames?: Record<string, unknown>;
  solids?: Record<string, SolidSpec>;
  nestedFamilies?: Record<string, unknown>;
  connectors?: Record<string, ConnectorSpec>;
  arrays?: Record<string, unknown>;
  roomCalculationPoint?: { enabled: boolean };
  unmodeled?: unknown[];
}

interface ParameterSpec {
  value?: string;
  formula?: string;
}

interface SolidSpec {
  kind: string;
  width?: string;
  depth?: string;
  height?: string;
  diameter?: string;
}

interface ConnectorSpec {
  domain: string;
  shape: string;
  frame: string;
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
  groups: ReadonlyArray<{ label: string; names: string[] }>;
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
  const solids = Object.entries(model.solids ?? {}).map(([name, solid]) => ({
    name,
    kind: solid.kind,
    width: dimension(solid.width),
    depth: dimension(solid.depth),
    height: dimension(solid.height),
    diameter: dimension(solid.diameter),
  }));

  return {
    model,
    typeName,
    parameters,
    solids,
    groups: [
      ["Planes", model.planes],
      ["Frames", model.frames],
      ["Solids", model.solids],
      ["Nested", model.nestedFamilies],
      ["Connectors", model.connectors],
      ["Arrays", model.arrays],
    ].map(([label, entries]) => ({
      label: label as string,
      names: Object.keys((entries as Record<string, unknown> | undefined) ?? {}),
    })),
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
  if (!match)
    return typeof resolve(formula.trim()) === "number"
      ? (resolve(formula.trim()) as number)
      : undefined;
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
