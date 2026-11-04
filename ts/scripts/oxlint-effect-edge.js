/**
 * ADR 0029 rule 2, the ratchet: a run call ends a fiber, so it is legal only where a real
 * `// effect-edge: <reason>` comment sits on the site's line, or leads the line above it. A string
 * that contains the marker is not a comment and licenses nothing.
 *
 * The reason vocabulary is closed. `island, phase 5` is a mid-program site phase 5 deletes; the
 * repo-guards suite counts those per file against `effect-islands.baseline.json`, which may only
 * shrink. Every other reason is an edge id below, legal only in the files listed for it, so a new
 * edge is an edit to this file and shows up in review as one.
 *
 * The rule follows the run family by name (`runPromise`, `runSync`, `runFork`, `runCallback`, every
 * `*With`/`*Exit` variant, `Fiber.runIn`, `NodeRuntime.runMain`, `Runtime.makeRunMain`), not by the
 * identifier `Effect`, so `import { Effect as E }`, namespace imports, named imports, destructuring,
 * computed access and `ManagedRuntime` instance methods are all sites. An alias that carries a run
 * function out of a marked site is itself followed.
 */
const RUN_NAMES = new Set([
  "runFork",
  "runForkWith",
  "runCallback",
  "runCallbackWith",
  "runPromise",
  "runPromiseWith",
  "runPromiseExit",
  "runPromiseExitWith",
  "runSync",
  "runSyncWith",
  "runSyncExit",
  "runSyncExitWith",
  "runIn",
  "runMain",
  "makeRunMain",
]);
const EFFECT_SOURCE = /^(?:effect(?:\/.*)?|@effect\/.*)$/;
const ISLAND = "island, phase 5";
/** edge id -> the files (path suffixes under `ts/`) that may carry it. */
const EDGE_FILES = {
  "process-main": ["apps/host/src/host-main.ts", "apps/host/src/dev.ts"],
  "als-crossing": ["apps/host/src/request-identity.ts"],
  "cli-main": ["packages/browser/src/keeper.ts"],
  "test-runner": ["apps/host/tests/effect-test.ts"],
};
const MARKER = /^\s*effect-edge:\s*(.*?)\s*$/;

const keyName = (key) =>
  key?.type === "Identifier"
    ? key.name
    : key?.type === "Literal" && typeof key.value === "string"
      ? key.value
      : undefined;

const effectEdge = {
  meta: {
    type: "problem",
    // `edgeFiles` replaces EDGE_FILES; the probe test uses it to name its own fixture as an edge.
    schema: [
      {
        type: "object",
        properties: {
          edgeFiles: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } },
          },
        },
        additionalProperties: false,
      },
    ],
    docs: { description: "A run call is legal only at a line marked `// effect-edge: <reason>`." },
    messages: {
      unmarked:
        "{{name}} ends the fiber here. Stay on the fiber, or mark the line `// effect-edge: <edge-id>` or `// effect-edge: island, phase 5` (ADR 0029 rule 2).",
      badReason:
        "`// effect-edge: {{reason}}` is not in the vocabulary. Use `island, phase 5` or one of: {{ids}}.",
      wrongFile: "Edge `{{reason}}` is not legal in this file; it is legal in: {{files}}.",
      dynamic:
        "Computed access on an Effect module hides a run call. Name the member, or mark the line.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const text = sourceCode.text;
    const edgeFiles = context.options[0]?.edgeFiles ?? EDGE_FILES;
    const file = context.filename.replaceAll("\\", "/");
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
    const lineOf = (offset) => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const startOf = (node) => (node.range ? node.range[0] : node.start);
    // Real comment tokens only, keyed by the line they start on.
    const markers = new Map();
    for (const comment of sourceCode.getAllComments()) {
      if (comment.type !== "Line") continue;
      const match = MARKER.exec(comment.value);
      if (!match) continue;
      const start = comment.range ? comment.range[0] : comment.start;
      const line = lineOf(start);
      // Alone on its line, or after only the operator a formatter leaves there (`? // marker`).
      const alone = /^[\s?:(&|,=>]*$/.test(text.slice(lineStarts[line], start));
      markers.set(line, { reason: match[1], alone });
    }
    const markerFor = (line) => {
      const same = markers.get(line);
      if (same) return same;
      const above = markers.get(line - 1);
      return above?.alone ? above : undefined;
    };

    const effectNames = new Set();
    const localRun = new Set();
    const reported = new Set();
    const report = (node, name) => {
      const start = startOf(node);
      if (reported.has(start)) return;
      reported.add(start);
      const marker = markerFor(lineOf(start));
      if (!marker) return context.report({ node, messageId: "unmarked", data: { name } });
      if (marker.reason === ISLAND) return;
      const files = edgeFiles[marker.reason];
      if (!files)
        return context.report({
          node,
          messageId: "badReason",
          data: { reason: marker.reason, ids: Object.keys(edgeFiles).join(", ") },
        });
      if (!files.some((f) => file.endsWith(`/${f}`) || file === f))
        context.report({
          node,
          messageId: "wrongFile",
          data: { reason: marker.reason, files: files.join(", ") || "(none)" },
        });
    };

    const runMember = (node) => {
      if (node.type !== "MemberExpression") return undefined;
      if (node.computed) {
        const key =
          node.property.type === "TemplateLiteral" && node.property.expressions.length === 0
            ? node.property.quasis[0].value.cooked
            : keyName(node.property);
        return key !== undefined && node.property.type !== "Identifier" && RUN_NAMES.has(key)
          ? key
          : undefined;
      }
      return node.property.type === "Identifier" && RUN_NAMES.has(node.property.name)
        ? node.property.name
        : undefined;
    };

    return {
      ImportDeclaration(node) {
        if (!EFFECT_SOURCE.test(String(node.source.value))) return;
        for (const specifier of node.specifiers) {
          effectNames.add(specifier.local.name);
          if (
            specifier.type === "ImportSpecifier" &&
            RUN_NAMES.has(keyName(specifier.imported) ?? "")
          ) {
            localRun.add(specifier.local.name);
            report(specifier, keyName(specifier.imported));
          }
        }
      },
      MemberExpression(node) {
        const name = runMember(node);
        if (name) return report(node, name);
        if (
          node.computed &&
          node.object.type === "Identifier" &&
          effectNames.has(node.object.name) &&
          node.property.type !== "Literal" &&
          node.property.type !== "TemplateLiteral"
        )
          report(node, "[computed]");
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.init && runMember(node.init))
          localRun.add(node.id.name);
      },
      Property(node) {
        if (node.parent?.type !== "ObjectPattern") return;
        const name = node.computed ? undefined : keyName(node.key);
        if (!name || !RUN_NAMES.has(name)) return;
        if (node.value?.type === "Identifier") localRun.add(node.value.name);
        else if (node.value?.type === "AssignmentPattern" && node.value.left.type === "Identifier")
          localRun.add(node.value.left.name);
        report(node, name);
      },
      Identifier(node) {
        if (!localRun.has(node.name)) return;
        const parent = node.parent;
        if (parent?.type === "ImportSpecifier") return;
        if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed)
          return;
        if (parent?.type === "Property" && parent.key === node && !parent.shorthand) return;
        report(node, node.name);
      },
    };
  },
};

export default { meta: { name: "pe" }, rules: { "effect-edge": effectEdge } };
