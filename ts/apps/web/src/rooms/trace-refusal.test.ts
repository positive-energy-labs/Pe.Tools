import { expect, test } from "vite-plus/test";
import { traceRefusal } from "./goal";

/** Drive 7, fix line 3: the pane drew the bridge's exception for "nothing partitioned here yet". */
test("no traced zone is one plain sentence; any other failure keeps its own words", () => {
  for (const raw of [
    "BridgeError: no rooms.partition run has traced a zone on '01 Mechanical Plan - Level 1'",
    "BridgeError: run 'abc' traced no zone on 'L1'",
  ])
    expect(traceRefusal(raw)).toBe("No zones traced yet");
  expect(traceRefusal("BridgeError: view 'L1' not found")).toBe("BridgeError: view 'L1' not found");
});
