import { expect, it } from "vite-plus/test";
import type { Capability, CapabilityCatalog } from "../src/capability.ts";
import { findCapabilities } from "../src/capability.ts";
import {
  documentKey,
  documentRows,
  mentionOf,
  mentionSchema,
  mentionToken,
  parseDocumentKey,
} from "../src/mention.ts";

const catalog: Pick<CapabilityCatalog, "at" | "sessions"> = {
  at: "2026-10-12T12:00:00.000Z",
  sessions: [
    {
      sessionId: "b1",
      custody: "controlled",
      revitVersion: "2025",
      openDocuments: [
        {
          openId: "o1",
          address: "C:\\Models\\Riser.rvt",
          title: "Riser",
          isFamilyDocument: false,
          isActive: true,
        },
        { openId: "o2", address: null, title: "Elbow", isFamilyDocument: true, isActive: false },
      ],
    },
    // No id: nothing to point through.
    {
      openDocuments: [
        { openId: "o3", address: null, title: "Lost", isFamilyDocument: false, isActive: true },
      ],
    },
    { sessionId: "b2", openDocuments: null },
  ],
};

it("document keys round-trip and refuse other keys", () => {
  expect(parseDocumentKey(documentKey("b1", "o/1"))).toEqual({ session: "b1", openId: "o/1" });
  expect(parseDocumentKey("doc:/o1")).toBeNull();
  expect(parseDocumentKey("skill:build-pod")).toBeNull();
});

it("documentRows makes one row per open document of each identified session", () => {
  const rows = documentRows(catalog);
  expect(rows.map((row) => [row.key, row.kind, row.title, row.rank])).toEqual([
    ["doc:b1/o1", "document", "Riser", 1],
    ["doc:b1/o2", "document", "Elbow", 0],
  ]);
  expect(rows[0]).toMatchObject({
    finds: ["C:\\Models\\Riser.rvt", "project"],
    description: "Project document open in Revit 2025",
    needs: "nothing",
    mutates: false,
    actor: "any",
  });
  expect(findCapabilities(rows, { query: "riser" }).map((row) => row.key)).toEqual(["doc:b1/o1"]);
  expect(findCapabilities(rows, { query: "family" }).map((row) => row.key)).toEqual(["doc:b1/o2"]);
});

it("mentionOf snapshots a document's session facts and any other row's routing facts", () => {
  const [riser] = documentRows(catalog);
  const document = mentionOf(riser!, catalog);
  expect(document).toEqual({
    key: "doc:b1/o1",
    kind: "document",
    title: "Riser",
    takenAt: "2026-10-12T12:00:00.000Z",
    facts: {
      session: "b1",
      openId: "o1",
      address: "C:\\Models\\Riser.rvt",
      family: false,
      active: true,
      revit: "2025",
      custody: "controlled",
    },
  });
  expect(mentionSchema.parse(document)).toEqual(document);
  expect(mentionToken(document)).toBe("@Riser");

  // A closed document still mentions its pointer; what is unknown says null.
  const closed = mentionOf({ ...riser!, key: "doc:b1/gone" }, catalog);
  expect(closed.facts).toMatchObject({
    session: "b1",
    openId: "gone",
    address: null,
    active: null,
  });

  const skill: Capability = {
    key: "skill:build-pod",
    kind: "skill",
    title: "build-pod",
    description: "Build a Pod.",
    needs: "nothing",
    mutates: false,
    actor: "any",
    input: {},
    source: "skills",
    rank: 0,
  };
  expect(mentionOf(skill, catalog)).toEqual({
    key: "skill:build-pod",
    kind: "skill",
    title: "build-pod",
    takenAt: "2026-10-12T12:00:00.000Z",
    facts: { description: "Build a Pod.", needs: "nothing", mutates: false },
  });
});
