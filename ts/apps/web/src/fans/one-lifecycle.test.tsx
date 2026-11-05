// @vitest-environment jsdom
// Step 5 R on the real /fans mount: its native route readings and a shell hook subject both open
// through the one source-attempt lifecycle, release once on close, and no second engine is built.
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { expect, test, vi } from "vite-plus/test";
import { createWitness } from "./cutover.test-support";

const attempts = vi.hoisted(() => ({ opened: 0, closed: 0 }));
vi.mock("../shell/readings-use", async (importOriginal) => {
  const real = await importOriginal<typeof import("../shell/readings-use")>();
  return {
    ...real,
    openSourceReading: ((...args: Parameters<typeof real.openSourceReading>) => {
      attempts.opened++;
      const close = real.openSourceReading(...args);
      let once = false;
      return () => {
        if (!once) attempts.closed++;
        once = true;
        close();
      };
    }) as typeof real.openSourceReading,
  };
});
vi.mock("../shell/readings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shell/readings")>()),
  createReadingGraph: () => {
    throw Error("/fans ran a second reading engine");
  },
}));
const { readingAtom } = await import("../shell/readings-hooks");

test("/fans route readings and a shell hook share one acquisition and release lifecycle", async () => {
  const closes: (() => void)[] = [];
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("sheet").snapshot.current).toBe(true));
  const routeAttempts = attempts.opened;
  expect(routeAttempts).toBeGreaterThan(0);
  const registry = AtomRegistry.make();
  const stop = registry.subscribe(
    readingAtom({ kind: "world" }, { subscribe: () => () => {} } as never),
    () => {},
    { immediate: true },
  );
  expect(attempts.opened).toBe(routeAttempts + 1);
  stop();
  closes.reverse().forEach((close) => close());
  await vi.waitFor(() => expect(attempts.closed).toBe(attempts.opened));
});
