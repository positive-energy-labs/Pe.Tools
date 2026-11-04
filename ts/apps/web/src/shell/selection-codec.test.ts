import { expect, test } from "vite-plus/test";
import { builtinData } from "../../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import type { DecodeResult } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { identityCodecs, selectionCodec } from "./page-port";

function value<T>(result: DecodeResult<T>): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

test("document, link, element and namespaced local identities round trip without delimiter loss", () => {
  const document = 'doc, "A"/%☃';
  const link = { document, linkUniqueId: 'link-uid,"1"', linkedDocument: "linked/B" };
  const element = { document, link, uniqueId: 'element-uid,"2"' };
  const local = { namespace: 'finding, "special"', subject: "row/%?&=☃" };
  const a = value(identityCodecs.document.encode({ document }));
  const b = value(identityCodecs.link.encode(link));
  const c = value(identityCodecs.element.encode(element));
  const d = value(identityCodecs.local.encode(local));
  expect(identityCodecs.document.parts(a)).toEqual({ document });
  expect(identityCodecs.link.parts(b)).toEqual(link);
  expect(identityCodecs.element.parts(c)).toEqual(element);
  expect(identityCodecs.local.parts(d)).toEqual(local);
  expect(value(identityCodecs.element.decode(c))).toBe(c);
  expect(value(identityCodecs.element.encode({ ...element, link: null }))).not.toBe(c);
  expect(
    value(
      identityCodecs.element.encode({
        ...element,
        link: { ...link, linkUniqueId: "other-instance" },
      }),
    ),
  ).not.toBe(c);
});

test("native identities refuse numeric aliases, wrong document links, empty parts and noncanonical bytes", () => {
  expect(identityCodecs.element.encode({ document: "d", link: null, uniqueId: "42" }).ok).toBe(
    false,
  );
  expect(
    identityCodecs.link.encode({ document: "d", linkUniqueId: "42", linkedDocument: "e" }).ok,
  ).toBe(false);
  expect(identityCodecs.element.decode('["d",42,"uid"]').ok).toBe(false);
  expect(identityCodecs.element.decode('["d",["other","link-uid","linked"],"uid"]').ok).toBe(false);
  expect(identityCodecs.element.decode('["d",null,42]').ok).toBe(false);
  expect(identityCodecs.document.decode('[ "d" ]').ok).toBe(false);
  expect(identityCodecs.document.decode('["d","extra"]').ok).toBe(false);
  expect(identityCodecs.local.encode({ namespace: "", subject: "x" }).ok).toBe(false);
  expect(identityCodecs.local.encode({ namespace: "finding", subject: " " }).ok).toBe(false);
});

test("selection is ordered distinct pairs and URL encoding happens once around the whole JSON value", () => {
  const codec = selectionCodec(builtinData, builtinData.fields.selected.kinds);
  const first = {
    kind: "system",
    id: value(identityCodecs.local.encode({ namespace: "system", subject: 'a,b/"☃"' })),
  };
  const second = {
    kind: "element",
    id: value(identityCodecs.element.encode({ document: "d", link: null, uniqueId: "uid-a" })),
  };
  const encoded = value(codec.encode([first, second, first]));
  const url = new URL("https://example.test/tiny");
  url.searchParams.set("selected", encoded);
  expect(value(codec.decode(new URL(url.href).searchParams.get("selected")!))).toEqual([
    first,
    second,
  ]);
  expect(value(codec.decode("[]"))).toEqual([]);
  for (const bad of [
    "all",
    ["x"],
    [{ ...first, extra: true }],
    [{ kind: "element", id: first.id }],
    [{ kind: "__proto__", id: first.id }],
  ]) {
    expect(codec.normalize(bad).ok).toBe(false);
  }
  const restricted = selectionCodec(builtinData, ["system"]);
  expect(restricted.normalize([second]).ok).toBe(false);
  const sharedKind = selectionCodec(
    {
      ...builtinData,
      identities: { ...builtinData.identities, finding: { kind: "local", codec: "local" } },
    },
    ["system", "finding"],
  );
  expect(value(sharedKind.normalize([first, { ...first, kind: "finding" }]))).toHaveLength(2);
});
