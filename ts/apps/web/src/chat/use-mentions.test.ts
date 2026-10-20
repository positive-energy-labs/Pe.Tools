import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture.ts";
import { expect, test } from "vite-plus/test";
import { capabilityCatalogSchema, documentRows } from "@pe/agent-contracts";

import { CHAT_SEEDS } from "#/chat/seeds";
import { EMPTY_CHAT_DRAFT } from "#/workbench/prompt";
import {
  dropMention,
  liveCatalog,
  MENTION_KINDS,
  mentionFace,
  mentionQuery,
  mentionRows,
  pickMention,
  withText,
} from "./use-mentions";

// What the composer's menu reads: the seed catalog with open documents from the seed inventory.
const seedCatalog = capabilityCatalogSchema.parse(CHAT_SEEDS.send.readings.capabilities);
const catalog = liveCatalog(seedCatalog, seedCatalog.machine);

test("@query at the caret finds a document first, a pick leaves the token and the mention, and deleting the token drops it", () => {
  expect(mentionQuery("mail me@x", 9)).toBeNull();
  const text = "check @ope";
  expect(mentionQuery(text, text.length)).toEqual({ start: 6, query: "ope" });

  // The open document comes from the inventory, grouped first.
  const rows = mentionRows(catalog, "ope");
  expect(rows[0]).toMatchObject({ key: "doc:pe.app-26/open-1", kind: "document" });
  const order = rows.map((row) => Object.keys(MENTION_KINDS).indexOf(row.kind));
  expect(order).toEqual([...order].sort((a, b) => a - b));

  const picked = pickMention({ ...EMPTY_CHAT_DRAFT, text }, text.length, rows[0]!, catalog);
  expect(picked.draft.text).toBe("check @Operations Demo.rvt ");
  expect(picked.caret).toBe(picked.draft.text.length);
  expect(picked.draft.mentions).toEqual([
    {
      key: "doc:pe.app-26/open-1",
      kind: "document",
      title: "Operations Demo.rvt",
      takenAt: catalog.at,
      facts: {
        session: "pe.app-26",
        openId: "open-1",
        address: "C:\\Review\\Operations Demo.rvt",
        family: false,
        active: true,
        revit: "2026",
        custody: "controlled",
      },
    },
  ]);

  expect(withText(picked.draft, "check @Operations Demo.rvt and more").mentions).toHaveLength(1);
  expect(withText(picked.draft, "check @Operations Demo").mentions).toEqual([]);

  // Removing the chip takes its token (and the space the pick left) out of the text.
  const dropped = dropMention(
    { ...picked.draft, text: `${picked.draft.text}and more` },
    rows[0]!.key,
  );
  expect(dropped.text).toBe("check and more");
  expect(dropped.mentions).toEqual([]);
});

test("a menu row reads: an op titled by its key takes its description's first clause, the key moves to the fact", () => {
  const op = {
    ...catalog.capabilities.find((row) => row.kind === "op")!,
    key: "op:parameter-links.read",
    title: "parameter-links.read",
    description:
      "Read the stored parameter-link profile and runtime status, and optionally evaluate it.",
  };
  expect(mentionFace(op, catalog)).toEqual({
    title: "Read the stored parameter-link profile",
    fact: "parameter-links.read",
    mono: true,
    detail: op.description,
  });
  // A real title stays; the key is still the fact.
  expect(mentionFace({ ...op, title: "Parameter links" }, catalog).title).toBe("Parameter links");
  // A document says its folder on the line, its whole address in the footer.
  const doc = mentionRows(catalog, "ope")[0]!;
  expect(mentionFace(doc, catalog)).toMatchObject({
    title: "Operations Demo.rvt",
    fact: "C:\\Review",
    detail: expect.stringContaining("C:\\Review\\Operations Demo.rvt"),
  });
});

