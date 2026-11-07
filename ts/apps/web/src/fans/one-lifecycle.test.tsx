// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { createWitness } from "./cutover.test-support";

test("four Fans panes share one Value subscription, which closes with the typed mount", async () => {
  const closes: (() => void)[] = [];
  const stop = vi.fn();
  const open = vi.fn(() => stop);
  const f = await createWitness(closes, new Map(), { "fans.sheet": { kind: "use", open } });
  try {
    for (const pane of Object.keys(f.typed.spec.panes)) f.typed.draw(pane);
    expect(open).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
  } finally { closes.reverse().forEach(close => close()); }
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
});
