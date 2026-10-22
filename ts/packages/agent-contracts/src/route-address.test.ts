import { describe, expect, test } from "vite-plus/test";
import { linkTo, readLink, writeSearch } from "./route-address.ts";

describe("a layers field", () => {
  test("opens on its declared set, and the address stays bare there", () => {
    expect(readLink("ducts", {}).page.layers).toEqual(["meshes", "labels", "findings"]);
    expect(writeSearch("ducts", { layers: ["meshes", "labels", "findings"] })).toEqual({
      layers: undefined,
    });
    expect(linkTo("space", { layers: ["meshes", "context", "cuts"] })).toBe("/space");
  });

  test("every layer off is none, and reads back as none", () => {
    expect(linkTo("ducts", { layers: [] })).toBe("/ducts?layers=");
    expect(readLink("ducts", { layers: "" }).page.layers).toEqual([]);
    expect(readLink("rooms", { layers: "faces,rails" }).page.layers).toEqual(["faces", "rails"]);
  });

  test("an unknown layer name falls to the default", () => {
    expect(readLink("ducts", { layers: "none" }).page.layers).toEqual([
      "meshes",
      "labels",
      "findings",
    ]);
  });
});
