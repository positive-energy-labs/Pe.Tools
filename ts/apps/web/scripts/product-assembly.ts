import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const symbol = z.string().regex(/^[a-z_$][\w$]*$/i);
const modulePath = z.string().startsWith("./");
const reference = z.object({ module: modulePath, export: symbol });
const keyed = reference.extend({ key: z.string().regex(/^[a-z][a-z0-9-]*$/) });
const metadata = z.strictObject({
  guide: modulePath.optional(),
  admissionPreflight: modulePath.optional(),
  tool: keyed.optional(),
  commands: reference.optional(),
  reads: reference.optional(),
  http: z.object({ module: modulePath, routes: symbol, axes: symbol }).optional(),
  settings: keyed.optional(),
  reading: reference.optional(),
  callPolicies: reference.optional(),
  resourceReads: z.array(z.string()).optional(),
  basisHeaders: z.record(z.string(), reference).optional(),
  httpLayer: reference.optional(),
  executors: z
    .object({
      module: modulePath,
      factory: symbol,
      arguments: z.array(z.enum(["bridge", "deps"])),
      sheet: z
        .object({ routes: z.array(z.string()), via: z.enum(["losses", "parameters"]) })
        .optional(),
    })
    .optional(),
});

const packageSchema = z.object({
  name: z.string(),
  exports: z.record(z.string(), z.unknown()).optional(),
  pe: metadata.optional(),
});
type Package = z.infer<typeof packageSchema> & { file: string };
type Reference = z.infer<typeof reference>;
const hostFields = new Set(["executors", "httpLayer"]);

export const productAssemblyPaths = {
  actions: "ts/packages/mcps/src/pea/product-actions.generated.ts",
  catalog: "ts/packages/mcps/src/pea/product-catalog.generated.ts",
  contracts: "ts/packages/mcps/src/pea/product-contracts.generated.ts",
  guides: "ts/packages/mcps/src/pea/guides.generated.ts",
  executors: "ts/apps/host/src/product-executors.generated.ts",
  http: "ts/apps/host/src/product-http.generated.ts",
};

function products(checkout: string) {
  const root = join(checkout, "ts/products");
  function layer(product: string, name: string): Package | undefined {
    const file = join(root, product, name, "package.json");
    if (!existsSync(file)) return;
    const decoded = packageSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!decoded.success) throw Error(file + ": " + decoded.error.message);
    const wrongLayer = Object.keys(decoded.data.pe ?? {}).filter((field) =>
      name === "contract" ? hostFields.has(field) : name === "host" ? !hostFields.has(field) : true,
    );
    if (wrongLayer.length)
      throw Error(file + ": product declarations in the wrong layer: " + wrongLayer.join(", "));
    return { file, ...decoded.data };
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((id) => ({
      id,
      contract: layer(id, "contract"),
      domain: layer(id, "domain"),
      host: layer(id, "host"),
      web: layer(id, "web"),
      route: existsSync(join(root, id, "web/route.ts")),
    }));
}

function importOf(pkg: Package, value: Reference, alias: string) {
  if (!Object.hasOwn(pkg.exports ?? {}, value.module))
    throw Error(pkg.file + ": missing export " + value.module);
  return (
    "import { " +
    value.export +
    " as " +
    alias +
    " } from " +
    JSON.stringify(pkg.name + value.module.slice(1)) +
    ";"
  );
}

