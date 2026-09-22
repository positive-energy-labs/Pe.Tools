/**
 * 21 break 4: the capture picks and the matrix rows key by family NAME. Revit reissues ids on
 * reload, so an id-keyed pick is lost on the next reading; and a rename keeps the family's
 * UniqueId, so a UniqueId-keyed row would silently carry the old name's picks and cells over.
 */
import { expect, test } from "vite-plus/test";

import { nextPicks, pickedRowKeys, typeRowKey } from "./picks";

const rowsOf = (families: { id: number; name: string; unique: string }[]) =>
  families.flatMap(({ id, name }) =>
    ["T1", "T2"].map((typeName) => ({
      key: typeRowKey({ familyName: name }, typeName),
      familyId: id,
      familyName: name,
    })),
  );

test("selection survives a reading where the ids changed but the names did not", () => {
  const before = rowsOf([{ id: 101, name: "Alpha", unique: "U-a" }]);
  const picked = nextPicks(before, new Set(), new Set([before[0]!.key]));
  expect([...picked]).toEqual(["Alpha"]);
  // The reload reissued Alpha's id; the pick still selects both of its types.
  const after = rowsOf([{ id: 202, name: "Alpha", unique: "U-a" }]);
  expect([...pickedRowKeys(after, picked)]).toEqual(after.map((row) => row.key));
});

test("a rename shows as gone plus new: never silently the same row", () => {
  const before = rowsOf([{ id: 101, name: "Alpha", unique: "U-a" }]);
  const after = rowsOf([{ id: 101, name: "Alpha Renamed", unique: "U-a" }]);
  // Same UniqueId, same id: still a different row, because the name is the identity.
  expect(after.map((row) => row.key)).not.toEqual(before.map((row) => row.key));
  // Picks on the old name select nothing on the renamed family.
  expect(pickedRowKeys(after, new Set(["Alpha"])).size).toBe(0);
});
