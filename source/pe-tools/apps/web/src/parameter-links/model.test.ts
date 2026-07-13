import { expect, test } from "vite-plus/test";
import type { ParameterLinkProfile, ParameterLinksDocument } from "@pe/agent-contracts";

import {
  addAssignment,
  addDefinition,
  blankProfile,
  canApply,
  editingProfile,
  errorIssueCount,
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

function doc(overrides: Partial<ParameterLinksDocument>): ParameterLinksDocument {
  return {
    profile: null,
    draftProfile: null,
    evaluation: null,
    status: null,
    profileChanged: false,
    appliedWriteCount: 0,
    ...overrides,
  };
}

test("editingProfile prefers the draft over the stored profile", () => {
  const stored = profile("stored");
  const draft = profile("draft");
  expect(editingProfile(doc({ profile: stored, draftProfile: draft }))?.definitions[0].id).toBe(
    "draft",
  );
  expect(editingProfile(doc({ profile: stored }))?.definitions[0].id).toBe("stored");
  expect(editingProfile(null)).toBeNull();
});

test("isDraftDirty is true only when a draft diverges from the stored profile", () => {
  const stored = profile();
  expect(isDraftDirty(doc({ profile: stored, draftProfile: stored }))).toBe(false);
  expect(isDraftDirty(doc({ profile: stored, draftProfile: null }))).toBe(false);
  const edited = addDefinition(stored);
  expect(isDraftDirty(doc({ profile: stored, draftProfile: edited }))).toBe(true);
});

test("canApply gates on a matching preview and no blocking errors", () => {
  const editing = profile();
  const previewedSame = structuredClone(editing);
  expect(canApply({ editing, previewed: previewedSame, errorCount: 0 })).toBe(true);
  // stale preview (draft changed after previewing)
  expect(
    canApply({ editing: addDefinition(editing), previewed: previewedSame, errorCount: 0 }),
  ).toBe(false);
  // never previewed
  expect(canApply({ editing, previewed: null, errorCount: 0 })).toBe(false);
  // blocking error present
  expect(canApply({ editing, previewed: previewedSame, errorCount: 1 })).toBe(false);
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
  expect(before.enabled).toBe(true); // original untouched
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
