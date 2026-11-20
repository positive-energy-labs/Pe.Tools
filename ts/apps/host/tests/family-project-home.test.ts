import { expect, test } from "vite-plus/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectFixture } from "./project-home-fixture.ts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/contracts";
import { actAs } from "./callers.ts";

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
