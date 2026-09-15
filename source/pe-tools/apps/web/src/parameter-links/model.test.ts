import { expect, test } from "vite-plus/test";
import {
  parameterLinksBasis,
  type ParameterLinkProfile,
  type ParameterLinksDocument,
  type ParameterLinksReading,
} from "@pe/agent-contracts";

import {
  addAssignment,
  addDefinition,
  applyRefusal,
  blankProfile,
  editingProfile,
  errorIssueCount,
  evaluationIsCurrent,
  isDraftDirty,
  parseUniqueIds,
  removeDefinition,
  sameProfile,
  updateAssignment,
} from "./model.ts";

function profile(defId = "d1"): ParameterLinkProfile {
  return {
    formatVersion: 1,
    definitions: [
      {
        id: defId,
        sourceCategoryId: -2001040,
        sourceParameter: { name: "Apparent Load" },
        sourceScope: "instanceThenType",
        relationship: "sameElement",
        targetParameter: { name: "PE Load" },
        reducer: "first",
      },
    ],
    assignments: [],
  };
}

function doc(draft: ParameterLinkProfile | null): ParameterLinksDocument {
  return { draft };
}

/** A capture-owner reading. It is a separate value, never a field of the document above. */
function reading(input: {
  basis: string;
  evaluated?: boolean;
  stored?: ParameterLinkProfile | null;
  errors?: number;
}): ParameterLinksReading {
  return {
    basis: input.basis,
    workRevision: 0,
    evaluated: input.evaluated ?? true,
    stored: input.stored ?? null,
    status: {
      hasStoredProfile: input.stored != null,
      updaterRegistered: true,
      activeDefinitionCount: 0,
      activeAssignmentCount: 0,
    },
    evaluation:
      (input.evaluated ?? true)
        ? {
            writes: [],
            issues: Array.from({ length: input.errors ?? 0 }, (_, index) => ({
              code: "E" + index,
              severity: "error" as const,
              message: "blocked",
            })),
            sourceElementCount: 0,
            targetElementCount: 0,
            changedWriteCount: 0,
          }
        : null,
    profileChanged: false,
    appliedWriteCount: 0,
  };
}
const stampOf = (draft: ParameterLinkProfile | null) => parameterLinksBasis({ draft });

test("editingProfile is the authored draft and nothing else", () => {
  expect(editingProfile(doc(profile("draft")))?.definitions[0].id).toBe("draft");
  // A stored profile is external truth; it never silently becomes something the human is editing.
  expect(editingProfile(doc(null))).toBeNull();
  expect(editingProfile(null)).toBeNull();
});

test("isDraftDirty compares the authored draft against the observed stored profile", () => {
  const stored = profile();
  const observed = reading({ basis: stampOf(stored), stored });
  expect(isDraftDirty(doc(stored), observed)).toBe(false);
  expect(isDraftDirty(doc(null), observed)).toBe(false);
  expect(isDraftDirty(doc(addDefinition(stored)), observed)).toBe(true);
});

test("apply is armed by the reading basis, which survives a reload", () => {
  const draft = profile();
  const current = doc(draft);
  const evaluated = reading({ basis: stampOf(draft) });
  expect(evaluationIsCurrent(current, evaluated)).toBe(true);
  expect(applyRefusal(current, evaluated)).toBeNull();
  // The same document and the same reading, freshly loaded, are all Apply ever needed.
  expect(applyRefusal(structuredClone(current), structuredClone(evaluated))).toBeNull();

  const edited = doc(addDefinition(draft));
  expect(evaluationIsCurrent(edited, evaluated)).toBe(false);
  expect(applyRefusal(edited, evaluated)).toMatch(/Preview/);
  expect(applyRefusal(current, null)).toMatch(/Preview/);
  expect(applyRefusal(doc(null), evaluated)).toMatch(/draft/);
  expect(applyRefusal(current, reading({ basis: stampOf(draft), errors: 1 }))).toMatch(/errors/);
});

test("a stored-profile read can never arm an apply of a draft it did not evaluate", () => {
  const draft = profile("draft");
  const stored = profile("stored");
  // refresh observes Revit and stamps its own basis; the authored draft is a different value.
  const observed = reading({ basis: stampOf(stored), evaluated: false, stored });
  expect(evaluationIsCurrent(doc(draft), observed)).toBe(false);
  expect(applyRefusal(doc(draft), observed)).toMatch(/Preview/);
});

test("errorIssueCount counts only error-severity issues", () => {
  expect(
    errorIssueCount({
      writes: [],
      issues: [
        { code: "A", severity: "warning", message: "w" },
        { code: "B", severity: "error", message: "e" },
        { code: "C", severity: "error", message: "e" },
      ],
      sourceElementCount: 0,
      targetElementCount: 0,
      changedWriteCount: 0,
    }),
  ).toBe(2);
  expect(errorIssueCount(null)).toBe(0);
});

test("removeDefinition also drops that definition's assignments", () => {
  let next = blankProfile();
  const defId = next.definitions[0].id;
  next = addAssignment(next, defId);
  expect(next.assignments).toHaveLength(1);
  next = removeDefinition(next, defId);
  expect(next.definitions).toHaveLength(0);
  expect(next.assignments).toHaveLength(0);
});

test("updateAssignment patches only the targeted assignment immutably", () => {
  let next = blankProfile();
  next = addAssignment(next, next.definitions[0].id);
  const asnId = next.assignments[0].id;
  const before = next.assignments[0];
  next = updateAssignment(next, asnId, { enabled: false });
  expect(next.assignments[0].enabled).toBe(false);
  expect(before.enabled).toBe(true);
});

test("parseUniqueIds splits on newlines and commas, trimming blanks", () => {
  expect(parseUniqueIds("a\n b ,,c\n\n")).toEqual(["a", "b", "c"]);
  expect(parseUniqueIds("   ")).toEqual([]);
});

test("sameProfile is null-safe structural equality", () => {
  expect(sameProfile(null, null)).toBe(true);
  expect(sameProfile(profile(), structuredClone(profile()))).toBe(true);
  expect(sameProfile(profile(), addDefinition(profile()))).toBe(false);
});
