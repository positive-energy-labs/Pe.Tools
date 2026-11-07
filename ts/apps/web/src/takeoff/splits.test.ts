import { expect, test } from "vite-plus/test";
import {module as openModule} from "../open/route";
import { takeoffGraph } from "./graph";
test("different questions cannot run their sibling's commands", () => {
  expect(takeoffGraph.verbs.partition).toBeUndefined();
  expect(("stop" in openModule.spec.commands ? openModule.spec.commands.stop : undefined)).toBeUndefined();
});