/** Shared by the route producer and its freshness guard. These rows are the app composition. */
export function renderProductAssembly(checkout: string) {
  const inputs = products(checkout);
  const contracts = inputs.flatMap((row) => (row.contract?.pe ? [row.contract] : []));
  const hosts = inputs.flatMap((row) => (row.host?.pe ? [row.host] : []));
  const refs = (
    packages: readonly Package[],
    prefix: string,
    select: (pkg: Package) => (Reference & { key?: string }) | undefined,
  ) =>
    packages.flatMap((pkg, i) => {
      const ref = select(pkg);
      if (!ref) return [];
      const alias = prefix + i;
      return [{ alias, key: ref.key, line: importOf(pkg, ref, alias) }];
    });
  const tools = refs(contracts, "tool", (pkg) => pkg.pe?.tool);
  const ownCommands = refs(contracts, "commands", (pkg) => pkg.pe?.commands);
  const reads = refs(contracts, "reads", (pkg) => pkg.pe?.reads);
  const routes = refs(contracts, "routes", (pkg) => {
    const http = pkg.pe?.http;
    return http && { module: http.module, export: http.routes };
  });
  const axes = refs(contracts, "axes", (pkg) => {
    const http = pkg.pe?.http;
    return http && { module: http.module, export: http.axes };
  });
  const reading = refs(contracts, "reading", (pkg) => pkg.pe?.reading);
  const settings = refs(contracts, "settings", (pkg) => pkg.pe?.settings);
  const policies = refs(contracts, "policies", (pkg) => pkg.pe?.callPolicies);
  const headers = contracts.flatMap((pkg, i) =>
    Object.entries(pkg.pe?.basisHeaders ?? {}).map(([key, ref], j) => {
      const alias = "header" + i + "_" + j;
      return { alias, key, line: importOf(pkg, ref, alias) };
    }),
  );
  const resourceReads = contracts.flatMap((pkg) => pkg.pe?.resourceReads ?? []);
  const guides = refs(
    contracts,
    "guide",
    (pkg) => (pkg.pe?.guide && { module: pkg.pe.guide, export: "peaGuide" }) || undefined,
  );
  const preflights = refs(
    contracts,
    "preflight",
    (pkg) =>
      (pkg.pe?.admissionPreflight && {
        module: pkg.pe.admissionPreflight,
        export: "admissionPreflight",
      }) ||
      undefined,
  );
  const http = refs(hosts, "layer", (pkg) => pkg.pe?.httpLayer);
  const executors = hosts.flatMap((pkg, i) => {
    const registration = pkg.pe?.executors;
    if (!registration) return [];
    const alias = "group" + i;
    return [
      {
        alias,
        ...registration,
        line: importOf(pkg, { module: registration.module, export: registration.factory }, alias),
      },
    ];
  });

  const lines = (...groups: ReadonlyArray<readonly { line: string }[]>) =>
    groups.flat().map((row) => row.line);
  const list = (rows: readonly { alias: string }[]) => rows.map((row) => row.alias);
  function entries(kind: string, rows: readonly { key?: string; alias: string }[]) {
    const keys = new Set<string>();
    return rows
      .map(({ key, alias }) => {
        if (key === undefined || keys.has(key))
          throw Error("Duplicate or missing product " + kind + " key: " + key);
        keys.add(key);
        return JSON.stringify(key) + ": " + alias;
      })
      .join(", ");
  }
  const spreads = (names: readonly string[]) => names.map((name) => "..." + name).join(", ");
  const source = (...body: string[]) =>
    [
      "// Generated by codegen:routes from product package metadata. Do not edit.",
      ...body,
      "",
    ].join("\n");

  const sheetRoutes = executors.flatMap(
    (row) => row.sheet?.routes.map((key) => ({ key, alias: JSON.stringify(row.sheet?.via) })) ?? [],
  );

  const commandTables = [
    "builtinCommands",
    ...list(ownCommands),
    ...list(tools).map((tool) => tool + ".commands"),
  ];
  const outputs = {
    [productAssemblyPaths.actions]: source(
      'import { builtinCommands, builtinTools, targetForCommand, withHostActions } from "@pe/agent-contracts/semantic-actions";',
      'import type { DocumentRef, Tool } from "@pe/agent-contracts";',
      'import { assertUniqueProductKeys } from "./assembly-checks.ts";',
      ...lines(tools, ownCommands),
      "const productTools = { " + entries("tool", tools) + " };",
      'assertUniqueProductKeys("tool", [builtinTools, productTools]);',
      'assertUniqueProductKeys("command", [' + commandTables.join(", ") + "]);",
      "export const tools: typeof builtinTools & { " +
        tools.map((row) => JSON.stringify(row.key) + ": typeof " + row.alias).join("; ") +
        " } = { ...builtinTools, ...productTools };",
      "export const commands = { " + spreads(commandTables) + " };",
      "export const hostActions = withHostActions(commands);",
      "export type SemanticActionKey = keyof typeof commands;",
      "export type HostActionKey = keyof typeof hostActions;",
      "export const commandTarget = (key: string, input: Record<string, unknown>, document?: DocumentRef) =>",
      "  targetForCommand(hostActions, key, input, document);",
      "export function commandTool(key: string): Tool | undefined {",
      "  return Object.values(tools).find(tool => Object.hasOwn(tool.commands, key));",
      "}",
    ),
    [productAssemblyPaths.catalog]: source(
      'import { createPeCatalog, httpRoutes, type PeCatalog } from "@pe/agent-contracts/pe-api";',
      'import { assertUniqueProductKeys } from "./assembly-checks.ts";',
      'import { hostActions } from "./product-actions.generated.ts";',
      ...lines(reads, routes, axes, policies),
      "const routes = { " + spreads(list(routes)) + " };",
      "const axes = { " + spreads(list(axes)) + " };",
      "const callPolicies = { " + spreads(list(policies)) + " };",
      'assertUniqueProductKeys("HTTP route", [' +
        ["httpRoutes", ...list(routes)].join(", ") +
        "]);",
      'assertUniqueProductKeys("call policy", [' + list(policies).join(", ") + "]);",
      'assertUniqueProductKeys("named read", [' +
        list(reads)
          .map((alias) => alias + ".inputs")
          .join(", ") +
        "]);",
      "type ProductCatalog = PeCatalog<typeof httpRoutes & typeof routes>;",
      "const catalog: ProductCatalog = createPeCatalog(hostActions, {",
      "  inputs: { " + spreads(list(reads).map((alias) => alias + ".inputs")) + " },",
      "  help: [" +
        list(reads)
          .map((alias) => alias + ".help")
          .join(", ") +
        '].filter(Boolean).join(" "),',
      "}, { routes, axes, callPolicies, resourceReads: [...new Set([...Object.keys(callPolicies), ..." +
        JSON.stringify(resourceReads) +
        "])] });",
      ...[
        "peRoutes",
        "linkedCatalog",
        "matchPeRoute",
        "servePeRoute",
        "peClientScript",
        "isPeRouteId",
        "createPeClient",
      ].map(
        (name) =>
          "export const " + name + ': ProductCatalog["' + name + '"] = catalog.' + name + ";",
      ),
    ),
    [productAssemblyPaths.contracts]: source(
      'import { NATIVE_BODY_VERSION_HEADER, readingRequestSchema } from "@pe/agent-contracts";',
      'import type { SettingOwner } from "@pe/agent-contracts/setting-owners";',
      ...lines(reading, settings, headers),
      "export const resourceReadingSchema = readingRequestSchema" +
        list(reading)
          .map((alias) => ".or(" + alias + ")")
          .join("") +
        ";",
      "export const settingOwners: Readonly<Record<string, SettingOwner>> = Object.freeze({ " +
        entries("settings owner", settings) +
        " });",
      "export const readingBasisHeaders = (headers: Readonly<Record<string, string | undefined>>) => ({",
      "  version: headers[NATIVE_BODY_VERSION_HEADER],",
      ...headers.map((row) => "  " + JSON.stringify(row.key) + ": headers[" + row.alias + "],"),
      "});",
    ),
    [productAssemblyPaths.guides]: source(
      ...lines(guides, preflights),
      "export const productGuides = [" + list(guides).join(", ") + "] as const;",
      "export const productAdmissionPreflights = [" + list(preflights).join(", ") + "] as const;",
    ),
    [productAssemblyPaths.executors]: source(
      'import type { RevitBridge } from "@pe/host-internal/bridge";',
      'import type { DocumentRef, NativeProcess } from "@pe/agent-contracts";',
      'import type { HostNativeRead } from "@pe/host-internal/native-read";',
      'import type { FamilyActionDependencies } from "./family-actions.ts";',
      'import type { CommandExecutor } from "@pe/host-internal/command-executor";',
      ...lines(executors),
      'export function productExecutors(bridge: RevitBridge["Service"], deps: FamilyActionDependencies & { nativeRead?: HostNativeRead["Service"]; projectLifetime?: (target: DocumentRef) => Promise<NativeProcess> } = {}) {',
      "  const result: Record<string, CommandExecutor> = {};",
      ...executors.map(
        (row) =>
          "  for (const [key, executor] of Object.entries(" +
          row.alias +
          "(" +
          row.arguments.join(", ") +
          '))) { if (result[key]) throw Error("Duplicate product executor " + key); result[key] = executor; }',
      ),
      "  return { executors: result, sheetRoutes: { " +
        entries("sheet route", sheetRoutes) +
        " } as Readonly<Record<string, string>> };",
      "}",
    ),
    [productAssemblyPaths.http]: source(
      'import { Layer } from "effect";',
      ...lines(http),
      "export const productHttpRoutes = Layer.mergeAll(Layer.empty" +
        list(http)
          .map((alias) => ", " + alias)
          .join("") +
        ");",
    ),
  };
  const names = (layers: readonly (Package | undefined)[]) =>
    [...new Set(layers.flatMap((pkg) => (pkg ? [pkg.name] : [])))].sort();
  return {
    outputs,
    dependencies: {
      "ts/packages/mcps/package.json": names(contracts),
      "ts/apps/host/package.json": names([
        ...hosts,
        ...inputs.filter((row) => row.route).flatMap((row) => [row.host, row.contract]),
      ]),
      "ts/apps/web/package.json": names(inputs.filter((row) => row.route).map((row) => row.web)),
    },
  };
}

