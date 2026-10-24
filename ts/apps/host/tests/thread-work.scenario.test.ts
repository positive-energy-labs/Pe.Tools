import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { expect, test } from "vite-plus/test";
import {
  address,
  bindWork,
  emptyThreadLifecycle,
  threadWorkSnapshotSchema,
  workResumeSchema,
  workKey,
  sameAddress,
  routeAddress,
  type DocumentRef,
} from "@pe/agent-contracts";
import { createRouteRegistrations } from "@pe/mcps";
import { withInvocationContext } from "@pe/runtime/context";
import { peRoutes } from "@pe/agent-contracts/pe-api";
import { createHarnessThreads, type HarnessThreadsOptions } from "../src/harness/threads.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { HostLog } from "../src/host-log.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { human } from "./callers.ts";

test("HTTP and one Reading retain named unfinished Work after target removal, closure and host restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-thread-work-"));
  const id = "retained-conversation";
  const dir = join(root, "threads", id);
  const at = address("C:\\Models\\Office.rvt");
  const ref = { session: "first-session", openId: "first-open" };
  let documents: ({ address: typeof at | null; name: string } & DocumentRef)[] = [
    { ...ref, address: at, name: "Office model" },
  ];
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({
      id,
      harness: "codex",
      providerId: "codex",
      providerName: "Codex",
      title: "Size the office",
      createdAt: "2026-10-24T00:00:00.000Z",
      updatedAt: "2026-10-24T00:00:00.000Z",
      modelId: null,
      acpSessionId: null,
      models: [],
      traits: [],
      traitValues: {},
      head: { targets: [{ request: { kind: "open", ref }, admission: null }], revision: 1 },
      forkOf: null,
      promptCapabilities: null,
      lifecycle: emptyThreadLifecycle(),
      tabs: [],
    }),
  );
  const unnamed = "z-unlabelled-old-thread";
  await mkdir(join(root, "threads", unnamed), { recursive: true });
  const oldMeta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
  await writeFile(
    join(root, "threads", unnamed, "meta.json"),
    JSON.stringify({
      ...oldMeta,
      id: unnamed,
      title: "An older useful conversation",
      head: {
        targets: [
          {
            request: {
              kind: "open",
              ref: { session: "old-closed-session", openId: "opaque-old-handle" },
            },
            admission: null,
          },
        ],
        revision: 1,
      },
    }),
  );
  const providers = {
    get: () => ({ id: "codex", harness: "codex", name: "Codex", auth: { kind: "subscription" } }),
    keys: () => [],
  } as unknown as HarnessThreadsOptions["providers"];
  const options: HarnessThreadsOptions = {
    root: join(root, "threads"),
    log: new HostLog(join(root, "log")),
    worldRoot: root,
    providers,
    mcpServer: () => ({ name: "unused", command: "unused", args: [], env: [] }),
    observeDocument: (request) => {
      const found = documents.filter((doc) =>
        request.kind === "open"
          ? doc.session === request.ref.session && doc.openId === request.ref.openId
          : doc.session === request.session && doc.address === request.address,
      );
      return found.length === 1
        ? {
            ref: { session: found[0]!.session, openId: found[0]!.openId },
            address: found[0]!.address,
            name: found[0]!.name,
          }
        : null;
    },
  };
  let threads = createHarnessThreads(options);
  const store = fileRouteDocumentStore(join(root, "work"));
  const makeApp = () =>
    createPeRoutes({
      registrations: createRouteRegistrations(),
      store,
      heads: threads.heads,
      navigation: {
        threads: async () => (await threads.fetch(new Request("http://host/pe/threads"))).json(),
        documents: async () =>
          documents.map(({ session, openId, address }) => ({ session, openId, address })),
        contexts: threads.workContexts,
        subscribe: (notify) => threads.observe({ kind: "threads" }, () => notify())!,
      },
    });
  let app = makeApp();
  const tab = async (body: object) =>
    withInvocationContext({ caller: human }, () =>
      threads.fetch(
        new Request(`http://host/pe/threads/${id}/tabs`, {
          method: peRoutes["thread.tabs"].method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    );
  const read = async () =>
    threadWorkSnapshotSchema.parse(
      await (await app.fetch(new Request("http://host/pe/thread-work"))).json(),
    );
  const scope = bindWork("ducts", at);
  const fileBytes = async () =>
    Promise.all(
      (await readdir(join(root, "work")))
        .sort()
        .map(async (file) => [file, await readFile(join(root, "work", file), "utf8")]),
    );
  const abort = new AbortController();
  try {
    expect(
      (
        await app.workspace.apply(
          scope,
          "ducts",
          "human",
          [
            {
              path: ["flows", "1001", "staged"],
              value: { value: { cfm: 100, source: "human effort" } },
            },
            {
              path: ["flows", "1002", "staged"],
              value: { value: { cfm: 200, source: "reviewed" } },
            },
          ],
          0,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await app.workspace.apply(
          scope,
          "ducts",
          "agent",
          [
            {
              path: ["flows", "1002", "proposal"],
              value: { value: { cfm: 220, source: "alternative" } },
            },
            {
              path: ["flows", "1003", "proposal"],
              value: { value: { cfm: 300, source: "proposal" } },
            },
          ],
          1,
        )
      ).ok,
    ).toBe(true);
    const snapshot = await read();
    expect(snapshot.threads.find((item) => item.threadId === unnamed)?.documents).toEqual([]);
    expect(snapshot.observations).toContain(
      "Some older document connections have no remembered name; their conversation titles are retained.",
    );
    const doc = snapshot.threads[0]!.documents[0]!;
    expect(doc).toMatchObject({ name: "Office model", availability: "open" });
    expect(snapshot.threads[0]!.works).toEqual([
      { id: workKey(scope), documentId: doc.id, route: "ducts", intent: "Ducts", unfinished: 3 },
    ]);
    const addressTab = randomUUID(),
      openTab = randomUUID(),
      unknownTab = randomUUID();
    for (const [tabId, target] of [
      [addressTab, at],
      [openTab, JSON.stringify({ kind: "open", ref })],
      [
        unknownTab,
        JSON.stringify({
          kind: "open",
          ref: { session: "unknown-session", openId: "unknown-open" },
        }),
      ],
    ])
      expect(
        (
          await tab({
            op: "put",
            id: tabId,
            route: "ducts",
            link: routeAddress("ducts").link({ system: "Retained page" }, { target }),
          })
        ).status,
      ).toBe(200);
    const saved = await fileBytes();
    const stream = await app.fetch(
      new Request(
        `http://host/pe/resources?keys=${encodeURIComponent(JSON.stringify([{ kind: "thread-work" }]))}`,
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
          if (chunk.done) throw Error("stream ended");
          buffer += new TextDecoder().decode(chunk.value);
        }
      }
    };
    expect((await next()).value.threads[0].works[0].unfinished).toBe(3);
    const removed = await withInvocationContext({ caller: human }, () =>
      threads.fetch(
        new Request(`http://host/pe/scope/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targets: [], expectedRevision: 1 }),
        }),
      ),
    );
    expect(removed.status).toBe(200);
    expect(threads.heads.read(id).targets).toEqual([]);
    expect((await next()).value.threads[0].works[0].unfinished).toBe(3);
    documents = [];
    expect((await read()).threads[0]!.documents).toEqual([{ ...doc, availability: "closed" }]);
    const resume = workResumeSchema.parse(
      await (
        await app.fetch(
          new Request(`http://host/pe/work-resume?id=${encodeURIComponent(workKey(scope))}`),
        )
      ).json(),
    );
    expect(
      sameAddress(address(new URL(resume.url!, "http://host").searchParams.get("target")!), at),
    ).toBe(true);
    expect(workKey(resume.key)).toBe(workKey(scope));
    expect(resume.key).not.toHaveProperty("from");
    expect(resume.matches).toEqual([
      { threadId: id, tabId: addressTab },
      { threadId: id, tabId: openTab },
    ]);
    const retained = await (
      await app.fetch(
        new Request(`http://host/pe/route-state/ducts?target=${encodeURIComponent(at)}`),
      )
    ).json();
    expect(retained.doc.flows["1001"].staged.value.source).toBe("human effort");
    expect(retained.doc.flows["1002"].proposal.value.cfm).toBe(220);
    expect(await fileBytes()).toEqual(saved);
    abort.abort();
    await threads.close();
    threads = createHarnessThreads(options);
    app = makeApp();
    expect((await read()).threads[0]).toMatchObject({
      documents: [{ ...doc, availability: "closed" }],
      works: [{ unfinished: 3 }],
    });
    documents = [
      { session: "new-session", openId: "new-open", address: at, name: "Office reopened" },
    ];
    expect((await read()).threads[0]!.documents).toEqual([doc]);
    expect(threads.heads.read(id).targets).toEqual([]);
    expect(await fileBytes()).toEqual(saved);
    expect((await app.fetch(new Request("http://host/pe/work-resume?id=forged"))).status).toBe(404);
    const schedule = bindWork("schedules", null, "office-schedule");
    expect(
      (
        await app.workspace.apply(
          schedule,
          "schedules",
          "human",
          [{ path: ["cells", "1::2", "staged"], value: { value: "Reviewed schedule value" } }],
          0,
        )
      ).ok,
    ).toBe(true);
    const tabId = randomUUID();
    expect(
      (
        await tab({
          op: "put",
          id: tabId,
          route: "schedules",
          link: routeAddress("schedules").link({ workspaceId: "office-schedule" }, { target: at }),
        })
      ).status,
    ).toBe(200);
    const scheduledPlace = workResumeSchema.parse(
      await (
        await app.fetch(
          new Request(`http://host/pe/work-resume?id=${encodeURIComponent(workKey(schedule))}`),
        )
      ).json(),
    );
    expect(scheduledPlace.matches).toEqual([{ threadId: id, tabId }]);
    expect((await tab({ op: "close", id: tabId })).status).toBe(200);
    documents = [];
    await threads.close();
    threads = createHarnessThreads(options);
    app = makeApp();
    expect(
      (await read()).threads[0]!.works.find((item) => item.id === workKey(schedule)),
    ).toMatchObject({ documentId: doc.id, unfinished: 1 });
    const scheduleResume = workResumeSchema.parse(
      await (
        await app.fetch(
          new Request(`http://host/pe/work-resume?id=${encodeURIComponent(workKey(schedule))}`),
        )
      ).json(),
    );
    const scheduleUrl = new URL(scheduleResume.url!, "http://host");
    expect(scheduleUrl.searchParams.get("workspaceId")).toBe("office-schedule");
    expect(sameAddress(address(scheduleUrl.searchParams.get("target")!), at)).toBe(true);
    const hostOnly = bindWork("ducts", null);
    expect(
      (
        await app.workspace.apply(
          hostOnly,
          "ducts",
          "human",
          [{ path: ["flows", "99", "staged"], value: { value: { cfm: 99, source: "Unbound" } } }],
          0,
        )
      ).ok,
    ).toBe(true);
    const unbound = workResumeSchema.parse(
      await (
        await app.fetch(
          new Request(`http://host/pe/work-resume?id=${encodeURIComponent(workKey(hostOnly))}`),
        )
      ).json(),
    );
    expect(unbound.url).toBeNull();
    expect(unbound.reason).toContain("no document binding");
    documents = [{ ...ref, address: address("C:/Models/SaveAs.rvt"), name: "Other saved model" }];
    threads.refreshWorkContexts();
    const afterSaveAs = workResumeSchema.parse(
      await (
        await app.fetch(
          new Request(`http://host/pe/work-resume?id=${encodeURIComponent(workKey(scope))}`),
        )
      ).json(),
    );
    expect(afterSaveAs.matches).toEqual([{ threadId: id, tabId: addressTab }]);
    const beforeAmbiguous = await fileBytes();
    expect(
      (
        await tab({
          op: "put",
          id: randomUUID(),
          route: "schedules",
          link: routeAddress("schedules").link(
            { workspaceId: "office-schedule" },
            { target: "C:/Models/SaveAs.rvt" },
          ),
        })
      ).status,
    ).toBe(200);
    const ambiguousSchedule = workResumeSchema.parse(
      await (
        await app.fetch(
          new Request(`http://host/pe/work-resume?id=${encodeURIComponent(workKey(schedule))}`),
        )
      ).json(),
    );
    expect(ambiguousSchedule.url).toBeNull();
    expect(ambiguousSchedule.reason).toContain("no unique remembered document binding");
    expect(ambiguousSchedule.matches).toEqual([]);
    const preservedSchedule = await (
      await app.fetch(new Request("http://host/pe/route-state/schedules?work=office-schedule"))
    ).json();
    expect(preservedSchedule.doc.cells["1::2"].staged.value).toBe("Reviewed schedule value");
    expect(await fileBytes()).toEqual(beforeAmbiguous);

    // Unsaved Work keeps the exact old lifetime after closure, target removal and restart.
    const unsavedRef = { session: "unsaved-session", openId: "original-unsaved" };
    documents = [{ ...unsavedRef, address: null, name: "Unsaved design" }];
    const setTargets = (targets: unknown[]) =>
      withInvocationContext({ caller: human }, () =>
        threads.fetch(
          new Request(`http://host/pe/scope/${id}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targets, expectedRevision: threads.heads.read(id).revision }),
          }),
        ),
      );
    expect((await setTargets([{ request: { kind: "open", ref: unsavedRef } }])).status).toBe(200);
    const unsaved = bindWork("ducts", null, undefined, unsavedRef);
    expect(
      (
        await app.workspace.apply(
          unsaved,
          "ducts",
          "human",
          [
            {
              path: ["flows", "11", "staged"],
              value: { value: { cfm: 110, source: "Retain me" } },
            },
          ],
          0,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await app.workspace.apply(
          unsaved,
          "ducts",
          "agent",
          [
            {
              path: ["flows", "12", "proposal"],
              value: { value: { cfm: 120, source: "Proposal" } },
            },
          ],
          1,
        )
      ).ok,
    ).toBe(true);
    const unsavedDocument = (await read()).threads[0]!.documents.find(
      (document) => document.name === "Unsaved design",
    )!;
    expect(unsavedDocument.availability).toBe("open");
    const unsavedBytes = await fileBytes();
    documents = [];
    threads.refreshWorkContexts();
    expect((await setTargets([])).status).toBe(200);
    await threads.close();
    threads = createHarnessThreads(options);
    app = makeApp();
    // Same name and session, different openId: it is a replacement, not a reconnection.
    const replacement = { ...unsavedRef, openId: "replacement-unsaved" };
    documents = [{ ...replacement, address: null, name: "Unsaved design" }];
    const closed = (await read()).threads[0]!;
    expect(closed.documents).toContainEqual({ ...unsavedDocument, availability: "closed" });
    expect(closed.works).toContainEqual({
      id: workKey(unsaved),
      documentId: unsavedDocument.id,
      route: "ducts",
      intent: "Ducts",
      unfinished: 2,
    });
    const unsavedResume = workResumeSchema.parse(
      await (
        await app.fetch(
          new Request(`http://host/pe/work-resume?id=${encodeURIComponent(workKey(unsaved))}`),
        )
      ).json(),
    );
    expect(unsavedResume.key).toEqual(unsaved);
    expect(
      JSON.parse(new URL(unsavedResume.url!, "http://host").searchParams.get("target")!),
    ).toEqual({ kind: "open", ref: unsavedRef });
    const unsavedRead = await (
      await app.fetch(
        new Request("http://host/pe/route-state/ducts?open=unsaved-session/original-unsaved"),
      )
    ).json();
    expect(unsavedRead).toMatchObject({
      revision: 2,
      doc: {
        flows: {
          "11": { staged: { value: { cfm: 110, source: "Retain me" } } },
          "12": { proposal: { value: { cfm: 120, source: "Proposal" } } },
        },
      },
    });
    expect(
      await app.workspace.read(bindWork("ducts", null, undefined, replacement), "ducts"),
    ).toBeNull();
    expect(threads.heads.read(id).targets).toEqual([]);
    expect(await fileBytes()).toEqual(unsavedBytes);
  } finally {
    abort.abort();
    await threads.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
