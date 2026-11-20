// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { routeAddress, workFingerprintSchema } from "@pe/agent-contracts";
import { mountTypedRoute } from "../shell/typed-mount";
import { module } from "./route";

function mounted(search = new URLSearchParams()) {
  const mount = mountTypedRoute(
    module,
    {
      address: {
        read: () => new URLSearchParams(search),
        write: (next) => {
          search = new URLSearchParams(next);
        },
        subscribe: () => () => {},
      },
      target: null,
      fixture: "send",
      work: { address: null, open: null },
      memory: () => ({}),
      custody: { current: () => true },
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
  );
  return { mount, search: () => search };
}

test("a copied thread link keeps title sort written by the kernel Page", () => {
  const { mount, search } = mounted();
  try {
    mount.page.query({ threadSort: "title" });
    const address = routeAddress("chat");
    const { page, carry } = address.read(Object.fromEntries(search()));
    const copied = address.link(page, { ...carry, thread: "t1" });
    expect(new URL(copied, "https://pe.test").searchParams.get("threadSort")).toBe("title");
  } finally {
    mount.dispose();
  }
});

test("a malformed thread search reloads as the inspectable refused search", () => {
  const { mount } = mounted(new URLSearchParams({ threadSearch: "broken" }));
  try {
    expect(mount.page.read().threadSearch).toEqual({ v: 0, keywords: "broken", pills: [] });
  } finally {
    mount.dispose();
  }
});
