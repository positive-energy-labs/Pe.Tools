import { describe, expect, test } from "vite-plus/test";
import { decode } from "../subject-ref.ts";
import { routeAddress } from "../route-address.ts";
import { spaceElementKey } from "./space.ts";

const space = routeAddress("space");
const element = { uniqueId: "e1-uid", hostDocumentKey: "host-a" };

describe("a Space scene element key is a SubjectRef", () => {
  test("the same element seen through two link instances has two keys", () => {
    const one = spaceElementKey({ ...element, linkInstanceUniqueId: "link-1" });
    const two = spaceElementKey({ ...element, linkInstanceUniqueId: "link-2" });
    expect(one).not.toBe(two);
    expect(decode(one)).toMatchObject({
      ok: true,
      value: { keyKind: "UniqueId", key: "e1-uid", placement: { links: ["link-1"] } },
    });
  });

  test("a host element keeps one key across a document-mark change", () => {
    const before = spaceElementKey(element);
    const after = spaceElementKey({ ...element, hostDocumentKey: "host-b" });
    expect(after).toBe(before);
    expect(decode(before)).toMatchObject({ ok: true, value: { keyKind: "UniqueId" } });
  });

  test("the old JSON-tuple spelling is refused at the selected door", () => {
    const old = JSON.stringify(["host-a", null, "e1-uid"]);
    expect(space.agent.patch.safeParse({ selected: old }).success).toBe(false);
    const linked = spaceElementKey({ ...element, linkInstanceUniqueId: "link-1" });
    expect(space.agent.patch.safeParse({ selected: linked }).success).toBe(true);
  });
});
