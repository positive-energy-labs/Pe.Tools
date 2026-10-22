import { expect, test } from "vite-plus/test";
import { readRequestIdentity, type IdentityOptions } from "../src/request-identity.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { peRoutes } from "@pe/agent-contracts/pe-api";
import { admitRequest, type RoutePermission } from "../src/control.ts";

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
      route.method !== "GET" &&
      route.permission !== "read" &&
      route.permission !== "operation" &&
      route.permission !== "pair",
  ),
)("access-041/085: anonymous declared write %s is refused before routing", async (_id, route) => {
  const path = route.path.replace(/:[\w]+/g, "fixture");
  expect(await readRequestIdentity(local, path, options, route.method)).toMatchObject({
    refusal: { code: "context.missing" },
  });
});

test.each(
  Object.entries(peRoutes).filter(
    ([, route]) => route.method !== "GET" && route.permission === "read",
  ),
)(
  "anonymous declared read %s retains read admission regardless of HTTP method",
  async (_id, route) => {
    const path = route.path.replace(/:[\w]+/g, "fixture");
    expect(await readRequestIdentity(local, path, options, route.method)).toMatchObject({
      caller: { kind: "anonymous" },
    });
  },
);

test("access-085: an omitted route permission fails closed even for a human", () => {
  expect(() =>
    admitRequest(
      { kind: "human", via: "cli" },
      undefined as unknown as RoutePermission,
      "POST /pe/new-admin",
    ),
  ).toThrow("permission.undeclared");
});
