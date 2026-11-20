import { handle } from "@pe/agent-contracts/handle";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { module as ops } from "../ops/route";
import { field } from "@pe/agent-contracts/route";
import { paneLayout, route, scrollBody } from "@pe/web-kernel/route";

/*
 * Map slice 4's falsifiers for verbs (docs/features/routes/MAP.md). The three `@ts-expect-error`
 * lines are proved by `tsc`: each goes red (TS2578, unused directive) the moment the error it
 * expects stops being one.
 */
const directory = ops.data.directory;
const declare = (placed: { band?: readonly "read"[]; pane?: readonly "read"[] }) =>
  route({
    key: "verbs-probe",
    name: "Verbs probe",
    needs: "browser",
    directory,
    fields: { note: field(z.string(), "", "query") },
    verbs: { read: { handle: handle("families.read"), label: "Read" } },
    band: placed.band,
    panes: {
      main: {
        title: "Probe",
        purpose: "Verb placement",
        verbs: placed.pane,
        body: "scroll",
        draw: (ctx) => {
          // A declared id and a kernel id are verbs of this route.
          void ctx.verb("read").run;
          void ctx.verb("findings.say").run;
          // @ts-expect-error `nope` is not a verb this route declared.
          void ctx.verb("nope");
          return scrollBody(null);
        },
      },
    },
    layout: paneLayout("main"),
  });

test("a verb is in the band or in exactly one pane, or route() throws", () => {
  expect(declare({ band: ["read"] }).data).toMatchObject({
    band: ["read"],
    panes: { main: { verbs: [] } },
  });
  expect(declare({ pane: ["read"] }).data).toMatchObject({
    band: [],
    panes: { main: { verbs: ["read"] } },
  });
  expect(() => declare({})).toThrow('verb "read" is in neither the band nor a pane');
  expect(() => declare({ band: ["read"], pane: ["read"] })).toThrow(
    'verb "read" is placed more than once',
  );
});

test("a verb's handle is a catalog key, and a planned handle says how its review reads", () => {
  const typo = () =>
    route({
      key: "verbs-typo",
      name: "Typo",
      needs: "browser",
      directory,
      fields: {},
      verbs: {
        // @ts-expect-error `families.reed` is no command or route in the generated table.
        push: { handle: handle("families.reed"), label: "Push" },
        // @ts-expect-error `sheet.apply` has a plan, so its verb must declare `present`.
        apply: { handle: handle("sheet.apply"), label: "Apply" },
      },
      band: ["push", "apply"],
      panes: {
        main: { title: "Typo", purpose: "Typo", body: "scroll", draw: () => scrollBody(null) },
      },
      layout: paneLayout("main"),
    });
  expect(typo).toThrow("No command or route: families.reed");
});

test("the wire says who draws each verb, its effect, and whether it is reviewed", () => {
  // `/ops`: a receipt control carries its own effect, never a Read's.
  expect(ops.data.verbs["action.cancel"]).toMatchObject({
    entry: "action.cancel",
    effect: "SessionWrite",
    review: "none",
  });
  expect(ops.data.verbs.run).toMatchObject({
    entry: "ops.read",
    effect: handle("ops.read").effect,
  });
});
