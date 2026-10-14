import { expect, test } from "vite-plus/test";
import { readRequestIdentity, type IdentityOptions } from "../src/request-identity.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { peRoutes } from "@pe/agent-contracts/pe-api";
import {
  admitRequest,
  mintBrowserContext,
  mintContext,
  retireContext,
  type RoutePermission,
} from "../src/control.ts";

const options: IdentityOptions = {
  port: () => 5180,
  frontendOrigin: () => undefined,
  share: {
    observe: () => {},
    read: async () => ({
      desired: "off",
      state: "off",
      url: null,
      refusal: null,
      callers: [],
      refused: [],
      allowRemoteAdministration: false,
    }),
  },
};
const local = { host: "127.0.0.1:5180", "x-pe-runtime-service": hostOwnership.serviceName };

// `/call` admits an anonymous caller only for the add-in's Pod reads (anonymous-call.test.ts).
test.each(
  Object.entries(peRoutes).filter(
    ([, route]) =>
      route.method !== "GET" && route.permission !== "operation" && route.permission !== "pair",
  ),
)("access-041/085: anonymous declared write %s is refused before routing", async (_id, route) => {
  const path = route.path.replace(/:[\w]+/g, "fixture");
  expect(await readRequestIdentity(local, path, options, route.method)).toMatchObject({
    refusal: { code: "context.missing" },
  });
});

test("the table's human read and consent requirements are enforced at admission", async () => {
  expect(
    await readRequestIdentity(local, "/pe/route-state/families/salvage", options),
  ).toMatchObject({
    refusal: { code: "context.missing" },
  });
  const token = mintContext({ kind: "pea", thread: "t" });
  try {
    expect(
      await readRequestIdentity(
        { ...local, "x-pe-context": token },
        "/pe/scope/t/revoke",
        options,
        "POST",
      ),
    ).toMatchObject({
      refusal: { code: "human.only" },
    });
    expect(
      await readRequestIdentity(
        { ...local, origin: "http://127.0.0.1:5180", referer: "http://127.0.0.1:5180/pages/p/" },
        "/pe/pages/p/binding",
        options,
        "PUT",
      ),
    ).toMatchObject({
      refusal: { code: "human.only" },
    });
  } finally {
    retireContext(token);
  }
});

test("access-085: an omitted route permission fails closed even for a human", () => {
  expect(() =>
    admitRequest(
      { kind: "human", via: "cli" },
      undefined as unknown as RoutePermission,
      "POST /pe/new-admin",
    ),
  ).toThrow("permission.undeclared");
});

// Paths cover each write family, including unknown future routes. Admission precedes routing.
test.each([
  "/actions",
  "/pe/threads",
  "/pe/threads/t/prompt",
  "/pe/threads/t/permission",
  "/pe/threads/t/question",
  "/pe/threads/t/fork",
  "/pe/scope/t",
  "/pe/scope/t/revoke",
  "/pe/views/families",
  "/pe/work/families",
  "/pages/p/text",
  "/pages/p/events",
  "/pages/p/snapshot",
  "/pages/p/binding",
  "/host/update",
  "/host/update/automatic",
  "/admin/shutdown",
  "/admin/window",
  "/pe/providers",
  "/pe/access",
  "/pe/share",
  "/future-write",
])("access-041: anonymous POST %s is refused at admission", async (path) => {
  expect(await readRequestIdentity(local, path, options, "POST")).toMatchObject({
    refusal: { code: "context.missing" },
  });
});

test("access-053: browser headers alone never mint a human", async () => {
  expect(
    await readRequestIdentity(
      {
        ...local,
        origin: "http://127.0.0.1:5180",
        referer: "http://127.0.0.1:5180/chat",
        "sec-fetch-site": "same-origin",
      },
      "/actions",
      options,
      "POST",
    ),
  ).toMatchObject({ refusal: { code: "context.missing" } });
});

test("browser sessions belong to one runtime, so sibling hosts do not replace each other's cookie", () => {
  expect(mintBrowserContext({ kind: "local" })).toContain(hostOwnership.serviceName);
});

test("access-053: a host-minted browser cookie carries a human and cannot cross transport", async () => {
  const cookie = mintBrowserContext({ kind: "local" }).split(";")[0];
  expect(
    await readRequestIdentity(
      { ...local, origin: "http://127.0.0.1:5180", referer: "http://127.0.0.1:5180/chat", cookie },
      "/actions",
      options,
      "POST",
    ),
  ).toMatchObject({ caller: { kind: "human", via: "local" } });
});

test.each(["/admin/shutdown", "/admin/window"])(
  "access-042/043: SDK-authorized service reaches only %s",
  async (path) => {
    expect(await readRequestIdentity(local, path, options, "POST", true)).toMatchObject({
      caller: { kind: "service", service: hostOwnership.serviceName },
    });
    expect(await readRequestIdentity(local, "/pe/threads", options, "POST", true)).toMatchObject({
      refusal: { code: "human.only" },
    });
  },
);

test("access-044: MCP admission permits initialize to mint its restricted context", async () => {
  expect(await readRequestIdentity(local, "/mcp", options, "POST")).toMatchObject({
    caller: { kind: "anonymous" },
  });
});

test.each(["question", "permission"])("access-048/049: Pea cannot answer %s", async (verb) => {
  const token = mintContext({ kind: "pea", thread: "t" });
  try {
    expect(
      await readRequestIdentity(
        { ...local, "x-pe-context": token },
        `/pe/threads/t/${verb}`,
        options,
        "POST",
      ),
    ).toMatchObject({ refusal: { code: "human.only" } });
  } finally {
    retireContext(token);
  }
});

test("pairing is the sole declared unauthenticated handshake mutation", () => {
  expect(
    Object.entries(peRoutes)
      .filter(([, route]) => route.permission === "pair")
      .map(([id]) => id),
  ).toEqual(["device.claim"]);
});
