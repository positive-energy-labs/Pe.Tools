import { expect, test } from "vite-plus/test";
import { pageChoiceSchema, resolveCallTarget } from "@pe/agent-contracts";
import type { BridgeStateSnapshot } from "@pe/host-contracts/contracts";
import { decodeInventoryState } from "../src/bridge.ts";

test.each([
  "Chadds_detached.rvt",
  "",
  null,
  "C:/Jobs/Chadds.rvt",
  "12345678-abcd-1234-abcd-123456789abc",
])("native inventory decodes %s without losing its bindable lifetime", (address) => {
  const state: BridgeStateSnapshot = {
    activeDocumentCloudModelGuid: null,
    activeDocumentCloudModelUrn: null,
    activeDocumentCloudProjectGuid: null,
    activeDocumentIsFamilyDocument: false,
    activeDocumentIsModelInCloud: false,
    activeDocumentIsWorkshared: false,
    activeDocumentKey: null,
    activeDocumentObservedAtUnixMs: 1,
    activeDocumentPath: address,
    activeDocumentTitle: "Chadds",
    documentIdentity: null,
    hasActiveDocument: true,
    revitVersion: "2025",
    runtimeAssemblies: [],
    runtimeFramework: "test",
    sharedParametersFilename: null,
    openDocuments: [
      {
        openId: "detached",
        title: "Chadds",
        address,
        isFamilyDocument: false,
        isActive: true,
        projectHome: null,
      },
    ],
  };
  const row = decodeInventoryState(state).openDocuments[0]!;
  expect(row.address).toBe(address?.includes(":/") || address?.includes("abcd") ? address : null);
  const choice = pageChoiceSchema.parse({
    kind: "pinned",
    ref: { session: "S", openId: row.openId },
  });
  expect(choice.kind).toBe("pinned");
  expect(
    resolveCallTarget(
      { needs: "document", target: { kind: "open", ref: { session: "S", openId: row.openId } } },
      [],
      {
        kind: "ready",
        sessions: {
          S: { kind: "ready", values: [{ openId: row.openId, address: null, kind: "project" }] },
        },
      },
    ),
  ).toEqual({
    kind: "resolved",
    target: { kind: "document", ref: { session: "S", openId: "detached" } },
  });
});
