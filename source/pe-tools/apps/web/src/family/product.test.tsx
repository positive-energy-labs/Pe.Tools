// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { FAMILY_PRODUCT } from "#/family/product";
import { TargetingHead } from "#/targeting/head";
import type { Bindings, Runner } from "#/targeting/kit";
import type { Feed } from "#/state/route-store";

afterEach(cleanup);

const actions = () => ({ open: vi.fn(), save: vi.fn(), capture: vi.fn(), build: vi.fn() });

describe("FAMILY_PRODUCT", () => {
  it("declares the ruled terminals, stages, and panes", async () => {
    const run = actions();
    const product = FAMILY_PRODUCT(run);

    expect(product.links.map(({ key, joiner, dir }) => ({ key, joiner, dir }))).toEqual([
      { key: "session", joiner: "editing", dir: "duplex" },
      { key: "profile", joiner: "on", dir: "duplex" },
    ]);
    expect(product.stages.map((stage) => stage.key)).toEqual(["author", "evidence"]);
    expect(product.panes.map((pane) => pane.key)).toEqual([
      "sheet",
      "anatomy",
      "drill",
      "inspector",
    ]);
    await product.stages[0]!.verbs[0]!.run?.();
    expect(run.open).toHaveBeenCalledOnce();
  });

  it("prints feed state and lane without inventing freshness", () => {
    const product = FAMILY_PRODUCT(actions());
    const loading: Feed = { options: null, state: "loading", lane: "read", stale: false };
    const error: Feed = { options: null, state: "error", lane: "read", stale: false };
    const feeds: Record<string, Feed> = { session: loading, profile: error };
    const b: Bindings = {
      bound: { session: "s", profile: "p" },
      multi: {},
      feeds,
      labelOf: (link) => link.key,
      optionsOf: (link) => feeds[link.key]?.options ?? null,
      isPicked: () => false,
      pick: vi.fn(),
      isBound: () => true,
      open: null,
      setOpen: vi.fn(),
      pickerLevel: null,
      setPickerLevel: vi.fn(),
      pickerQuery: "",
      setPickerQuery: vi.fn(),
      stage: product.stages[0]!,
      setStage: vi.fn(),
      demanded: new Set(["session", "profile"]),
    };
    const runner: Runner = {
      busy: null,
      active: new Set(),
      run: vi.fn(),
      canRun: () => ({ ok: true, reason: "ready" }),
    };

    render(<TargetingHead product={product} b={b} runner={runner} />);

    expect(screen.getByText(/read · reading…/)).toBeTruthy();
    expect(screen.getByText(/read · read failed/)).toBeTruthy();
  });
});
