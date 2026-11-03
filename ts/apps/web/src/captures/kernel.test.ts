import { afterEach, expect, test, vi } from "vite-plus/test";
import { admitCaptures, capturesArtifact } from "./admission";
import { createCapturesMount } from "./mount";
import { captureId } from "./kernel";
import { mountAdmittedRoute } from "../shell/admitted-mount";
import type { UseSource } from "../shell/readings";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((close) => close());
});
const source: UseSource = {
  kind: "use",
  open: (_, deliver) => deliver({ kind: "complete", value: [], revision: 1 }),
};
test("the shipped artifact mounts, restores subject and selection together, and retires", async () => {
  const route = await admitCaptures();
  const selected = [{ kind: "capture", id: captureId("second") }];
  const mounted = createCapturesMount(
    route,
    capturesArtifact.fingerprint,
    source,
    {
      sha: captureId("first"),
      selected: JSON.stringify(selected),
      open: JSON.stringify({ kind: "ids", ids: ["second"] }),
    },
    () => {},
  );
  cleanups.push(() => mounted.close());
  expect(mounted.read()).toMatchObject({
    page: { sha: captureId("first"), selected, open: { kind: "ids", ids: ["second"] } },
    reading: { current: true, value: [] },
  });
  expect(mounted.ports.page.select([]).kind).not.toBe("refused");
  mounted.restore({ sha: "legacy-sha", open: "legacy-sha" });
  expect(mounted.read().page).toMatchObject({
    sha: captureId("legacy-sha"),
    selected: [],
    open: { kind: "ids", ids: ["legacy-sha"] },
  });
  mounted.close();
  expect(() => mounted.read()).toThrow(/admission/);
});
test("a stale stamp or copied handle cannot mount", async () => {
  const route = await admitCaptures();
  expect(() => mountAdmittedRoute(route, "0".repeat(64))).toThrow(/Stale/);
  // @ts-expect-error reconstructed handles lack A's private authority
  const copied: typeof route = { data: route.data, fingerprint: route.fingerprint };
  expect(() => mountAdmittedRoute(copied, route.fingerprint)).toThrow(/admission/);
});
test.each(["body", "schema", "hash"])(
  "a mutated %s refuses before evaluation or mount",
  async (kind) => {
    const input = structuredClone(capturesArtifact);
    if (kind === "hash") input.artifact.executables[0]!.members[0]!.sha256 = "0".repeat(64);
    else {
      const member = input.executables[0]!.members[0]!;
      // An executable body or schema edit invalidates the exact shipped-byte stamp.
      member.bytes = new TextEncoder().encode(
        new TextDecoder().decode(member.bytes) +
          (kind === "body"
            ? "\nmodule.bodies.main.run = () => null;\n"
            : "\nmodule.schemas.subject = null;\n"),
      );
    }
    const evaluate = vi.fn(async () => {
      throw Error("Unverified code evaluated");
    });
    await expect(admitCaptures(input, evaluate)).rejects.toThrow(/fingerprint/);
    expect(evaluate).not.toHaveBeenCalled();
  },
);
test("admitted tables cannot replace bodies or schemas after byte verification", async () => {
  const route = await admitCaptures();
  const mounted = createCapturesMount(route, route.fingerprint, source, {}, () => {});
  cleanups.push(() => mounted.close());
  expect(() =>
    Object.defineProperty(mounted.bindings.bodies.main!, "run", { value: () => null }),
  ).toThrow();
  expect(() =>
    Object.defineProperty(mounted.bindings.schemas, "subject", { value: null }),
  ).toThrow();
  expect(mounted.read().reading.current).toBe(true);
});

test.each(["browse", "", "unknown"])("fixture %s never reaches the host", async (fixture) => {
  const route = await admitCaptures();
  const open = vi.fn(() => {
    throw Error("Native fallback");
  });
  const mounted = createCapturesMount(
    route,
    route.fingerprint,
    { kind: "use", open },
    { fixture },
    () => {},
  );
  cleanups.push(() => mounted.close());
  const reading = mounted.read().reading;
  expect(reading.current).toBe(fixture === "browse");
  if (reading.current) expect(reading.value[0]?.view.name).toBe("Ground plan");
  await mounted.refresh();
  expect(open).not.toHaveBeenCalled();
});
