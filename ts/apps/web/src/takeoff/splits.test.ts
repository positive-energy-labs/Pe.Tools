import { expect, test } from "vite-plus/test";
import {module as openModule} from "../open/route";
import { takeoffGraph } from "./graph";
test("different questions cannot run their sibling's commands", () => {
  expect(takeoffGraph.verbs.partition).toBeUndefined();
  expect(openModule.spec.commands.stop).toMatchObject({ kind: "session", entry: "instances.stop" });
  expect(openModule.spec.commands).not.toHaveProperty("partition");
  expect(takeoffGraph.verbs).not.toHaveProperty("stop");
});
