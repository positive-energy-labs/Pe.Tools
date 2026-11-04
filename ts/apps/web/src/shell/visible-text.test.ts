import { expect, test } from "vite-plus/test";
import { leaks } from "./visible-text";

test("Manual D's leaked strings are each caught; their human forms pass", () => {
  for (const bad of [
    "Fans · 78fb66ed-…@2",
    "FC-23 (00d1f963) / port 0",
    "9cb9f188-28aa-4094-8b76-785395cc35e1-00000002@0",
    "Fitting [1] · Specific Loss: no server → 0.1 in-wg",
    "Model store · store: absent → derived store",
    // Manual D re-drive #5 defect 7.
    "unit 8775469 / port 7",
    "14106988:0 connects to 14107098:0, which the snapshot does not hold",
    "heal → element 13771267",
    "auto-joined 1:1 to 2:0 across 2.000 in",
    "First write: document Chadds-manuald (session-a2ff31b15bd1edf7/92c6a5bb901b44978588633af34aef5b).",
    "MUAS-1 is element 14577391 in Chadds-manuald",
    "MUAS 10 [14577391] · PE_M_Fan_AirFlow: 900 cfm → 950 cfm",
  ])
    expect(leaks(bad), bad).not.toEqual([]);
  expect(leaks("sheet-inputs · succeeded", ["sheet-inputs"])).toEqual(["internal token sheet-inputs"]);
  for (const good of [
    "Fans · MUAS-1 / port 2",
    "FC-23 · Level 2 / port 0",
    "MUAS 10 · PE_M_Fan_AirFlow: 900 cfm → 950 cfm",
    "Specific Loss 0.03224273 in-wg · 09:45:05 · 1:100",
    "heal → an element outside this read",
    "Edit sheet inputs · succeeded",
    "Pe loss record (Project Information): none yet → created · planned",
  ])
    expect(leaks(good, ["sheet-inputs"]), good).toEqual([]);
});
