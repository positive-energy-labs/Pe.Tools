import { afterEach, expect, test, vi } from "vite-plus/test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instancesLaunchSchema } from "@pe/agent-contracts";
import { planAcquisition } from "../src/acquisition.ts";
import { downloadCloudVersion } from "../src/cloud-version.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { admitInstancesAction } from "../src/instances-actions.ts";
import { crossingOf } from "./callers.ts";
import { replay } from "./e2-sdk-recordings.ts";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function folder() {
  const dir = await mkdtemp(join(tmpdir(), "pe-cloud-version-"));
  folders.push(dir);
  return dir;
}

const source =
  "cld://US/{11111111-1111-1111-1111-111111111111}Project/{22222222-2222-2222-2222-222222222222}Tower.rvt";
const version = {
  projectId: "b.11111111-1111-1111-1111-111111111111",
  itemId: "urn:adsk.wipprod:dm.lineage:model",
  versionId: "urn:adsk.wipprod:fs.file:vf.model?version=7",
};
const into = { start: { year: "2025", owner: "pea", addins: "on" } } as const;

test("cloud acquisition refuses a model identity without an immutable version before allocation", () => {
  expect(() =>
    planAcquisition(
      "cloud",
      "C:/pea-work",
      { kind: "create", year: "2025" },
      { source, into },
      false,
    ),
  ).toThrow("immutable APS version");
});

test("the acquisition contract freezes an explicit version and reserves local baseline/work paths", () => {
  const launch = instancesLaunchSchema.parse({ source, into, cloudVersion: version });
  const intent = planAcquisition(
    "cloud",
    "C:/pea-work",
    { kind: "create", year: "2025" },
    launch,
    false,
  );
  expect(intent.document!.origin).toMatchObject({
    kind: "version-copy",
    source,
    version,
    detach: true,
  });
  expect(intent.document!.origin).toHaveProperty("baseline");
  expect(intent.document!.origin).toHaveProperty("work");
});

const resource = {
  data: {
    type: "versions",
    id: version.versionId,
    attributes: {
      extension: {
        data: {
          projectGuid: "11111111-1111-1111-1111-111111111111",
          modelGuid: "22222222-2222-2222-2222-222222222222",
        },
      },
    },
    relationships: {
      item: { data: { id: version.itemId } },
      storage: { data: { id: "urn:adsk.objects:os.object:bucket/model.rvt" } },
    },
  },
};
function apsResponses(body = resource) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(body))
    .mockResolvedValueOnce(
      Response.json({ status: "complete", url: "https://storage.example/model" }),
    )
    .mockResolvedValueOnce(new Response("immutable-version-seven"));
}

test("APS download validates immutable lineage, hashes exact bytes and never sends the bearer to storage", async () => {
  const to = join(await folder(), "baseline.rvt");
  const request = apsResponses();
  const result = await downloadCloudVersion(source, version, to, {
    token: async () => "test-bearer",
    fetch: request,
  });
  expect(await readFile(to, "utf8")).toBe("immutable-version-seven");
  expect(result).toMatchObject({
    version,
    bytes: 23,
    sha256: createHash("sha256").update("immutable-version-seven").digest("hex"),
  });
  expect(request.mock.calls[0]![0]).toContain(encodeURIComponent(version.versionId));
  expect(request.mock.calls[0]![1]!.headers).toEqual({ authorization: "Bearer test-bearer" });
  expect(request.mock.calls[2]![1]!.headers).toBeUndefined();
  await expect(
    downloadCloudVersion(source, version, to, {
      token: async () => "test-bearer",
      fetch: apsResponses(),
    }),
  ).rejects.toThrow();
  expect(await readFile(to, "utf8")).toBe("immutable-version-seven");
});

test("a changed version or model identity refuses before download and allocation", async () => {
  const to = join(await folder(), "baseline.rvt");
  const request = apsResponses({
    ...resource,
    data: { ...resource.data, id: version.versionId.replace("7", "8") },
  });
  await expect(
    downloadCloudVersion(source, version, to, { token: async () => "test-bearer", fetch: request }),
  ).rejects.toThrow("lineage");
  expect(request).toHaveBeenCalledTimes(1);
  await expect(readFile(to)).rejects.toMatchObject({ code: "ENOENT" });
});

test("recorded SDK envelopes: only the downloaded local work file crosses the acquisition open boundary", async () => {
  const dir = await folder();
  const owner = new ActionJournal(join(dir, "actions.json"));
  const base = JSON.parse(replay("session-list"));
  const row = base.result.sessions.find(
    (row: { case: string }) => row.case === "controlled-active",
  );
  row.shape.posture = "background";
  row.execution = { allowed: true, code: null, detail: null };
  const peaWork = join(dir, "pea-work");
  const started = await owner.admit(
    {
      id: "process",
      kind: "workflow",
      key: "instances.start",
      ...crossingOf("human"),
      destination: { kind: "host" },
      input: into.start,
      bases: {},
    },
    async () => ({
      target: null,
      acquisition: planAcquisition(
        "process",
        peaWork,
        { kind: "create", year: "2025" },
        null,
        false,
      ),
    }),
    (execution) =>
      execution.step(
        "native",
        "instances.start",
        { argv: [] },
        async () => JSON.parse(replay("session-start", { result: { session: row } })).result,
      ),
  );
  await owner.wait(started.id);
  const calls: string[][] = [];
  const sdk = async (args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === "session") return replay("session-list", { result: { sessions: [row] } });
    if (args[0] !== "doc" || args[1] !== "open") throw Error(`unexpected SDK effect ${args}`);
    expect(await readFile(args[2]!, "utf8")).toBe("immutable-version-seven");
    expect(args).toContain("--detach");
    expect(args.slice(args.indexOf("--links"), args.indexOf("--links") + 2)).toEqual([
      "--links",
      "refuse",
    ]);
    expect(args).not.toContain("--unsynced");
    expect(args[2]).not.toContain("cld:");
    return replay("doc-open", { result: { document: { path: args[2], openId: "e".repeat(32) } } });
  };
  const admitted = await admitInstancesAction(
    {
      id: "version",
      kind: "workflow",
      key: "instances.open",
      destination: { kind: "sdk-session", selection: { id: row.id } },
      input: { source, cloudVersion: version, into: { session: { id: row.id } } },
      bases: {},
    },
    crossingOf("human"),
    owner,
    {
      sdk,
      peaWork,
      downloadVersion: (source, version, to) =>
        downloadCloudVersion(source, version, to, {
          token: async () => "test-bearer",
          fetch: apsResponses(),
        }),
    },
  );
  const receipt = await owner.wait(admitted.id);
  expect(receipt).toMatchObject({ state: "succeeded" });
  expect(receipt.steps.map((step) => step.key)).toEqual([
    "acquisition.baseline",
    "acquisition.work",
    "instances.open",
  ]);
  expect(receipt.steps[0]).toMatchObject({
    state: "succeeded",
    result: { version, storageId: resource.data.relationships.storage.data.id },
  });
  expect(calls.filter((args) => args[0] === "doc")).toHaveLength(1);
});

test("version acquisition never substitutes a reload, a template, a local source, or unverified links", () => {
  for (const change of [
    { reload: true },
    { template: true },
    { source: "C:/local.rvt" },
    { links: "allow" as const },
  ])
    expect(() =>
      planAcquisition(
        "cloud",
        "C:/pea-work",
        { kind: "create", year: "2025" },
        { source, into, cloudVersion: version, ...change },
        false,
      ),
    ).toThrow();
});