const dependenciesSchema = z
  .object({
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    pe: z
      .object({ generatedProductDependencies: z.array(z.string()).optional() })
      .loose()
      .optional(),
  })
  .loose();

/** Workspace links are still pnpm dependencies. Keep hand-authored dependencies and replace the generated rows. */
export function productDependencyChanges(
  checkout: string,
  expected: Readonly<Record<string, readonly string[]>>,
) {
  return Object.entries(expected).flatMap(([file, packages]) => {
    const json = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(join(checkout, file), "utf8")));
    const current = dependenciesSchema.parse(json);
    const dependencies = { ...current.dependencies };
    const devDependencies = { ...current.devDependencies };
    for (const name of current.pe?.generatedProductDependencies ?? []) delete dependencies[name];
    for (const name of packages) {
      const version = dependencies[name] ?? devDependencies[name];
      if (version && version !== "workspace:*")
        throw Error(file + ": expected a workspace dependency on " + name);
      dependencies[name] = "workspace:*";
      delete devDependencies[name];
    }
    const next = {
      ...json,
      dependencies,
      ...(current.devDependencies && { devDependencies }),
      pe: { ...current.pe, generatedProductDependencies: packages },
    };
    return isDeepStrictEqual(json, next)
      ? []
      : [{ file, text: JSON.stringify(next, null, 2) + "\n" }];
  });
}
