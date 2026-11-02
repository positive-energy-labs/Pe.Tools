/**
 * ADR 0029 rule 2, the ratchet: an `Effect.run*` call ends a fiber, so it is legal only where a
 * `// effect-edge: <reason>` comment sits on the call's line or the line above it. The allowlist is
 * the comment; there is no baseline number. `island, phase 5` marks the mid-program sites phase 5
 * deletes.
 */
const RUNS = new Set([
  "runPromise",
  "runPromiseWith",
  "runSync",
  "runSyncWith",
  "runFork",
  "runForkWith",
  "runPromiseExit",
  "runPromiseExitWith",
  "runSyncExit",
  "runSyncExitWith",
]);
const EDGE = /\/\/\s*effect-edge:\s*\S/;

const effectEdge = {
  meta: {
    type: "problem",
    docs: { description: "Effect.run* is legal only at a line marked `// effect-edge: <reason>`." },
    messages: {
      unmarked:
        "Effect.{{name}} ends the fiber here. Stay on the fiber, or mark the line `// effect-edge: <reason>` (ADR 0029 rule 2).",
    },
  },
  create(context) {
    const lines = context.sourceCode.text.split(/\r?\n/);
    const lineOf = (offset) => {
      let line = 0;
      for (let i = 0; i < offset; i++) if (context.sourceCode.text.charCodeAt(i) === 10) line++;
      return line;
    };
    return {
      MemberExpression(node) {
        if (
          node.object?.type !== "Identifier" ||
          node.object.name !== "Effect" ||
          node.property?.type !== "Identifier" ||
          !RUNS.has(node.property.name)
        )
          return;
        const line = lineOf(node.range ? node.range[0] : node.start);
        if (EDGE.test(lines[line] ?? "") || EDGE.test(lines[line - 1] ?? "")) return;
        context.report({ node, messageId: "unmarked", data: { name: node.property.name } });
      },
    };
  },
};

export default { meta: { name: "pe" }, rules: { "effect-edge": effectEdge } };
