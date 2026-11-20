import { describe, expect, test } from "vite-plus/test";
import { routeAddress } from "../route-address.ts";
import { podMemberCode } from "../pods-read.ts";

describe("an entity route's address", () => {
  test("Pods subject and run scope use the declared JSON field codec", () => {
    const pods = routeAddress("pods");
    expect(Object.keys(pods.agent.fields.shape)).toEqual(
      expect.arrayContaining(["member", "runs"]),
    );
    const page = {
      member: { kind: "ids" as const, ids: [podMemberCode({ pod: "p", path: "a.json" })] },
      runs: "pod" as const,
    };
    const link = pods.link(page);
    expect(
      pods.read(Object.fromEntries(new URL(link, "http://x").searchParams)).page,
    ).toMatchObject(page);
  });
});
