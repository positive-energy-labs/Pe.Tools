import { expect, test } from "vite-plus/test";
import { familyRoster } from "./store";

const row = (familyId: number, familyName: string, placedInstanceCount: number, categoryName = "Mechanical Equipment") => ({
  familyId,
  familyName,
  categoryName,
  placedInstanceCount,
});

test("N2: the family picker draws one row per name, keyed by that name, however often the catalog repeats it", () => {
  const clearance = "!Mechanical Equipment_Clearance_Rectangular_UH";
  const magna = "Magna3 - Mechanical Equipment";
  const catalog = [
    row(1, clearance, 4),
    row(2, magna, 2),
    row(1, clearance, 4), // the same family delivered twice
    row(2, magna, 2),
    row(3, "Broan_B1X0E65RT_ERV", 1),
    row(4, magna, 0), // a second family under the same name
    row(5, "Unplaced Pump", 0),
    row(6, "Other Category", 3, "Plumbing Fixtures"),
  ];
  const roster = familyRoster(catalog, { categories: ["Mechanical Equipment"], placement: "AllLoaded" });
  const ids = roster.map((option) => option.id);
  expect(ids).toEqual([clearance, "Broan_B1X0E65RT_ERV", magna, "Unplaced Pump"]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(roster.find((option) => option.id === clearance)!.sub).toBe("4 placed");
  expect(roster.find((option) => option.id === magna)!.sub).toBe("2 placed · 2 families share this name");
  expect(
    familyRoster(catalog, { categories: ["Mechanical Equipment"], placement: "UnplacedOnly" }).map((o) => o.id),
  ).toEqual(["Unplaced Pump"]);
});
