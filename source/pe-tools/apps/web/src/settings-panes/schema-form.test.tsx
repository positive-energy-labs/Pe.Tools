// @vitest-environment jsdom
/**
 * THE SEED LANE IS PROVED HERE, hostless.
 *
 * The seed lane claims two things a route cannot cheaply assert about itself: that
 * the seed's real captured schema and its real captured document produce a form model at all,
 * and that the model actually drives `SchemaToFieldRender` into schema-shaped fields. Both are
 * pinned below against the SAME inputs the route mounts through `?demo=` — `SETTINGS_SEED_SCHEMA` and the seed
 * snapshot's `rawContent` — so a schema re-capture or a renderer regression fails here instead of
 * on someone's screen.
 *
 * WHAT THIS DOES NOT COVER: the route SHELL (router, pickers, verbs, SSE bridge). Rendering that
 * needs a router context and a live-ish route-state; the boundary is deliberate and stated in the
 * round-3 report.
 *
 * The host is stubbed dead on purpose. Remote option sources still speak the host in seed mode
 * (PRODUCT.md seam 1), so a suggestion list stays empty — the fields must render anyway, which is
 * exactly what "hostless" has to mean.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import { SETTINGS_SEED_RAW, SETTINGS_SEED_SCHEMA } from "#/settings/seeds";
import { schemaFormModel } from "#/settings-panes/schema-form";

const RAW = SETTINGS_SEED_RAW;

describe("the seed lane's schema→form derivation", () => {
  it("form-generates the captured ScheduleProfile document with no host", () => {
    const model = schemaFormModel(RAW, SETTINGS_SEED_SCHEMA);
    expect(model).not.toBeNull();
    // The document's own authored values survive the defaults layer — the baseline is the file
    // plus defaults, never the defaults alone.
    expect(model?.parsedRaw.Name).toBe(model?.baseline.Name);
    expect(Object.keys(model?.baseline ?? {})).toContain("Fields");
  });

  it("refuses rather than generating an empty form", () => {
    expect(schemaFormModel(RAW, null)).toBeNull();
    expect(schemaFormModel("{ not json", SETTINGS_SEED_SCHEMA)).toBeNull();
    // A JSON array parses fine and is still not a form: the route falls back to the pointer
    // reviewer instead of rendering a form with no fields.
    expect(schemaFormModel("[1,2]", SETTINGS_SEED_SCHEMA)).toBeNull();
  });
});

function Harness({ changed = false }: { changed?: boolean }) {
  const model = schemaFormModel(RAW, SETTINGS_SEED_SCHEMA);
  if (!model) return <p>no form model</p>;
  return (
    <SchemaToFieldRender
      schema={model.schema}
      schemaUrl="/schemas/settings/CmdScheduleManager/schedules.json"
      baselineValues={model.baseline}
      values={changed ? { ...model.baseline, Name: "changed" } : model.baseline}
      onChange={() => undefined}
    />
  );
}

describe("SchemaToFieldRender over the seed model", () => {
  it("renders schema-driven fields, host dead", async () => {
    // `FieldRenderer` code-splits its three field kinds. Warm them first so Suspense resolves on
    // the render pass rather than racing a module transform inside a waitFor budget. The warm-up
    // itself is the slow part — `array-field` pulls the highlighter and its languages in with
    // `JsonEditor` — so this test owns a timeout that matches the `findByText` budget below
    // rather than vitest's 5 s default, which it loses to under a full-suite transform load.
    await Promise.all([
      import("#/lib/schema-to-field-render/scalar-field"),
      import("#/lib/schema-to-field-render/object-field"),
      import("#/lib/schema-to-field-render/array-field"),
    ]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no host in seed mode")));
    render(<Harness />);

    // Labels come from the SCHEMA (x-ui hint ▸ title ▸ the property key), not from any
    // hand-rolled field list — so finding them IS the proof that the schema drove the render.
    // Fields lazy-load behind Suspense, hence `findBy`.
    expect(await screen.findByText("Name", {}, { timeout: 15000 })).toBeTruthy();
    expect(await screen.findByText("CategoryName")).toBeTruthy();
    // The document's authored values are IN the form, not merely in the seed — the render is
    // over this document, not over the schema's defaults.
    const parsed = JSON.parse(RAW) as { Name: string; CategoryName: string };
    expect(await screen.findByDisplayValue(parsed.Name)).toBeTruthy();
    expect(await screen.findByDisplayValue(parsed.CategoryName)).toBeTruthy();
    vi.unstubAllGlobals();
  }, 20000);

  it("shows changed values against the raw document baseline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no host in seed mode")));
    render(<Harness changed />);

    expect(await screen.findByDisplayValue("changed")).toBeTruthy();
    expect(await screen.findByText("Changed")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
