import { expect, test } from "vite-plus/test";
import type {
  FamilyTypesDocument,
  ParameterLinkProfile,
  ParameterLinksDocument,
} from "@pe/agent-contracts";
import {
  createFamilyTypesCommandHandlers,
  createParameterLinksCommandHandlers,
} from "../src/pea/route-state-commands.ts";

test("family types push rejects staged cells that still need review before calling Revit", async () => {
  const document: FamilyTypesDocument = {
    snapshot: null,
    doc: null,
    pushedAt: null,
    cells: {
      "MOCP::Type A": { staged: "15 A", review: "attention" },
    },
  };
  const push = createFamilyTypesCommandHandlers({ hostBaseUrl: "http://127.0.0.1:1" }).push;

  await expect(push({}, { getDoc: () => document, setDoc: async () => undefined })).rejects.toThrow(
    "Push blocked: 1 staged cell need review.",
  );
});

test("parameter links apply rejects a reviewed profile after the draft changes", async () => {
  const reviewed: ParameterLinkProfile = {
    formatVersion: 1,
    definitions: [
      {
        id: "mocp-to-rating",
        sourceCategoryId: -2001140,
        sourceParameter: { name: "MOCP" },
        sourceScope: "instanceThenType",
        relationship: "electricalEquipmentCircuits",
        targetParameter: { name: "Rating" },
        reducer: "max",
      },
    ],
    assignments: [
      {
        id: "all-equipment",
        definitionId: "mocp-to-rating",
        enabled: true,
        sourceElementUniqueIds: [],
      },
    ],
  };
  const document: ParameterLinksDocument = {
    profile: null,
    draftProfile: {
      ...reviewed,
      definitions: [{ ...reviewed.definitions[0]!, reducer: "min" }],
    },
    evaluation: null,
    status: null,
    profileChanged: false,
    appliedWriteCount: 0,
  };
  const apply = createParameterLinksCommandHandlers({ hostBaseUrl: "http://127.0.0.1:1" }).apply;

  await expect(
    apply({ profile: reviewed }, { getDoc: () => document, setDoc: async () => undefined }),
  ).rejects.toThrow("Draft changed; preview again.");
});
