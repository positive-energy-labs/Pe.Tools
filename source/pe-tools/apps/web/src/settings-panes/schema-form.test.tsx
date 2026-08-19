// @vitest-environment jsdom
/**
 * THE FIXTURE LANE IS PROVED HERE, hostless.
 *
 * `/settings?source=fixture` claims two things a route cannot cheaply assert about itself: that
 * the fixture's real captured schema and its real captured document produce a form model at all,
 * and that the model actually drives `SchemaToFieldRender` into schema-shaped fields. Both are
 * pinned below against the SAME inputs the route mounts — `FIXTURE_SCHEMA_JSON` and the fixture
 * snapshot's `rawContent` — so a schema re-capture or a renderer regression fails here instead of
 * on someone's screen.
 *
 * WHAT THIS DOES NOT COVER: the route SHELL (router, pickers, verbs, SSE bridge). Rendering that
 * needs a router context and a live-ish route-state; the boundary is deliberate and stated in the
 * round-3 report.
 *
 * The host is stubbed dead on purpose. Remote option sources still speak the host in fixture mode
 * (PRODUCT.md seam 1), so a suggestion list stays empty — the fields must render anyway, which is
 * exactly what "hostless" has to mean.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import { FIXTURE_SCHEMA_JSON, fixtureDocument } from "#/settings-panes/fixture";
import { schemaFormModel } from "#/settings-panes/schema-form";

const RAW = fixtureDocument.snapshot?.rawContent ?? "";

describe("the fixture lane's schema→form derivation", () => {
  it("form-generates the captured ScheduleProfile document with no host", () => {
    const model = schemaFormModel(RAW, FIXTURE_SCHEMA_JSON);
    expect(model).not.toBeNull();
    // The document's own authored values survive the defaults layer — the baseline is the file
    // plus defaults, never the defaults alone.
    expect(model?.parsedRaw.Name).toBe(model?.baseline.Name);
    expect(Object.keys(model?.baseline ?? {})).toContain("Fields");
  });

  it("refuses rather than generating an empty form", () => {
    expect(schemaFormModel(RAW, null)).toBeNull();
    expect(schemaFormModel("{ not json", FIXTURE_SCHEMA_JSON)).toBeNull();
    // A JSON array parses fine and is still not a form: the route falls back to the pointer
    // reviewer instead of rendering a form with no fields.
    expect(schemaFormModel("[1,2]", FIXTURE_SCHEMA_JSON)).toBeNull();
  });
});

function Harness() {
  const model = schemaFormModel(RAW, FIXTURE_SCHEMA_JSON);
  const form = useForm({ defaultValues: model?.baseline ?? {} });
  if (!model) return <p>no form model</p>;
  return (
    <SchemaToFieldRender
      form={form as unknown as Parameters<typeof SchemaToFieldRender>[0]["form"]}
      schema={model.schema}
      moduleKey="CmdScheduleManager"
      rootKey="schedules"
      baselineValues={model.baseline}
    />
  );
}

describe("SchemaToFieldRender over the fixture model", () => {
  it("renders schema-driven fields, host dead", async () => {
    // `FieldRenderer` code-splits its three field kinds. Warm them first so Suspense resolves on
    // the render pass rather than racing a module transform inside a waitFor budget.
    await Promise.all([
      import("#/lib/schema-to-field-render/scalar-field"),
      import("#/lib/schema-to-field-render/object-field"),
      import("#/lib/schema-to-field-render/array-field"),
    ]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no host in fixture mode")));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    // Labels come from the SCHEMA (x-ui hint ▸ title ▸ the property key), not from any
    // hand-rolled field list — so finding them IS the proof that the schema drove the render.
    // Fields lazy-load behind Suspense, hence `findBy`.
    expect(await screen.findByText("Name", {}, { timeout: 15000 })).toBeTruthy();
    expect(await screen.findByText("CategoryName")).toBeTruthy();
    // The document's authored values are IN the form, not merely in the fixture — the render is
    // over this document, not over the schema's defaults.
    const parsed = JSON.parse(RAW) as { Name: string; CategoryName: string };
    expect(await screen.findByDisplayValue(parsed.Name)).toBeTruthy();
    expect(await screen.findByDisplayValue(parsed.CategoryName)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
