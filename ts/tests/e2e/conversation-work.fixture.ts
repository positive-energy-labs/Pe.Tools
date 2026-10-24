import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export const CONVERSATION_THREADS = {
  office: "cac00000-0000-4000-8000-000000000001",
  empty: "cac00000-0000-4000-8000-000000000002",
  unsaved: "cac00000-0000-4000-8000-000000000003",
};
export const OFFICE_ADDRESS = "C:/Models/Office.rvt";
export const UNSAVED_REF = { session: "closed-session", openId: "unsaved-open" };
export const NAMES_TURN = "cac00000-0000-4000-8000-000000000021";

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
  const { address, bindWork, emptyThreadLifecycle, workKey, harnessEventSchema } =
    await import("../../packages/agent-contracts/src/index.ts");
  const { RouteWorkspace } = await import("../../packages/runtime/src/route-workspace.ts");
  const { createRouteRegistrations } = await import("../../packages/mcps/src/pea/routes.ts");
  const { fileRouteDocumentStore } = await import("../../apps/host/src/route-document-store.ts");
  const paths = await import("../../apps/host/src/product-paths.ts");
  await mkdir(artifactDir, { recursive: true });
  const scope = bindWork("ducts", address(OFFICE_ADDRESS));
  const unsavedScope = bindWork("ducts", null, undefined, UNSAVED_REF);
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
    for (const key of [scope, unsavedScope]) {
      const result = await workspace.apply(
        key,
        "ducts",
        actor,
        patches.map((patch) => ({ ...patch, path: [...patch.path] })),
        revision,
      );
      if (!result.ok) throw Error(`Seed Work refused: ${JSON.stringify(result)}`);
    }
  }
  const census = await workspace.instances();
  if (census.works.length !== 2 || census.works.some((work) => work.unfinished !== 3))
    throw Error("Seed did not produce two real Works with three unique unfinished cells each");
  const at = "2026-10-24T00:00:00.000Z";
  const workUrl = `/ducts?target=${encodeURIComponent(OFFICE_ADDRESS)}`;
  const retainedPage = "Office retained page";
  const placeId = "cac00000-0000-4000-8000-000000000011";
  // Real older Places carry only an exact open ref; the Work producer carries no `from`.
  const placeUrl = `/ducts?target=${encodeURIComponent(JSON.stringify({ kind: "open", ref: { session: "closed-session", openId: "closed-open" } }))}&system=${encodeURIComponent(retainedPage)}`;
  const unsavedUrl = `/ducts?target=${encodeURIComponent(JSON.stringify({ kind: "open", ref: UNSAVED_REF }))}`;
  for (const [kind, id] of Object.entries(CONVERSATION_THREADS)) {
    const office = kind === "office";
    const unsaved = kind === "unsaved";
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
          title: office
            ? "Size the office"
            : unsaved
              ? "Inspect unsaved design"
              : "Conversation without Work",
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
            : unsaved
              ? [
                  {
                    id: "cac00000-0000-4000-8000-000000000013",
                    route: "ducts",
                    link: unsavedUrl,
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
              : unsaved
                ? [
                    {
                      id: "unsaved-document",
                      name: "Unsaved design",
                      address: null,
                      refs: [UNSAVED_REF],
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
    const events = office
      ? [
          {
            seq: 1,
            at,
            kind: "prompt",
            turnId: NAMES_TURN,
            text: "Inspect the retained elements",
            targets: [],
          },
          {
            seq: 2,
            at,
            kind: "update",
            turnId: NAMES_TURN,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: "Review 1001 and 1002. Example `1003`; [1004](https://example.invalid/element).",
              },
            },
          },
          { seq: 3, at, kind: "turn_end", turnId: NAMES_TURN, stopReason: "end_turn" },
        ]
      : [];
    await writeFile(
      join(dir, "events.jsonl"),
      events.map((event) => JSON.stringify(harnessEventSchema.parse(event)) + "\n").join(""),
    );
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
    unsavedWorkId: workKey(unsavedScope),
    unsavedUrl,
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
