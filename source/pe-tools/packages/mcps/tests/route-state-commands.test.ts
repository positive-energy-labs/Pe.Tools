import { expect, test } from "vite-plus/test";
import {
  address,
  type ParameterLinkProfile,
  type ParameterLinksDocument,
  parameterLinksRouteState,
} from "@pe/agent-contracts";

const DOCUMENT_ADDRESS = address("C:\\Models\\A.rvt");
import { createParameterLinksCommandHandlers } from "../src/pea/route-state-commands.ts";

// The dispatcher hands handlers `input.safeParse(payload).data`, and zod strips undeclared keys —
// so each command schema must accept exactly what the web plugin sends (route-chat-plugins.tsx):
// `{}` for refresh, `{ profile }` for preview/apply. A schema/client mismatch here silently
// drops the reviewed profile and breaks the human apply lane.
test("parameter links command schemas pass the web client payloads through to handlers", () => {
  const profile = reviewedProfile();
  const commands = parameterLinksRouteState.commands;

  expect(commands.refresh.input.safeParse({}).success).toBe(true);
  for (const name of ["preview", "apply"] as const) {
    const parsed = commands[name].input.safeParse({ profile });
    expect(parsed.success).toBe(true);
    expect((parsed.data as { profile: ParameterLinkProfile }).profile).toEqual(profile);
  }
});

function reviewedProfile(): ParameterLinkProfile {
  return {
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
}

test("parameter links apply rejects a reviewed profile after the draft changes", async () => {
  const reviewed: ParameterLinkProfile = reviewedProfile();
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
    apply(
      { profile: reviewed },
      {
        documentAddress: DOCUMENT_ADDRESS,
        getDoc: () => document,
        setDoc: async () => undefined,
      },
    ),
  ).rejects.toThrow("Draft changed; preview again.");
});
