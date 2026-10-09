// @vitest-environment jsdom
/**
 * The catalogue names the seeds that exist and links to them. It builds nothing, so this test
 * proves exactly two things: every seed on a route manifest appears, and each row's link is the
 * `?demo=<action>` URL that `useRoute` reads. The old demo-map lane it used to drive is deleted.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { CHAT_SEEDS } from "#/chat/seeds";
import { PODS_SEEDS } from "#/route/seeds";
import { SCHEDULE_SEEDS } from "#/route/schedules/manifest";
import { OPEN_SEEDS } from "#/open/seeds";
import { manifest as takeoffManifest } from "#/takeoff/manifest";
import { manifest as familyManifest } from "#/routes/family";
import { manifest as familiesManifest } from "#/families/manifest";

import { ActionDemoCatalogue, SEED_CATALOGUE } from "#/design-system/action-demo-catalogue";

const declared = [
  ["chat", CHAT_SEEDS],
  ["pods", PODS_SEEDS],
  ["schedules", SCHEDULE_SEEDS],
  ["instances", OPEN_SEEDS],
  ["takeoffs", takeoffManifest.seeds],
  ["family", familyManifest.seeds],
  ["families", familiesManifest.seeds],
] as const;

test("every seed a route manifest declares is one catalogue row", () => {
  const expected = declared.flatMap(([route, seeds]) =>
    Object.keys(seeds ?? {}).map((action) => `${route}.${action}`),
  );
  expect(expected.length).toBeGreaterThan(0);
  expect(SEED_CATALOGUE.map((row) => `${row.route}.${row.action}`).sort()).toEqual(expected.sort());
});

test("each row links to the ?demo= URL that mounts the seed, and names the seed's own title", () => {
  for (const row of SEED_CATALOGUE) {
    expect(row.href).toBe(`${row.path}?demo=${encodeURIComponent(row.action)}`);
    expect(row.title.length).toBeGreaterThan(0);
  }
});

afterEach(cleanup);

test("the catalogue renders one link per seed", () => {
  const { container } = render(<ActionDemoCatalogue />);
  const links = [...container.querySelectorAll('table[aria-label="Route seeds"] a')];
  expect(links).toHaveLength(SEED_CATALOGUE.length);
  const byHref = (a: string, b: string) => a.localeCompare(b);
  expect(links.map((link) => link.getAttribute("href") ?? "").sort(byHref)).toEqual(
    SEED_CATALOGUE.map((row) => row.href).sort(byHref),
  );
});
