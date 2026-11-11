import { expect, test } from "vite-plus/test";
import { MARK_KINDS, markSchema, pictureScopeSchema, pictureSlotDataSchema } from "@pe/agent-contracts/slots";
import { documentKeyOf, subjectCode, uniqueIdSchema } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import { pictureSlot } from "./index.ts";

/*
 * Slice 8's red falsifier (routes MAP row 8). The Pod half is the Pod author's red test on
 * crusade/author-pod, examples/pods/hydronic/routes/sizing/sizing.test.ts: "kernel gap:
 * picture-slot (5)"; referenced, not copied. Green means: one fan port seen through two link
 * placements is two SubjectRefs the slot points, selects and frames by itself, an empty region
 * inspects to an empty set, and a Pod's scope and marks decode from the closed sets.
 */
const host = documentKeyOf("c:\\models\\site.rvt");
const fan = uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72");
const port = (link: string) =>
  subjectCode({ keyKind: "UniqueId", key: fan, placement: { host, links: [uniqueIdSchema.parse(link)] }, sub: { port: 1 } });

test("slice 8: point, select and frame a linked fan port in two placements, and inspect an empty region, with no route translator", () => {
  // A Pod fills the slot with scope and marks from the closed set; an open kind is refused.
  expect(pictureSlotDataSchema.parse({ scope: "subject", marks: ["ring", "label"] }).marks).toEqual(["ring", "label"]);
  expect(pictureSlotDataSchema.safeParse({ scope: "subject", marks: ["arrow"] }).success).toBe(false);
  expect(MARK_KINDS).toEqual(["ring", "outline", "bar", "volume", "label"]);

  const [a, b] = [port("1f3c2b9e-0000-4000-8000-000000000001-000000a1"), port("1f3c2b9e-0000-4000-8000-000000000002-000000b2")];
  expect(a).not.toBe(b);
  expect(markSchema.safeParse({ kind: "ring", at: a }).success).toBe(true);
  const emptyRegion = pictureScopeSchema.parse({
    kind: "prism",
    frame: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] },
    polygon: [[900, 900], [910, 900], [910, 910]],
    depth: [0, 10],
  });

  // The slot gets the subject and the capture, and no translator: SubjectRef is the only identity.
  const picture = pictureSlot({ scope: "subject" }, {}, {
    subject: [a, b],
    captured: [
      { ref: a, point: [448.6, 738.7, 1.8] },
      { ref: b, point: [449.6, 738.2, 20.7] },
    ],
  });
  picture.point(a);
  expect(picture.read()).toMatchObject({ pointed: [a], selected: [] });
  picture.select([a, b]);
  expect(picture.read().selected).toEqual([a, b]);
  picture.frame([a, b]);
  expect(picture.read().viewport).toEqual({
    center: [expect.closeTo(449.1, 1), expect.closeTo(738.45, 1), expect.closeTo(11.25, 1)],
    radius: expect.any(Number),
  });
  expect(picture.inspect(emptyRegion)).toEqual({ members: [] });
  expect(picture.marks()).toEqual([{ kind: "ring", at: { point: [448.6, 738.7, 1.8] } }]);
});
