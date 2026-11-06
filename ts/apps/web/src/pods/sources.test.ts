import { beforeEach, expect, test, vi } from "vite-plus/test";
import { podsSources } from "./sources";
import { demandContext } from "#/shell/readings-use";
import { podsReadings } from "./declarations";
import { podsSeeds } from "./graph-seeds";
import { podsPageSchema } from "./page";
import { callOp } from "#/shell/readings-api";
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
