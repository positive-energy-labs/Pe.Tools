import { beforeEach, expect, test, vi } from "vite-plus/test";
import { podsSources } from "./sources";
import { demandContext } from "#/shell/readings-use";
import { podsNeutralBodies } from "./neutral";
const podsReadings = {
  member: {
    args: (page: ReturnType<typeof podsPageSchema.parse>) =>
      podsNeutralBodies.memberArgs.run({ page, work: { basis: null }, readings: {} }),
  },
  runs: {
    args: (page: ReturnType<typeof podsPageSchema.parse>) =>
      podsNeutralBodies.runsArgs.run({ page, work: {}, readings: {} }),
  },
};
import { podsSeeds } from "./graph-seeds";
import { podsPageSchema } from "./page";
import { callOp } from "#/shell/readings-api";
import { memberWork, settingsRouteState } from "@pe/agent-contracts";
import { memberReadSchema } from "./schemas";
vi.mock("#/shell/readings-api", () => ({ callOp: vi.fn() }));
beforeEach(() => vi.mocked(callOp).mockReset());

test("the Pods member loader consumes its declared arguments through the admitted args-only source port", async () => {
  const page = podsPageSchema.parse(podsSeeds.browse.page);
  const ref = { pod: page.pod, path: page.path };
  vi.mocked(callOp).mockResolvedValueOnce({
    content: '{"name":"kept bytes"}',
    sha256: "disk-hash",
  } as never);
  const args = podsReadings.member.args(page);
  const source = podsSources()["pods.member"]!;
  if (source.kind !== "use") throw Error("Not a member loader");
  const deliver = vi.fn();
  await source.open(
    demandContext({ kind: "host" }, 1, args, new AbortController().signal),
    deliver,
  );
  expect(callOp).toHaveBeenCalledWith(expect.anything(), "pod.member.read", ref);
  expect(deliver).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "complete",
      value: { member: ref, content: '{"name":"kept bytes"}', sha256: "disk-hash" },
    }),
  );
});

test.each(["member", "pod"] as const)(
  "the runs loader preserves %s scope through args-only acquisition",
  async (runs) => {
    const page = podsPageSchema.parse({ ...podsSeeds.browse.page, runs });
    const expected = { pod: page.pod, ...(runs === "member" && { path: page.path }) };
    vi.mocked(callOp).mockResolvedValueOnce({ runs: podsSeeds.browse.readings.runs } as never);
    const source = podsSources()["pods.runs"]!;
    if (source.kind !== "use") throw Error("Not a runs loader");
    const deliver = vi.fn();
    await source.open(
      demandContext(
        { kind: "host" },
        1,
        podsReadings.runs.args(page),
        new AbortController().signal,
      ),
      deliver,
    );
    expect(callOp).toHaveBeenCalledWith(expect.anything(), "pod.runs", expected);
    expect(deliver).toHaveBeenCalledWith({
      kind: "complete",
      revision: 1,
      value: podsSeeds.browse.readings.runs,
    });
  },
);

test("empty member and Pod selections acquire no file or run authority", async () => {
  const page = podsPageSchema.parse({});
  for (const id of ["member", "runs"] as const) {
    const source = podsSources()[`pods.${id}`]!;
    if (source.kind !== "use") throw Error("Not a loader");
    const deliver = vi.fn();
    await source.open(
      demandContext({ kind: "host" }, 1, podsReadings[id].args(page), new AbortController().signal),
      deliver,
    );
    expect(deliver).toHaveBeenCalledWith({
      kind: "complete",
      revision: 0,
      value: id === "member" ? null : [],
    });
  }
  expect(callOp).not.toHaveBeenCalled();
});

test("composition sends exact staged Work bytes through its declared args, without ambient Page or Work", async () => {
  const page = podsPageSchema.parse(podsSeeds.browse.page);
  const member = memberReadSchema.parse(
    podsSeeds.browse.readings.member.fixtureSelect.values[JSON.stringify([page.pod, page.path])],
  );
  const content = ' { "name" : "staged bytes" }\n';
  const work = settingsRouteState.schema.parse({
    ...podsSeeds.browse.works[memberWork(page)],
    fields: { "": { edit: { value: content } } },
  });
  const args = podsNeutralBodies.compositionArgs.run({
    page,
    work,
    readings: {
      member: { status: "ready", current: true, value: member, hash: "fixture" },
      status: { status: "ready", current: true, value: null, hash: "fixture" },
    },
  });
  vi.mocked(callOp).mockResolvedValueOnce({ diagnostics: [] } as never);
  const source = podsSources()["pods.composition"]!;
  if (source.kind !== "use") throw Error("Not a composition loader");
  await source.open(
    demandContext({ kind: "host" }, 1, args, new AbortController().signal),
    vi.fn(),
  );
  expect(callOp).toHaveBeenCalledWith(expect.anything(), "pod.member.compose", {
    pod: page.pod,
    path: page.path,
    content,
  });
});
