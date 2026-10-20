/**
 * /ducts scene claims, deterministic: an element id in a claim's text reads as the element's name
 * (or a dot where the prose already names it). The `?demo=scene` fixture exercises one inference
 * and one omission.
 */
import { expect, it } from "vite-plus/test";

import { claimParts, elementNamer } from "./claims";
import { legsOf } from "./legs";
import { SCENE_FIXTURE } from "./scene.fixture";

const { snapshot, subject } = SCENE_FIXTURE;

it("an id resolves to its label, else a short kind; the prose's own noun makes it a dot; unknown numbers stay text", () => {
  const nameOf = elementNamer(snapshot, null);
  expect(nameOf(14577391)).toBe("MUAS-1");
  expect(nameOf(14107111)).toBe("end cap");
  expect(nameOf(14122436)).toBe("12″ duct");
  expect(nameOf(6105264)).toBeNull();
  expect(
    claimParts("duct 14122436 meets end cap 14107111 near 14577391; ERV 6105264.", nameOf),
  ).toEqual([
    "duct ",
    { id: 14122436, name: "12″ duct", dot: true },
    " meets end cap ",
    { id: 14107111, name: "end cap", dot: true },
    " near ",
    { id: 14577391, name: "MUAS-1", dot: false },
    "; ERV 6105264.",
  ]);
});

it("the scene fixture cuts the unjoined intake as inferred and one omission between FR-1 and FC-23", () => {
  const cut = legsOf(snapshot, subject);
  expect(cut.gaps).toEqual([]);
  expect(cut.inferred).toEqual([
    {
      after: 14107111,
      before: 14122436,
      findingId: "proximity:14122436:1|14106988",
      grade: "stretched",
      confirmed: false,
    },
  ]);
  expect(cut.omissions).toEqual([
    { after: 13760866, before: 13760867, skipped: [13761466, 13761629, 13761574] },
  ]);
});
