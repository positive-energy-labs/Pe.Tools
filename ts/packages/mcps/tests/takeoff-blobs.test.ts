import { Schema } from "effect";
import { expect, test } from "vite-plus/test";
import { RegionProvenance, ZoneProvenance } from "../src/shared/takeoff-ops.ts";

// The blobs `Pe.Revit.Takeoff` writes (camelCase Newtonsoft): a decode, never a cast.
test("takeoff blobs decode the writer's shape and refuse a malformed one with its path", () => {
  expect(
    Schema.decodeUnknownSync(ZoneProvenance)('{"v":1,"view":"L1","name":"Z","systemTag":"AHU-1"}'),
  ).toMatchObject({ view: "L1", systemTag: "AHU-1" });
  expect(
    Schema.decodeUnknownSync(RegionProvenance)(
      '{"version":1,"runId":"r","sourceRoomId":"s","partition":{"disposition":2,"reason":null}}',
    ),
  ).toMatchObject({ runId: "r", partition: { disposition: 2 } });
  // A pre-camelCase blob reads as the same one camelCase field, whichever case the writer used.
  const pascal = Schema.decodeUnknownSync(RegionProvenance)('{"RunId":"r","SourceRoomId":"s"}');
  expect(pascal).toEqual({ runId: "r", sourceRoomId: "s" });
  expect(pascal).not.toHaveProperty("RunId");
  expect(Schema.decodeUnknownSync(RegionProvenance)('{"runId":null,"sourceRoomId":"s"}')).toEqual({
    sourceRoomId: "s",
  });
  expect(() => Schema.decodeUnknownSync(ZoneProvenance)('{"v":1,"name":"Z"}')).toThrow(/view/);
  expect(() =>
    Schema.decodeUnknownSync(RegionProvenance)('{"partition":{"disposition":true}}'),
  ).toThrow(/disposition/);
  expect(() => Schema.decodeUnknownSync(RegionProvenance)("{torn")).toThrow();
});
