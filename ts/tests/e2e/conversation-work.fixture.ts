import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export const CONVERSATION_THREADS = {
  office: "cac00000-0000-4000-8000-000000000001",
  empty: "cac00000-0000-4000-8000-000000000002",
};
export const OFFICE_ADDRESS = "C:/Models/Office.rvt";

export async function workEvidence(home: string) {
  const dir = join(resolve(home), ".local-state", "state", "route-work");
  return Promise.all(
    (await readdir(dir))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map(async (file) => {
        const bytes = await readFile(join(dir, file));
        return {
          file,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
          record: JSON.parse(bytes.toString("utf8")),
        };
      }),
  );
}

/** Run before starting the host. Creates real canonical owner files, never a browser store. */
export async function seedConversationWork(homeInput: string, artifactInput: string) {
  const home = resolve(homeInput);
  const artifactDir = resolve(artifactInput);
  if ((await readdir(home).catch(() => [])).length)
    throw Error("PRECONDITION: seed requires an empty isolated product home");
  process.env.PE_TOOLS_PRODUCT_HOME = home;
  process.env.PE_LANE = "dev";
  // Initialize the contract barrel before its consumers; parallel jiti import initialization
  // can expose a half-initialized route catalog through its consumer cycle.
  const { address, bindWork, emptyThreadLifecycle, workKey } =
    await import("../../packages/agent-contracts/src/index.ts");
  const { RouteWorkspace } = await import("../../packages/runtime/src/route-workspace.ts");
  const { createRouteRegistrations } = await import("../../packages/mcps/src/pea/routes.ts");
  const { fileRouteDocumentStore } = await import("../../apps/host/src/route-document-store.ts");
  const paths = await import("../../apps/host/src/product-paths.ts");
  await mkdir(artifactDir, { recursive: true });
  const scope = bindWork("ducts", address(OFFICE_ADDRESS));
  const workspace = new RouteWorkspace({
    registrations: createRouteRegistrations(),
    store: fileRouteDocumentStore(paths.productRouteWorkPath()),
  });
  for (const [actor, revision, patches] of [
    [
      "human",
      0,
      [
        {
          path: ["flows", "1001", "staged"],
          value: { value: { cfm: 100, source: "human effort" } },
        },
        { path: ["flows", "1002", "staged"], value: { value: { cfm: 200, source: "reviewed" } } },
      ],
    ],
    [
      "agent",
      1,
      [
        {
          path: ["flows", "1002", "proposal"],
          value: { value: { cfm: 220, source: "alternative" } },
        },
        { path: ["flows", "1003", "proposal"], value: { value: { cfm: 300, source: "proposal" } } },
      ],
    ],
  ] as const) {
    const result = await workspace.apply(
      scope,
      "ducts",
      actor,
      patches.map((patch) => ({ ...patch, path: [...patch.path] })),
      revision,
    );
    if (!result.ok) throw Error(`Seed Work refused: ${JSON.stringify(result)}`);
  }
  const census = await workspace.instances();
  if (census.works.length !== 1 || census.works[0]?.unfinished !== 3)
    throw Error("Seed did not produce exactly three unique unfinished cells");
  const at = "2026-10-24T00:00:00.000Z";
  const workUrl = `/ducts?target=${encodeURIComponent(OFFICE_ADDRESS)}`;
  const retainedPage = "Office retained page";
  const placeId = "cac00000-0000-4000-8000-000000000011";
  const placeUrl = `${workUrl}&system=${encodeURIComponent(retainedPage)}`;
  for (const [kind, id] of Object.entries(CONVERSATION_THREADS)) {
    const office = kind === "office";
    const dir = join(paths.productHarnessThreadsPath(), id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify(
        {
          id,
          harness: "codex",
          providerId: "codex",
          providerName: "Codex",
          title: office ? "Size the office" : "Conversation without Work",
          createdAt: at,
          updatedAt: at,
          modelId: null,
          acpSessionId: null,
          models: [],
          traits: [],
          traitValues: {},
          head: { targets: [], revision: 1 },
          forkOf: null,
          promptCapabilities: null,
          lifecycle: emptyThreadLifecycle(),
          tabs: office
            ? [
                { id: placeId, route: "ducts", link: placeUrl, at },
                {
                  id: "cac00000-0000-4000-8000-000000000012",
                  route: "takeoffs",
                  link: `/takeoffs?target=${encodeURIComponent(OFFICE_ADDRESS)}`,
                  at,
                },
              ]
            : [],
          workContext: {
            documents: office
              ? [
                  {
                    id: "office-document",
                    name: "Office model",
                    address: OFFICE_ADDRESS,
                    refs: [{ session: "closed-session", openId: "closed-open" }],
                  },
                ]
              : [],
            works: [],
          },
        },
        null,
        2,
      ),
    );
    await writeFile(join(dir, "events.jsonl"), "");
  }
  const fixture = {
    version: 1,
    productHome: home,
    threads: CONVERSATION_THREADS,
    workId: workKey(scope),
    workUrl,
    placeUrl,
    placeId,
    retainedPage,
    address: OFFICE_ADDRESS,
    unfinished: 3,
    evidence: await workEvidence(home),
  };
  await writeFile(join(artifactDir, "seed.json"), JSON.stringify(fixture, null, 2));
  return fixture;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.PE_TOOLS_PRODUCT_HOME || !process.env.CONVERSATION_WORK_ARTIFACT_DIR)
    throw Error("Set PE_TOOLS_PRODUCT_HOME and CONVERSATION_WORK_ARTIFACT_DIR explicitly");
  console.log(
    JSON.stringify(
      await seedConversationWork(
        process.env.PE_TOOLS_PRODUCT_HOME,
        process.env.CONVERSATION_WORK_ARTIFACT_DIR,
      ),
    ),
  );
}
