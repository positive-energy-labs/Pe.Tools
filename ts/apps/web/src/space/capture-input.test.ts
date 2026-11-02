import { test, expect } from "vite-plus/test";
import { spaceBinding, spacePageSchema } from "./graph";

test("capture ids are explicit reading inputs, never Page or selection", () => {
  const page = spacePageSchema.parse({});
  expect(page).not.toHaveProperty("ids");
  expect(
    spaceBinding("capture", { input: { elementIds: [101, 202] } }, { page }).args,
  ).toMatchObject({ elementIds: [101, 202], focusOnly: false });
  expect(spaceBinding("capture", undefined, { page }).args).toMatchObject({ elementIds: [] });
  const region = { kind: "room" as const, uniqueId: "room-uid" };
  expect(
    spaceBinding("context", { input: { elementIds: [101] } }, { page: { ...page, region } }).args,
  ).toMatchObject({ region, elementIds: [], focusOnly: false });
});

test("only the detailed action binds meshes, with at least five feet of context", () => {
  const page = spacePageSchema.parse({ region: { kind: "room", uniqueId: "room" } });
  for (const id of ["capture", "context"])
    expect(spaceBinding(id, undefined, { page }).args).toMatchObject({
      contextRepresentation: "overview",
    });
  expect(spaceBinding("detailed", undefined, { page }).args).toMatchObject({
    contextRepresentation: "meshes",
    contextPaddingFt: 15,
  });
});
