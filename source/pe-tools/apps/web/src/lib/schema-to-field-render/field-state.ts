import type {
  SettingsValidationIssue,
  SettingsValidationResult,
} from "@pe/host-contracts/operation-types";
import type { SchemaDocument } from "@pe/schema-core";

export interface FieldChangeSummary {
  path: string;
  beforeValue: unknown;
  afterValue: unknown;
  descendantChanges: number;
  isComposite: boolean;
}

export interface ProjectedValidationState {
  fieldIssuesByPath: ReadonlyMap<string, string[]>;
  formIssues: SettingsValidationIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function areValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((entry, index) => areValuesEqual(entry, right[index]));
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) && areValuesEqual(left[key], right[key]),
    );
  }

  return false;
}

function appendPath(basePath: string, nextSegment: string): string {
  return basePath ? `${basePath}.${nextSegment}` : nextSegment;
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function normalizeValidationPath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  const trimmed = path.trim();
  if (!trimmed || trimmed === "$" || trimmed === "#") {
    return undefined;
  }

  if (trimmed.startsWith("#/")) {
    const pointerPath = trimmed
      .slice(2)
      .split("/")
      .filter(Boolean)
      .map(decodePointerSegment)
      .join(".");
    return pointerPath || undefined;
  }

  const normalized = trimmed
    .replace(/^\$\./, "")
    .replace(/^\$/, "")
    .replace(/\[['"]([^'"]+)['"]\]/g, ".$1")
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^\./, "");

  return normalized || undefined;
}

function resolveProjectedIssuePath(
  issuePath: string | undefined,
  schemaDocument: SchemaDocument,
): string | undefined {
  let currentPath = normalizeValidationPath(issuePath);
  if (currentPath) {
    const segments = currentPath.split(".");
    if (segments.at(-1)?.startsWith("$")) {
      segments.pop();
      currentPath = segments.join(".");
    }
  }

  while (currentPath) {
    if (schemaDocument.tryAt(currentPath)) {
      return currentPath;
    }

    const segments = currentPath.split(".");
    segments.pop();
    currentPath = segments.join(".");
  }

  return undefined;
}

function formatValidationMessage(issue: SettingsValidationIssue): string {
  return issue.message;
}

function pushIssueMessage(issuesByPath: Map<string, string[]>, path: string, message: string) {
  const existing = issuesByPath.get(path) ?? [];
  if (existing.includes(message)) {
    return;
  }

  issuesByPath.set(path, [...existing, message]);
}

export function projectHostValidationState(
  schemaDocument: SchemaDocument,
  validationResult?: SettingsValidationResult,
): ProjectedValidationState {
  if (!validationResult?.issues?.length) {
    return {
      fieldIssuesByPath: new Map<string, string[]>(),
      formIssues: [],
    };
  }

  const fieldIssuesByPath = new Map<string, string[]>();
  const formIssues: SettingsValidationIssue[] = [];

  for (const issue of validationResult.issues) {
    const projectedPath = resolveProjectedIssuePath(issue.path, schemaDocument);
    if (!projectedPath) {
      formIssues.push(issue);
      continue;
    }

    pushIssueMessage(fieldIssuesByPath, projectedPath, formatValidationMessage(issue));
  }

  return {
    fieldIssuesByPath,
    formIssues,
  };
}

function collectChildSegments(beforeValue: unknown, afterValue: unknown): string[] {
  if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
    const beforeItems = Array.isArray(beforeValue) ? beforeValue : [];
    const afterItems = Array.isArray(afterValue) ? afterValue : [];
    return Array.from({ length: Math.max(beforeItems.length, afterItems.length) }, (_, index) =>
      String(index),
    );
  }

  if (isPlainObject(beforeValue) || isPlainObject(afterValue)) {
    const beforeKeys = isPlainObject(beforeValue) ? Object.keys(beforeValue) : [];
    const afterKeys = isPlainObject(afterValue) ? Object.keys(afterValue) : [];
    return Array.from(new Set([...beforeKeys, ...afterKeys])).sort((a, b) => a.localeCompare(b));
  }

  return [];
}

function valueAtSegment(value: unknown, segment: string): unknown {
  if (Array.isArray(value)) {
    const index = Number.parseInt(segment, 10);
    return Number.isNaN(index) ? undefined : value[index];
  }

  if (isPlainObject(value)) {
    return value[segment];
  }

  return undefined;
}

function visitChanges(
  path: string,
  beforeValue: unknown,
  afterValue: unknown,
  changeMap: Map<string, FieldChangeSummary>,
): number {
  if (areValuesEqual(beforeValue, afterValue)) {
    return 0;
  }

  let descendantChanges = 0;
  for (const segment of collectChildSegments(beforeValue, afterValue)) {
    descendantChanges += visitChanges(
      appendPath(path, segment),
      valueAtSegment(beforeValue, segment),
      valueAtSegment(afterValue, segment),
      changeMap,
    );
  }

  if (path) {
    changeMap.set(path, {
      path,
      beforeValue,
      afterValue,
      descendantChanges,
      isComposite:
        Array.isArray(beforeValue) ||
        Array.isArray(afterValue) ||
        isPlainObject(beforeValue) ||
        isPlainObject(afterValue),
    });
  }

  return Math.max(1, descendantChanges);
}

export function buildFieldChangeMap(
  baselineValues: Record<string, unknown>,
  currentValues: Record<string, unknown>,
): ReadonlyMap<string, FieldChangeSummary> {
  const changeMap = new Map<string, FieldChangeSummary>();
  visitChanges("", baselineValues, currentValues, changeMap);
  return changeMap;
}
