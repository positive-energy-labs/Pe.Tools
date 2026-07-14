import { expect, test } from "vite-plus/test";
import type { FamilyTypesDocument } from "@pe/agent-contracts";

import {
  familyTypesWriteError,
  selectRouteChatPlugin,
  summarizeFamilyTypes,
} from "./route-chat-plugins.tsx";

test("route chat plugins select registered routes for only the three route tools", () => {
  for (const toolName of ["route_state_read", "route_state_apply", "route_command"]) {
    expect(selectRouteChatPlugin(toolName, { route: "parameter-links" })?.route).toBe(
      "parameter-links",
    );
    expect(selectRouteChatPlugin(toolName, { route: "family-types" })?.route).toBe("family-types");
  }
});

test("route chat plugins ignore unregistered routes, other tools, and non-args routes", () => {
  expect(selectRouteChatPlugin("host_operation_call", { route: "parameter-links" })).toBeNull();
  expect(selectRouteChatPlugin("route_state_read", {})).toBeNull();
  expect(selectRouteChatPlugin("route_state_read", { route: "other" })).toBeNull();
  expect(selectRouteChatPlugin("route_state_read", null)).toBeNull();
});

test("family types chat summary keeps commit human-gated behind staged review", () => {
  const base: FamilyTypesDocument = {
    binding: { target: null },
    snapshot: null,
    doc: null,
    pushedAt: null,
    cells: {
      "MCA::Type A": {
        proposal: { value: "3 A", by: "pea", confidence: "high" },
        review: "none",
      },
      "MOCP::Type A": {
        proposal: { value: "15 A", by: "pea", confidence: "low" },
        staged: { value: "15 A" },
        review: "attention",
      },
    },
  };

  expect(summarizeFamilyTypes(base)).toMatchObject({
    proposalCount: 1,
    stagedCount: 1,
    attentionCount: 1,
    canPush: false,
  });

  base.cells["MOCP::Type A"].review = "good";
  expect(summarizeFamilyTypes(base).canPush).toBe(true);
});

test("family types chat summary includes open proposals that need attention", () => {
  const document: FamilyTypesDocument = {
    binding: { target: null },
    snapshot: null,
    doc: null,
    pushedAt: null,
    cells: {
      "Weight::Type A": {
        proposal: { value: "105.3 lb", by: "pea", confidence: "low" },
        review: "attention",
      },
    },
  };

  expect(summarizeFamilyTypes(document)).toMatchObject({
    proposalCount: 1,
    stagedCount: 0,
    attentionCount: 1,
    canPush: false,
  });
});

test("family types chat surfaces per-cell failures from a successful push command", () => {
  expect(
    familyTypesWriteError({
      ok: true,
      result: {
        applied: 2,
        failures: [
          {
            key: "MC Active Power::MUAS 8",
            error: "value references parameters",
          },
        ],
      },
    }),
  ).toBe("1 value failed: MC Active Power::MUAS 8: value references parameters");
  expect(familyTypesWriteError({ ok: true, result: { applied: 3, failures: [] } })).toBeNull();
});
