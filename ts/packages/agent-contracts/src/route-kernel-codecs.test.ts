import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { jsonCodec } from "./route-kernel-codecs.ts";

test("JSON codecs decode syntax and schema at the address boundary", () => {
  const codec = jsonCodec(z.object({ value: z.number() }));
  expect(codec.decode(codec.encode({ value: 4 }))).toEqual({ ok: true, value: { value: 4 } });
  expect(codec.decode("{")).toEqual({ ok: false, reason: "Malformed route value" });
  expect(codec.decode('{"value":"4"}')).toEqual({ ok: false, reason: "Invalid route value" });
});
