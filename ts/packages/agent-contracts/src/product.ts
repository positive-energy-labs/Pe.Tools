/**
 * The product declaration kernel (ruling 1 of docs/features/routes/MAP.md): one value per product at
 * `ts/products/<p>/contract/src/product.ts`, found by path. The host binds it with `implement()`
 * (`@pe/host-internal/product`) and the web with `screen()` (`@pe/web-kernel/route/screen`), and a
 * missing or extra body is a compile error. Runtime-neutral: nothing here imports a host or web package.
 */
import type { z } from "zod";
import type { Command, Tool } from "./command.ts";
import type { ReadHandle } from "./handle.ts";

export type Reading = {
  readonly handle: Pick<ReadHandle, "key" | "input" | "data">;
  /** One sentence for Pea's read discovery. */
  readonly says?: string;
};
/** `key` is the route key; `panes` names every pane `screen()` must draw, no more and no fewer. */
export type ProductRoute = { readonly key: string; readonly panes: readonly string[] };
/** Judgment text only: what no schema can say. */
export type Guide = {
  readonly instructions: string;
  readonly skills: readonly { readonly name: string; readonly content: string }[];
};
export type ProductDeclaration = {
  /** The product folder's name, and the name of Pea's tool. */
  readonly id: string;
  readonly says: string;
  readonly readings: Readonly<Record<string, Reading>>;
  /** Keyed by the catalog command key. */
  readonly commands: Readonly<Record<string, Command>>;
  readonly routes: Readonly<Record<string, ProductRoute>>;
  readonly guide?: Guide;
};

const noGuide: Guide = { instructions: "", skills: [] };
/** The declaration, plus the three projections the generated product list reads. */
export function product<const P extends ProductDeclaration>(declaration: P) {
  const tool: Tool<P["commands"]> = {
    name: declaration.id,
    says: declaration.says,
    commands: declaration.commands,
  };
  const readings = Object.values(declaration.readings);
  return {
    ...declaration,
    guide: declaration.guide ?? noGuide,
    tool,
    reads: {
      inputs: Object.fromEntries(
        readings.map((reading) => [reading.handle.key, reading.handle.input]),
      ),
      help: readings.flatMap((reading) => reading.says ?? []).join(" "),
    },
  };
}

/** Refuses a key the declaration does not have, even through a variable or a spread. */
export type NoExtras<Actual, Expected> = Record<Exclude<keyof Actual, keyof Expected>, never>;
type Handle<
  P extends ProductDeclaration,
  K extends keyof P["readings"],
> = P["readings"][K]["handle"];
/** One body per declared reading and per declared command. The runtime names its own context and executor. */
export type HostBodies<P extends ProductDeclaration, Context, Executor> = {
  readonly readings: {
    readonly [K in keyof P["readings"]]: (
      ctx: Context,
      args: z.output<Handle<P, K>["input"]>,
    ) => z.output<Handle<P, K>["data"]> | Promise<z.output<Handle<P, K>["data"]>>;
  };
  readonly commands: { readonly [K in keyof P["commands"]]: Executor };
};
