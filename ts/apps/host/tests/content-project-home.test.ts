import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { expect, test } from "vite-plus/test";
import { Layer } from "effect";
import { HttpServer } from "effect/http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/contracts";
import { pagesRoute } from "../src/pages-route.ts";
import { readProjectCatalogs } from "./project-home-fixture.ts";
import { projectFixture } from "./project-home-fixture.ts";
import { createContributionContent } from "../src/pe-routes.ts";

test("Pages and the Catalogs reading read the target document's project home", async () => {
  const f = await projectFixture(false, () =>
    pagesRoute().pipe(
      Layer.provide(
        Layer.succeed(HttpServer.HttpServer, {
          address: { _tag: "TcpAddress", hostname: "127.0.0.1", port: 0 },
        } as never),
      ),
    ),
  );
  await mkdir(join(f.project, "Pages", "project-page"), { recursive: true });
  await writeFile(
    join(f.project, "Pages", "project-page", "index.html"),
    "<title>Project page</title>",
  );
  await mkdir(join(f.project, "Catalogs", "project"), { recursive: true });
  await writeFile(join(f.project, "Catalogs", "project", "fixture.pdf"), "%PDF-fixture");
  const axis = { quantity: "flow", unit: "cfm", values: [1, 2], input: { field: "flowCfm" } };
  await writeFile(
    join(f.project, "Catalogs", "project", "catalog.json"),
    JSON.stringify({
      version: 1,
      tables: [
        {
          id: "project-table",
          title: "Project table",
          source: {
            file: "fixture.pdf",
            title: "Fixture",
            edition: "1",
            url: "https://example.com/fixture",
            page: 1,
            pdfPage: 1,
          },
          rows: axis,
          columns: axis,
          cells: {
            quantity: "pressure",
            unit: "in-wg",
            values: [
              [1, 2],
              [3, 4],
            ],
          },
          result: {
            from: "cells",
            quantity: "static-pressure",
            unit: "in-wg",
            toInWg: 1,
            velocityBasis: "connector",
            note: "fixture",
          },
        },
      ],
    }),
  );
  const headers = {
    [HOST_RPC_BRIDGE_SESSION_HEADER]: f.target.ref.session,
    [HOST_RPC_DOCUMENT_HEADER]: f.target.ref.openId,
    accept: "application/json",
  };
  const pages = await f.request(new Request("http://fixture/pages", { headers }));
  expect(pages.status).toBe(200);
  expect
    .soft(await pages.json())
    .toMatchObject({ pages: [expect.objectContaining({ slug: "project-page" })] });
  expect(await readProjectCatalogs(f, f.target.ref)).toMatchObject({
    tables: { "project-table": { title: "Project table" } },
    findings: [],
  });
  const freePages = await f.request(
    new Request("http://fixture/pages", { headers: { accept: "application/json" } }),
  );
  expect(await freePages.json()).toMatchObject({ pages: [] });
  expect(await readProjectCatalogs(f, null)).toMatchObject({ tables: {} });
  const content = createContributionContent({
    worldRoot: stateFixture(join(f.dir, "agent")),
    homeRoot: join(f.dir, "user"),
  });
  try {
    expect(await content.pages("Projects/Example")).toEqual([
      expect.objectContaining({ key: "page:@pages/project-page" }),
    ]);
    expect(await content.pages()).toEqual([]);
  } finally {
    await content.close();
  }
});
