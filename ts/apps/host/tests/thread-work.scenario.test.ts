import { actAs } from "./callers.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { createRouteRegistrations } from "@pe/mcps";
import { createPeRoutes } from "../src/pe-routes.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";

test("explicit Pea opens travel live through world and cannot address another conversation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-view-open-"));
  const app = createPeRoutes({
    registrations: createRouteRegistrations(),
    store: fileRouteDocumentStore(root),
    heads: { observe: () => () => {} },
    observeHostResource: hostResourceObserver(),
  });
  const abort = new AbortController();
  const stream = await app.fetch(
    new Request(
      `http://host/pe/resources?keys=${encodeURIComponent(JSON.stringify([{ kind: "world" }]))}`,
      { signal: abort.signal },
    ),
  );
  const reader = stream.body!.getReader();
  let buffer = "";
  const next = async () => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (data) return JSON.parse(data);
      } else {
        const chunk = await reader.read();
        if (chunk.done) throw Error("world ended");
        buffer += new TextDecoder().decode(chunk.value);
      }
    }
  };
  const open = (thread: string, route = "families") =>
    actAs({ kind: "pea", context: "test-context", thread: "selected-chat" }, () =>
        app.fetch(
          new Request(`http://host/pe/route-view/${route}/open`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ thread }),
          }),
        ),
    );
  try {
    expect((await next()).kind).toBe("gap");
    expect((await next()).kind).toBe("snapshot");
    expect((await open("other-chat")).status).toBe(403);
    const foreignSet = await actAs({ kind: "pea", context: "test-context", thread: "selected-chat" }, () =>
        app.fetch(
          new Request("http://host/pe/route-view/families/set", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              thread: "other-chat",
              instance: randomUUID(),
              revision: 1,
              patch: { query: "" },
            }),
          }),
        ),
    );
    expect(foreignSet.status).toBe(403);
    // An unregistered name never reaches the view store: the host's registration gate refuses it.
    expect((await open("selected-chat", "acme-unregistered")).status).toBe(404);
    const response = await open("selected-chat");
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect((await next()).value).toEqual({
      type: "route-view-open",
      route: "families",
      thread: "selected-chat",
      link: "/families",
      commandId: receipt.commandId,
    });
    const missing = await app.fetch(
      new Request("http://host/pe/route-view/families?thread=selected-chat"),
    );
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ ok: false, instances: [] });
    expect(await app.workspace.instances()).toMatchObject({ works: [] });
  } finally {
    abort.abort();
    await rm(root, { recursive: true, force: true });
  }
});
