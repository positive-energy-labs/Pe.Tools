import { expect, test } from "vite-plus/test";
import {
  decode,
  encode,
  parameterSubject,
  type DocumentKey,
  type SubjectRef,
  type UniqueId,
} from "./subject-ref.ts";

const unique = (s: string) => s as UniqueId;
const doc = (s: string) => s as DocumentKey;
const host = doc("c:\projects\host.rvt");
const linked = doc("c:\projects\linked.rvt");
const roundTrip = (ref: SubjectRef) => {
  const code = encode(ref);
  if (!code.ok) throw Error(`${code.code}: ${code.reason}`);
  expect(decode(code.value)).toEqual({ ok: true, value: ref });
  return code.value;
};

test("one codec round-trips every key kind, placement and sub (ADR 0035 rule 2)", () => {
  expect(
    roundTrip({
      keyKind: "UniqueId",
      key: unique("9cb9f188-28aa-4094-8b76-785395cc35e1-00000001"),
    }),
  ).toBe("UniqueId:9cb9f188-28aa-4094-8b76-785395cc35e1-00000001");
  roundTrip({ keyKind: "system-name", key: "Supply Air 1" });
  roundTrip({ keyKind: "workspace", key: "schedules" });
  roundTrip({ keyKind: "region", key: "r-01" });
  roundTrip({ keyKind: "group", key: "g-01" });
  // a family type is part of the name tuple
  expect(roundTrip({ keyKind: "name", key: ["Supply Diffuser", "24x24 Lay-in", "Air Flow"] })).toBe(
    'name:["Supply Diffuser","24x24 Lay-in","Air Flow"]',
  );
  // a placement with two links, then both sub kinds, then a placement with a sub
  expect(
    roundTrip({
      keyKind: "UniqueId",
      key: unique("aaaa-1"),
      source: linked,
      placement: { host, links: [unique("link-a"), unique("link-b")] },
    }),
  ).toBe("UniqueId:aaaa-1~c%3a\projects\linked.rvt@c%3a\projects\host.rvt/link-a/link-b");
  expect(roundTrip({ keyKind: "UniqueId", key: unique("aaaa-1"), sub: { port: 2 } })).toBe(
    "UniqueId:aaaa-1#port:2",
  );
  expect(
    roundTrip({ keyKind: "UniqueId", key: unique("aaaa-1"), sub: { field: "Comments" } }),
  ).toBe("UniqueId:aaaa-1#field:Comments");
  roundTrip({
    keyKind: "UniqueId",
    key: unique("aaaa-1"),
    source: linked,
    placement: { host, links: [unique("link-a")] },
    sub: { port: 0 },
  });
  // escapes are total: every reserved byte inside a key, a document key and a field survives
  const nasty = "a%b:c~d@e#f/g";
  roundTrip({
    keyKind: "system-name",
    key: nasty,
    source: doc(nasty),
    placement: { host: doc(nasty), links: [unique(nasty)] },
    sub: { field: nasty },
  });
  roundTrip({ keyKind: "name", key: [nasty, '"quoted"'] });
});

test("every door refuses a document mark, a free-string sub, an unknown kind and a non-canonical spelling", () => {
  const mark = { session: "s1", openId: "open-7", observedSince: 1, changedAt: 2 };
  expect(
    encode({ keyKind: "UniqueId", key: unique("aaaa-1"), documentMark: mark } as never),
  ).toMatchObject({ ok: false, code: "document-mark" });
  expect(
    encode({ keyKind: "UniqueId", key: unique("aaaa-1"), source: mark } as never),
  ).toMatchObject({ ok: false, code: "document-mark" });
  // a session capability row (`doc:<session>/<openId>`) is not a document address key
  const row = "doc:s1/open-7" as DocumentKey;
  expect(encode({ keyKind: "UniqueId", key: unique("aaaa-1"), source: row })).toMatchObject({
    ok: false,
    code: "bad-source",
  });
  expect(
    encode({ keyKind: "UniqueId", key: unique("aaaa-1"), placement: { host: row, links: [unique("l")] } }),
  ).toMatchObject({ ok: false, code: "bad-placement" });
  expect(
    encode({ keyKind: "UniqueId", key: unique("aaaa-1"), sub: "port 2" } as never),
  ).toMatchObject({ ok: false, code: "bad-sub" });
  expect(decode("UniqueId:aaaa-1#2")).toMatchObject({ ok: false, code: "bad-sub" });
  expect(decode("UniqueId:aaaa-1#field:")).toMatchObject({ ok: false, code: "bad-sub" });
  expect(decode("element:aaaa-1")).toMatchObject({ ok: false, code: "unknown-kind" });
  expect(decode("aaaa-1")).toMatchObject({ ok: false, code: "malformed" });
  expect(decode("UniqueId:12345")).toMatchObject({ ok: false, code: "bad-key" });
  expect(decode("UniqueId:aaaa-1@doc-7")).toMatchObject({ ok: false, code: "bad-placement" });
  expect(decode("UniqueId:aaaa-1@doc-7/123")).toMatchObject({ ok: false, code: "bad-placement" });
  expect(decode("UniqueId:aaaa-1#port:2@doc-7/link-a")).toMatchObject({
    ok: false,
    code: "malformed",
  });
  expect(decode("UniqueId:a%zz")).toMatchObject({ ok: false, code: "bad-escape" });
  expect(decode("UniqueId:a:b")).toMatchObject({ ok: false, code: "malformed" });
  expect(decode('name:[ "A", "B" ]')).toMatchObject({ ok: false, code: "malformed" });
  expect(decode("name:{}")).toMatchObject({ ok: false, code: "bad-key" });
});

test("a parameter binding narrows to UniqueId with no sub and no placement (ADR 0035 rule 3)", () => {
  const plain: SubjectRef = { keyKind: "UniqueId", key: unique("aaaa-1") };
  expect(parameterSubject(plain)).toEqual({ ok: true, value: plain });
  expect(parameterSubject({ keyKind: "name", key: ["A", "B"] })).toMatchObject({
    ok: false,
    code: "bad-key",
  });
  expect(parameterSubject({ ...plain, sub: { port: 1 } })).toMatchObject({
    ok: false,
    code: "bad-sub",
  });
  expect(
    parameterSubject({ ...plain, placement: { host, links: [unique("link-a")] } }),
  ).toMatchObject({ ok: false, code: "bad-placement" });
});
