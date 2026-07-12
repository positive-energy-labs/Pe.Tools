/**
 * Client-side Revit-formula validation — instant UX before a formula stages.
 *
 * The host is authoritative (family.editor.apply → Formula.TrySetFormula); this is
 * the fast-feedback cousin that runs entirely from the snapshot. It mirrors the C#
 * tokenizer (`Pe.Revit/Extensions/FamParameter/Formula/Tokenizer.cs`): strip string
 * literals, mask valid parameter names (longest-first, boundary-aware), then split on
 * boundary chars. Everything left that isn't a number or a known Revit function is a
 * suspicious reference.
 *
 * Three checks, all derived from the snapshot + the in-progress draft:
 *   - invalid-ref: a token that resolves to no parameter and no function,
 *   - cycle: the edited param reaches itself through the formula graph (draft included),
 *   - type-refs-instance: a TYPE param's formula reads an INSTANCE param (Revit forbids it).
 */
import type { FamilyTypesParam } from "@pe/agent-contracts";

/** Revit built-in functions (lowercased), excluded from parameter-reference detection.
 * Sourced from the authoritative C# tokenizer; exp10 added from the brief's list. */
const REVIT_FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "exp",
  "exp10",
  "log",
  "ln",
  "sqrt",
  "abs",
  "if",
  "and",
  "or",
  "not",
  "pi",
  "round",
  "roundup",
  "rounddown",
  "size_lookup",
]);

/** Operators + structural chars. Excludes `"` (delimits string literals). Matches the C# set. */
const BOUNDARY_CHARS = new Set([
  "+",
  "-",
  "*",
  "/",
  "^",
  "=",
  ">",
  "<",
  " ",
  "[",
  "]",
  "(",
  ")",
  ",",
  "\t",
  "\r",
  "\n",
]);

export type FormulaProblemKind = "invalid-ref" | "cycle" | "type-refs-instance";

export interface FormulaProblem {
  kind: FormulaProblemKind;
  message: string;
  /** The offending token, when the problem localizes to one. */
  token?: string;
}

/** Strip `"..."` string literals so their contents never tokenize. */
function stripStrings(formula: string): string {
  return formula.replace(/"[^"]*"/g, " ");
}

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || BOUNDARY_CHARS.has(ch);
}

/**
 * Mask every boundary-delimited occurrence of `name` in `chars` (in place, with spaces).
 * Returns true if it masked at least one — i.e. the formula references this parameter.
 */
function maskParam(chars: string[], name: string): boolean {
  if (!name) return false;
  let masked = false;
  const len = name.length;
  for (let i = 0; i + len <= chars.length; i++) {
    let hit = true;
    for (let j = 0; j < len; j++) {
      if (chars[i + j] !== name[j]) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;
    if (!isBoundary(chars[i - 1]) || !isBoundary(chars[i + len])) continue;
    for (let j = 0; j < len; j++) chars[i + j] = " ";
    masked = true;
    i += len - 1;
  }
  return masked;
}

/** A token that could plausibly be a parameter reference: not empty, not digit-led, not a function. */
function couldBeParamRef(token: string): boolean {
  if (!token) return false;
  if (/[0-9]/.test(token[0])) return false; // numeric literal (possibly unit-suffixed)
  return !REVIT_FUNCTIONS.has(token.toLowerCase());
}

/** Split a masked formula on boundary chars. */
function tokenize(masked: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const ch of masked) {
    if (BOUNDARY_CHARS.has(ch)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export interface FormulaTokens {
  /** Valid parameter names this formula references (subset of `validNames`). */
  refs: string[];
  /** Tokens that resolve to no parameter and no function — suspicious references. */
  unknown: string[];
}

/** Tokenize a formula against known parameter names, splitting references from unknowns. */
export function analyzeFormula(formula: string, validNames: readonly string[]): FormulaTokens {
  if (!formula.trim()) return { refs: [], unknown: [] };
  const chars = stripStrings(formula).split("");
  const refs = new Set<string>();
  // Longest-first so "Width Offset" masks before "Width".
  const sorted = [...validNames].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (maskParam(chars, name)) refs.add(name);
  }
  const unknown = [...new Set(tokenize(chars.join("")).filter(couldBeParamRef))];
  return { refs: [...refs], unknown };
}

/** Follow formula-graph edges from `from`; true if it reaches `target` (cycle when target = start). */
function reaches(
  from: string,
  target: string,
  graph: Map<string, string[]>,
  seen = new Set<string>(),
): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const next of graph.get(from) ?? []) {
    if (reaches(next, target, graph, seen)) return true;
  }
  return false;
}

/**
 * Validate an in-progress formula for one parameter against the snapshot. Returns every
 * problem found (empty = clean). Staging is never blocked on this — the host decides.
 */
export function validateFormula(args: {
  paramName: string;
  draft: string;
  params: readonly FamilyTypesParam[];
}): FormulaProblem[] {
  const { paramName, draft, params } = args;
  if (!draft.trim()) return [];

  const byName = new Map(params.map((p) => [p.name, p]));
  const validNames = params.map((p) => p.name);
  const edited = byName.get(paramName);
  const problems: FormulaProblem[] = [];

  const { refs, unknown } = analyzeFormula(draft, validNames);
  for (const token of unknown) {
    problems.push({ kind: "invalid-ref", message: `"${token}" is not a parameter`, token });
  }

  // Formula graph over the snapshot, with the edited param's formula replaced by the draft.
  const graph = new Map<string, string[]>();
  for (const p of params) {
    const formula = p.name === paramName ? draft : (p.formula ?? "");
    graph.set(p.name, formula.trim() ? analyzeFormula(formula, validNames).refs : []);
  }
  const cyclic = refs.some((ref) => reaches(ref, paramName, graph));
  if (cyclic) {
    problems.push({
      kind: "cycle",
      message: refs.includes(paramName)
        ? `"${paramName}" references itself`
        : `"${paramName}" is part of a formula cycle`,
    });
  }

  // A type parameter's formula may not read an instance parameter.
  if (edited && edited.isInstance === false) {
    for (const ref of refs) {
      if (byName.get(ref)?.isInstance) {
        problems.push({
          kind: "type-refs-instance",
          message: `type parameter can't reference instance parameter "${ref}"`,
          token: ref,
        });
      }
    }
  }

  return problems;
}
