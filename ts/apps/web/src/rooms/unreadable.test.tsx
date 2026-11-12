// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { ScopeBody } from "./mount";
import { RoomsProvider } from "./workspace";
import { roomsPageSchema } from "./page";
import { DEMO_ROOMS, DEMO_VIEW } from "./demo";
import type { RoomsContext } from "./route";

test("rooms lists unreadable blobs as can't read, kept with owner and reason", () => {
  const page = roomsPageSchema.parse({ view: DEMO_VIEW });
  const ctx = {
    value: { current: true, status: "current", value: { snapshot: {
      ...DEMO_ROOMS, unreadable: [{ elementId: null, parameter: "Pe.System", reason: "Broken owner envelope" }],
    } } },
    page: { read: () => ({ ...page, room: { kind: "all" } }) },
    target: { kind: "document", ref: { session: "fixture", openId: "rooms" } },
  } as unknown as RoomsContext;
  try {
    const view = render(<RoomsProvider ctx={ctx}><ScopeBody ctx={ctx} page={page} verbs={() => null} /></RoomsProvider>);
    expect(view.container.textContent).toContain("can't read, kept");
    expect(view.container.textContent).toContain("Pe.System");
    expect(view.container.textContent).toContain("Broken owner envelope");
  } finally { cleanup(); }
});
