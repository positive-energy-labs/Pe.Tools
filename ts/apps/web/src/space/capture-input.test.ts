import { test, expect } from "vite-plus/test";
import { spaceBinding, spacePageSchema } from "./graph";

test("capture ids are explicit reading inputs, never Page or selection", () => {
  const page = spacePageSchema.parse({});
  expect(page).not.toHaveProperty("ids");
  expect(spaceBinding("capture", { input: { elementIds: [101, 202] } }, { page }).args)
    .toMatchObject({ elementIds: [101, 202], focusOnly: true });
  expect(spaceBinding("capture", undefined, { page }).args).toMatchObject({ elementIds: [] });
  const region = { kind: "room" as const, uniqueId: "room-uid" };
  expect(spaceBinding("context", { input: { elementIds: [101] } }, { page: { ...page, region } }).args)
    .toMatchObject({ region, elementIds: [], focusOnly: false });
});
