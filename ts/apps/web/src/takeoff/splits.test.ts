import { expect, test } from "vite-plus/test";
import { openGraph } from "../open/graph";
import { takeoffGraph } from "./graph";
test("different questions cannot run their sibling's commands", () => {
  expect(takeoffGraph.verbs.partition).toBeUndefined();
  expect(openGraph.verbs.stop).toBeUndefined();
});
