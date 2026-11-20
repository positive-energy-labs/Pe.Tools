import { expect, test } from "vite-plus/test";
import { bindWork } from "@pe/agent-contracts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectFixture } from "./project-home-fixture.ts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/contracts";
import { actAs } from "./callers.ts";

test("family capture through /actions writes the target document's project Pod", async () => {
  const f = await projectFixture(true);
  const key = bindWork("family", null, undefined, f.target.ref);
  expect((await f.saved.start(key, {}, "human")).ok).toBe(true);
  const staged = await f.saved.apply(
    key,
    "family",
    "human",
    [
      {
        path: ["writeIntent", "family.capture", "edit"],
        value: { value: { pod: "project-only" } },
      },
    ],
    (await f.saved.view(key, "family"))!.revision,
  );
  expect(staged, JSON.stringify(staged)).toMatchObject({ ok: true });
  const response = await f.post("/actions", {
    id: "project-family",
    key: "family.capture",
    target: f.target,
    input: { work: { key, revision: (await f.saved.view(key, "family"))!.revision } },
  });
  expect(response.status, await response.clone().text()).toBeLessThan(400);
  const receipt = await f.journal.wait("project-family");
  expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded" });
  if (receipt.state !== "succeeded") throw Error("Capture failed");
  const member = (receipt.result as { member: { path: string } }).member;
  expect(JSON.parse(await readFile(join(f.pod, member.path), "utf8"))).toMatchObject({
    family: { name: "Pointer family" },
  });
});

test("family spec HTTP assets read the scoped document's project Pod", async () => {
  const f = await projectFixture(true);
  await mkdir(join(f.pod, "settings/family"), { recursive: true });
  await writeFile(join(f.pod, "settings/family/evidence.json"), '{"projectEvidence":true}');
  const response = await actAs({ kind: "human", via: "local" }, () =>
    f.api.fetch(
      new Request(
        "http://fixture/pe/family-spec?pod=project-only&path=settings/family/evidence.json",
        {
          headers: {
            [HOST_RPC_BRIDGE_SESSION_HEADER]: f.target.ref.session,
            [HOST_RPC_DOCUMENT_HEADER]: f.target.ref.openId,
          },
        },
      ),
      {
        document: async (ref) => {
          expect(ref).toEqual(f.target.ref);
          return { ...ref, address: null, projectHome: "Projects/Example" };
        },
      },
    ),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({ projectEvidence: true });
});
