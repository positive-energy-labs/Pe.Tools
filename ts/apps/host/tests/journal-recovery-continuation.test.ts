import { Effect } from "effect";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Exit, Layer, Scope } from "effect";
import { expect, test } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { memberWork, settingsRouteState, type Caller, type WorkKey } from "@pe/agent-contracts";
import { type ActionJournal } from "../src/action-journal.ts";
import { RevitBridge, RevitBridgeLive } from "../src/bridge.ts";
import { bindCommandRuntime } from "../src/command-registry.ts";
import { bindControl } from "../src/control.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { captureStore, settle, testConsents, journalAt } from "./effect-test.ts";

test.each([
  { later: null, pea: false, crash: true },
  { later: "human", pea: false, crash: true },
  { later: null, pea: true, crash: true },
  { later: "pea", pea: true, crash: true },
  { later: null, pea: false, crash: false },
] as const)(
  "registered settings.write resumes retirement after restart: %j",
  async ({ later, pea, crash }) => {
    const directory = await mkdtemp(join(tmpdir(), "pe-member-retirement-"));
    const bridgeScope = Scope.makeUnsafe();
    const services = await settle(Layer.buildWithScope(RevitBridgeLive, bridgeScope));
    const bridge = Context.get(services, RevitBridge);
    const captures = captureStore(join(directory, "captures"));
    const runs = testConsents((run, event) => {
      if (event.kind === "permission_request")
        queueMicrotask(() => runs.decide(run.thread, event.requestId, "allow_now"));
    });
    const run = { thread: "retirement", turn: "original" };
    runs.open(run);
    bindControl({ runs });
    const caller: Caller = pea
      ? { kind: "pea", context: "host-minted", thread: run.thread, run, root: run }
      : { kind: "human", via: "local" };
    const path = join(directory, "journal.jsonl"),
      workDir = join(directory, "work");
    const member = { pod: "design", path: "settings.json" };
    const file = join(directory, "design", member.path);
    const key: WorkKey = {
      binding: "workspace",
      route: "pods",
      target: null,
      work: memberWork(member),
    };
    const owner = journalAt(path, Date.now);
    let restarted: ActionJournal | undefined;
    try {
      await mkdir(join(directory, "design"));
      await writeFile(join(directory, "design", "pod.json"), JSON.stringify({ id: "design" }));
      const original = '{"width":1}';
      await writeFile(file, original);
      const work = new RouteWorkspace({
        registrations: [{ spec: settingsRouteState }],
        store: fileRouteDocumentStore(workDir),
      });
      const observed = await work.publish(
        key,
        "pods",
        [
          {
            path: ["basis"],
            value: {
              member,
              rawContent: original,
              sha256: createHash("sha256").update(original).digest("hex"),
            },
          },
        ],
        0,
      );
      if (!observed.ok) throw Error(JSON.stringify(observed));
      const staged = await work.apply(
        key,
        "pods",
        "human",
        [
          { path: ["fields", "/width"], value: { edit: { value: 13 } } },
          { path: ["fields", "/height"], value: { edit: { value: 14 } } },
        ],
        observed.revision,
      );
      if (!staged.ok) throw Error(JSON.stringify(staged));
      bindCommandRuntime(
        owner,
        bridge,
        captures,
        { workspace: work, podsRoot: directory },
        () => Effect.fail(Error("settings.write owns its writer")),
      );
      let crashBytes: Buffer | undefined;
      let workBytes: Array<readonly [string, Buffer]> = [];
      const unsubscribe = owner.subscribe({ kinds: ["action"] }, (receipt) => {
        if (receipt.body.kind !== "action") return;
        const row = receipt.body.value;
        if (
          row.state === "running" &&
          row.steps.length === 1 &&
          row.steps[0]?.state === "succeeded"
        ) {
          crashBytes = readFileSync(path);
          workBytes = readdirSync(workDir).map(
            (name) => [name, readFileSync(join(workDir, name))] as const,
          );
        }
      });
      const admission = {
        id: "once",
        key: "settings.write",
        target: { kind: "host" as const },
        input: { work: { key, revision: staged.revision } },
      };
      await owner.invoke(admission, { caller, basis: null });
      expect((await owner.wait("once")).state).toBe("succeeded");
      unsubscribe();
      const originalSnapshot = (await owner.list(undefined, "once"))[0]!.snapshots![0]!;
      await owner.close();
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ width: 13, height: 14 });
      const landed = await stat(file, { bigint: true });
      if (crash) {
        expect(crashBytes).toBeDefined();
        expect(workBytes.length).toBeGreaterThan(0);
        // Exact producer bytes at the file commit, before either retirement or basis publication.
        await writeFile(path, crashBytes!);
        for (const [name, bytes] of workBytes) await writeFile(join(workDir, name), bytes);
      }
      const restoredWork = new RouteWorkspace({
        registrations: [{ spec: settingsRouteState }],
        store: fileRouteDocumentStore(workDir),
      });
      if (later) {
        const current = await restoredWork.read(key, "pods");
        const edited = await restoredWork.apply(
          key,
          "pods",
          later,
          [{ path: ["fields", "/width"], value: { edit: { value: 21 } } }],
          current!.revision,
        );
        if (!edited.ok) throw Error(JSON.stringify(edited));
      }
      runs.closeAll();
      restarted = journalAt(path, Date.now);
      bindCommandRuntime(
        restarted,
        bridge,
        captures,
        { workspace: restoredWork, podsRoot: directory },
        () => Effect.fail(Error("settings.write owns its writer")),
      );
      expect((await restarted.list(undefined, "once"))[0]!.state).toBe(
        crash ? "incomplete" : "succeeded",
      );
      const recovered = await restarted.recover("once");
      expect(recovered.state).toBe(crash ? "incomplete" : "succeeded");
      if (crash) {
        if (recovered.state !== "incomplete") throw Error(JSON.stringify(recovered));
        expect(recovered.error).toContain("explicit resume");
        expect(recovered.steps.at(-1)).toMatchObject({
          kind: "publication",
          key: "work.retire",
          state: "succeeded",
        });
      }
      const retired = settingsRouteState.schema.parse((await restoredWork.read(key, "pods"))!.doc);
      expect(retired.fields["/height"]?.edit).toBeNull();
      if (later) expect(retired.fields["/width"]?.edit).toMatchObject({ value: 21, by: later });
      else expect(retired.fields["/width"]?.edit).toBeNull();
      const fresh = { thread: run.thread, turn: "continuation" };
      runs.open(fresh);
      const currentCaller: Caller = pea
        ? { kind: "pea", context: "host-minted", thread: fresh.thread, run: fresh, root: fresh }
        : caller;
      await restarted.resume("once", { caller: currentCaller, basis: null });
      const settled = await restarted.wait("once");
      expect(settled.state).toBe("succeeded");
      expect(settled.steps.filter((step) => step.key === "pod.member.save")).toHaveLength(1);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ width: 13, height: 14 });
      expect((await stat(file, { bigint: true })).mtimeNs).toBe(landed.mtimeNs);
      const current = settingsRouteState.schema.parse((await restoredWork.read(key, "pods"))!.doc);
      expect(current.fields["/height"]?.edit).toBeNull();
      if (later) expect(current.fields["/width"]?.edit).toMatchObject({ value: 21, by: later });
      else expect(current.fields["/width"]?.edit).toBeNull();
      expect(current.basis?.sha256).toBe(
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      );
      expect(originalSnapshot).toMatchObject({ address: key, workRevision: staged.revision });
      expect(settled.snapshots).toEqual([originalSnapshot]);
      expect(settled.outcome?.snapshots).toEqual([originalSnapshot.id]);
      const durable = journalAt(path, Date.now);
      const reopened = (await durable.list(undefined, "once"))[0]!;
      expect(reopened.snapshots).toEqual([originalSnapshot]);
      expect(reopened.outcome?.snapshots).toEqual([originalSnapshot.id]);
      await durable.close();
    } finally {
      runs.closeAll();
      if (restarted) await restarted.close();
      await settle(Scope.close(bridgeScope, Exit.void));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
