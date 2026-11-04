import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { jsonCodec, identityCodecs } from "./route-kernel-codecs.ts";

test("JSON codecs decode syntax and schema at the address boundary", () => {
  const codec = jsonCodec(z.object({ value: z.number() }));
  expect(codec.decode(codec.encode({ value: 4 }))).toEqual({ ok: true, value: { value: 4 } });
  expect(codec.decode("{")).toEqual({ ok: false, reason: "Malformed route value" });
  expect(codec.decode('{"value":"4"}')).toEqual({ ok: false, reason: "Invalid route value" });
});

test("identity JSON stays canonical and preserves its namespace", () => {
  const encoded = identityCodecs.local.encode({ namespace: "system", subject: "Supply" });
  expect(encoded.ok).toBe(true);
  if (!encoded.ok) throw Error(encoded.reason);
  expect(identityCodecs.local.parts(encoded.value)).toEqual({
    namespace: "system",
    subject: "Supply",
  });
  expect(identityCodecs.local.decode('[ "system", "Supply" ]').ok).toBe(false);
});

test("native identity decoding refuses numeric IDs and cross-document link rebinding", () => {
  for (const text of [
    '["doc",null,"42"]',
    '["doc",null," "]',
    '["doc",["other","link-uid","linked"],"element-uid"]',
    '["doc",["doc","42","linked"],"element-uid"]',
    '[ "doc", null, "element-uid" ]',
  ])
    expect(identityCodecs.element.decode(text).ok, text).toBe(false);
  const text = '["doc",["doc","link-uid","linked"],"element-uid"]';
  const decoded = identityCodecs.element.decode(text);
  if (!decoded.ok) throw Error(decoded.reason);
  expect(identityCodecs.element.parts(decoded.value)).toEqual({
    document: "doc",
    uniqueId: "element-uid",
    link: { document: "doc", linkUniqueId: "link-uid", linkedDocument: "linked" },
  });
});
