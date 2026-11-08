import { fansDocumentSchema } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";
import type { WorkPatch } from "../../../../packages/agent-contracts/src/route-kernel-bodies";

const slot = {
  path: ["parameters", "fanFlow"],
  value: { edit: { value: "PE_M_Fan_AirFlow" } },
} as const;
const typedSlot: WorkPatch<typeof fansDocumentSchema> = slot;
const drop: WorkPatch<typeof fansDocumentSchema> = {
  path: ["componentDrops", "14607308"],
  value: { edit: { value: { inWg: 0.0132 } } },
};
const replacement: WorkPatch<typeof fansDocumentSchema> = {
  path: ["parameters"],
  value: { fanFlow: { edit: { value: "PE_M_Fan_AirFlow" } } },
};

test("drive-7 S0/S8a: finite slot keys are accepted by typed Work patches", () => {
  expect(
    fansDocumentSchema.parse({ parameters: { fanFlow: slot.value } }).parameters.fanFlow,
  ).toEqual(slot.value);
  expect(typedSlot).toEqual(slot);
  expect(drop.path).toHaveLength(2);
  expect(replacement.path).toHaveLength(1);
});