test("recent documents group after Documents, say their folder or cloud project, and drop when the inventory has them open", () => {
  const recents = mentionRows(catalog, "").filter((row) => row.kind === "recent");
  expect(recents.map((row) => row.title)).toEqual([
    "Boiler Plant Retrofit",
    "MEP_Belmont_R26",
    "PE Duct Tag",
  ]);
  const kinds = mentionRows(catalog, "").map((row) => row.kind);
  expect(kinds.indexOf("recent")).toBe(kinds.lastIndexOf("document") + 1);
  expect(MENTION_KINDS.recent.group).toBe("Recent");
  expect(mentionFace(recents[0]!, catalog)).toMatchObject({
    fact: "Projects\\2611 Boiler Plant",
    detail: expect.stringContaining("C:\\Projects\\2611 Boiler Plant\\Boiler Plant Retrofit.rvt"),
  });
  expect(mentionFace(recents[1]!, catalog).fact).toBe("cloud · Belmont Studio");
  const picked = pickMention({ ...EMPTY_CHAT_DRAFT, text: "@boil" }, 5, recents[0]!, catalog);
  expect(picked.draft.mentions[0]).toMatchObject({
    kind: "recent",
    facts: { openWith: "C:\\Projects\\2611 Boiler Plant\\Boiler Plant Retrofit.rvt", open: false },
  });

  // The person opened it: the inventory's doc: row wins and the recent one goes.
  const inventory = seedCatalog.machine;
  const [session] = inventory.revit.sessions!;
  const opened = liveCatalog(catalog, {
    ...inventory,
    revit: {
      ...inventory.revit,
      sessions: [
        {
          ...session!,
          attachment: {
            ...session!.attachment!,
            documents: [
              ...(session!.attachment!.documents ?? []),
              {
                session: session!.attachment!.session,
                access: { kind: "read" },
                openId: "open-9",
                title: "Boiler Plant Retrofit",
                address: "C:\\Projects\\2611 Boiler Plant\\Boiler Plant Retrofit.rvt",
                isFamilyDocument: false,
                isActive: false,
              },
            ],
          },
        },
      ],
    },
  });
  expect(mentionRows(opened, "boiler").map((row) => row.kind)).toEqual(["document"]);
});

test("open documents come from the live inventory, not the catalog's own rows", () => {
  const stale = {
    ...catalog,
    capabilities: [...documentRows(catalog), ...catalog.capabilities],
  };
  const inventory = seedCatalog.machine;
  const at = "2026-10-12T18:00:00.000Z";
  const live = liveCatalog(stale, { ...inventory, observedAtUtc: at });
  expect(mentionRows(live, "ope")[0]).toMatchObject({ key: "doc:pe.app-26/open-1" });
  expect(live.at).toBe(at);
  // The document closed: its row goes, though the catalog read at mount still carries it.
  const closed = liveCatalog(stale, { ...inventory, revit: { ...inventory.revit, sessions: [] } });
  expect(mentionRows(closed, "ope").map((row) => row.kind)).not.toContain("document");
  expect(
    mentionRows(
      liveCatalog(stale, { ...inventory, revit: { ...inventory.revit, sessions: null } }),
      "ope",
    ).map((row) => row.kind),
  ).not.toContain("document");
});

test("live mentions use the same bounded discovery projection as Pea", () => {
  const machine = machineFixture([{ session: "s1", documents: null }]);
  Object.assign(machine.revit.sessions![0]!, {
    holdings: [
      {
        openId: "o1",
        title: "Fixture",
        holdings: {
          elements: Array.from({ length: 53139 }, (_, id) => ({
            id,
            category: "fixture",
            name: "HELD_SENTINEL",
            changedSinceSync: null,
            requesters: [],
          })),
          empty: false,
          savedNotSynced: null,
          unsaved: false,
          worksets: [],
          workshared: true,
        },
      },
    ],
  });
  const projected = liveCatalog(seedCatalog, machine);
  expect(JSON.stringify(projected).includes("HELD_SENTINEL")).toBe(false);
  expect(JSON.stringify(projected.machine).length).toBeLessThan(65536);
  expect(projected.machine.revit.sessions![0]!.holdings![0]!.holdings.elementCount).toBe(53139);
});
