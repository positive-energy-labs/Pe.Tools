import { machineFixture } from "./machine-fixture.ts";
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
  recentRows,
} from "../src/mention.ts";

const catalog: Pick<CapabilityCatalog, "at" | "machine"> = {
  at: "2026-10-12T12:00:00.000Z",
  machine: machineFixture([
    {
      session: "b1",
      documents: [
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
    { session: "b2", documents: null },
  ]),
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
    key: "skill:@product/skills/build-pod",
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
    key: "skill:@product/skills/build-pod",
    kind: "skill",
    title: "build-pod",
    takenAt: "2026-10-12T12:00:00.000Z",
    facts: { description: "Build a Pod.", needs: "nothing", mutates: false },
  });
});

const local = (path: string, year: number, rank: number) => ({
  title: path
    .split("\\")
    .at(-1)!
    .replace(/\.\w+$/, ""),
  path,
  isCloud: false,
  region: null,
  projectGuid: null,
  modelGuid: null,
  year,
  savedYear: year,
  rank,
});
const cloud = {
  title: "MEP_Belmont_R23",
  path: "cld://US/{bd39078b-b752-475d-9de5-e542894a9eaa}PE%202023%20Projects/{890eeb3d-5633-4964-be48-0aa4f686ed1d}MEP_Belmont_R23.rvt",
  isCloud: true,
  region: "US",
  projectGuid: "bd39078b-b752-475d-9de5-e542894a9eaa",
  modelGuid: "890eeb3d-5633-4964-be48-0aa4f686ed1d",
  year: 2023,
  savedYear: null,
  rank: 1,
};
const withRecents = {
  ...catalog,
  recents: [
    local("C:\\Models\\Plant.rvt", 2024, 3),
    // The same file in two years' lists: one row, its most recent entry.
    local("C:\\Templates\\Base.rvt", 2023, 15),
    local("c:\\templates\\base.rvt", 2026, 2),
    // Open now (session b1's Riser): the doc: row wins.
    local("C:\\Models\\Riser.rvt", 2025, 1),
    cloud,
  ],
};

it("recentRows keys local files by path and cloud models by guids, drops open ones, ranks below open documents", () => {
  const rows = recentRows(withRecents);
  expect(rows.map((row) => [row.key, row.kind, row.title, row.rank])).toEqual([
    [
      "recent:cloud:US/bd39078b-b752-475d-9de5-e542894a9eaa/890eeb3d-5633-4964-be48-0aa4f686ed1d",
      "recent",
      "MEP_Belmont_R23",
      -1,
    ],
    ["recent:c:\\templates\\base.rvt", "recent", "base", -2],
    ["recent:C:\\Models\\Plant.rvt", "recent", "Plant", -3],
  ]);
  expect(rows[0]).toMatchObject({
    finds: ["US", "PE 2023 Projects", "MEP_Belmont_R23.rvt"],
    description: expect.stringMatching(/^Recent cloud model from Revit 2023/),
    needs: "nothing",
    mutates: false,
    actor: "any",
    source: "recents",
  });
  // A local key already carries its path; the words count once, through the key.
  expect(rows[2]!.finds).toEqual([]);
  expect(rows[2]!.description).toMatch(/^Recent local file from Revit 2024/);
  // Every open document outranks every recent one.
  expect(Math.max(...rows.map((row) => row.rank))).toBeLessThan(
    Math.min(...documentRows(catalog).map((row) => row.rank)),
  );
  // An open cloud model is matched by its guid, the address the bridge reports for it.
  const cloudOpen = {
    ...withRecents,
    machine: machineFixture([
      {
        session: "b3",
        documents: [
          {
            openId: "c1",
            address: cloud.modelGuid.toUpperCase(),
            title: cloud.title,
            isFamilyDocument: false,
            isActive: true,
          },
        ],
      },
    ]),
  };
  expect(recentRows(cloudOpen).map((row) => row.key)).not.toContain(rows[0]!.key);
  expect(findCapabilities(rows, { query: "belmont" }).map((row) => row.key)).toEqual([
    rows[0]!.key,
  ]);
});

it("recentRows drops templates, labels families, and an open document wins a shared search", () => {
  const recent = (path: string, title: string, rank: number) => ({
    isCloud: false,
    modelGuid: null,
    projectGuid: null,
    region: null,
    path,
    title,
    rank,
    year: 2026,
    savedYear: 2026,
  });
  const rows = recentRows({
    machine: machineFixture([
      {
        session: "s1",
        documents: [
          {
            openId: "o1",
            address: "C:JobsRiser.rvt",
            title: "Riser",
            isFamilyDocument: false,
            isActive: false,
          },
        ],
      },
    ]),
    recents: [
      recent("C:TemplatesMEP.rte", "MEP", 1),
      recent("C:FamiliesDamper.rfa", "Damper", 2),
      recent("C:JobsRiser Old.rvt", "Riser Old", 3),
    ],
  });
  expect(rows.map((row) => row.title)).toEqual(["Damper", "Riser Old"]);
  expect(rows[0]!.description).toMatch(/^Recent family file/);
  const open = documentRows({
    machine: machineFixture([
      {
        session: "s1",
        documents: [
          {
            openId: "o1",
            address: "C:JobsRiser.rvt",
            title: "Riser",
            isFamilyDocument: false,
            isActive: false,
          },
        ],
      },
    ]),
  });
  expect(findCapabilities([...rows, ...open], { query: "riser" })[0]!.key).toBe("doc:s1/o1");
});

it("mentionOf a recent row snapshots where it lives and the source that opens it", () => {
  const [cloudRow, , plantRow] = recentRows(withRecents);
  expect(mentionOf(plantRow!, withRecents)).toEqual({
    key: "recent:C:\\Models\\Plant.rvt",
    kind: "recent",
    title: "Plant",
    takenAt: "2026-10-12T12:00:00.000Z",
    facts: {
      path: "C:\\Models\\Plant.rvt",
      cloud: false,
      region: null,
      projectGuid: null,
      modelGuid: null,
      year: 2024,
      savedYear: 2024,
      open: null,
      openWith: "C:\\Models\\Plant.rvt",
    },
  });
  const mention = mentionOf(cloudRow!, withRecents);
  expect(mention.facts).toMatchObject({
    cloud: true,
    region: "US",
    modelGuid: cloud.modelGuid,
    year: 2023,
    savedYear: null,
    openWith: cloud.path,
  });
  expect(mentionSchema.parse(mention)).toEqual(mention);
  // Recents gone from the catalog: a local key still says its path; a cloud key cannot.
  expect(mentionOf(plantRow!, catalog).facts).toMatchObject({ openWith: "C:\\Models\\Plant.rvt" });
  expect(mentionOf(cloudRow!, catalog).facts).toMatchObject({ path: null, openWith: null });
});

it("recentRows preserves unknown open state and omits documents held by a disconnected session", () => {
  const rows = recentRows(withRecents);
  expect(rows.every((row) => row.description.includes("open state unknown"))).toBe(true);
  const known = { ...withRecents, machine: machineFixture() };
  expect(mentionOf(recentRows(known)[0]!, known).facts.open).toBe(false);
  const held = structuredClone(withRecents);
  held.machine = {
    ...held.machine,
    revit: {
      ...held.machine.revit,
      sessions: [
        {
          ...held.machine.revit.sessions![0]!,
          attachment: null,
          documents: [{ path: "C:\\Models\\Plant.rvt" }] as never,
        },
      ],
    },
  };
  expect(recentRows(held).some((row) => row.title === "Plant")).toBe(false);
});
