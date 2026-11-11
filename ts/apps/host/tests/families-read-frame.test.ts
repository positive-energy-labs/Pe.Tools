import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { READING_MAX_FRAME_BYTES } from "@pe/agent-contracts";
import { familyActions } from "../../../packages/agent-contracts/src/family-actions.ts";
import { familiesReadResult } from "../src/family-actions.ts";

/*
 * gate-ef940d36: Start, Air Terminals (35 families), Read families: the receipt succeeded, then the
 * mount's own watch of that receipt failed "Resource value exceeds the frame limit". The receipt
 * carried the whole observation as its result (2,954,532 bytes against a 2 MiB frame). This is the
 * drive's own capture (ev/families-capture.json), gzipped.
 */
const capture = JSON.parse(gunzipSync(readFileSync(new URL("./native-recordings/families-air-terminals.observation.json.gz", import.meta.url))).toString("utf8"));

test("the families.read receipt for gate-ef940d36's Air Terminals read fits one reading frame, as its contract says", () => {
  const result = familiesReadResult(capture, 3);
  expect(familyActions["families.read"].result.parse(result)).toEqual(result);
  const frame = JSON.stringify({ kind: "snapshot", key: "receipts", value: [{ id: "r", key: "families.read", state: "succeeded", result }] });
  expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(READING_MAX_FRAME_BYTES);
});
