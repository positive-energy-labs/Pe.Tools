import { SHEET_COMMANDS } from "@pe/agent-contracts/slots";
import type { RevitBridge } from "@pe/host-internal/bridge";
import type { CommandExecutor } from "@pe/host-internal/command-executor";
import type { HostOffers, implement } from "@pe/host-internal/product";
import { platformFiles, type ProductDeclaration } from "@pe/agent-contracts/product";
type SheetOwner = Record<(typeof SHEET_COMMANDS)[keyof typeof SHEET_COMMANDS], CommandExecutor>;
export type SheetExecutors = ReadonlyMap<string, SheetOwner>;

/** One table from every product's, refusing a key two products claim or the platform holds. */
function merged<T>(
  what: string,
  tables: readonly Readonly<Record<string, T>>[],
  claimed: readonly string[] = [],
) {
  const all: Record<string, T> = Object.create(null);
  for (const [key, value] of tables.flatMap((table) => Object.entries(table))) {
    if (claimed.includes(key)) throw Error(`The platform owns the ${what} ${key}`);
    if (Object.hasOwn(all, key)) throw Error(`Duplicate product ${what} ${key}`);
    all[key] = value;
  }
  return all;
}

/** Work selects the admitted product's sheet body. */
export function bindProducts(
  // Each product's bodies take what they need from the offer; one that needs more fails `tsc` here.
  hosts: readonly ReturnType<typeof implement<ProductDeclaration, HostOffers>>[],
) {
  // The explicit list: each product's retained readings and home readers, registered here once.
  for (const host of hosts) host.register();
  return {
    productReads: hosts.map(({ reads }) => ({ reads })),
    /** Every declared `http` route with its body: the call route mounts each, and names none. */
    productHttp: hosts.flatMap(({ product, http }) =>
      Object.entries(product.http).map(([key, route]) => {
        const run = http[key];
        if (!run) throw Error(`No host body for the HTTP route ${key}`);
        return { route, run };
      }),
    ),
    /** Every declared local operation with its request schema and body, by catalog key. */
    productLocal: merged(
      "local operation",
      hosts.map(({ product, local }) =>
        Object.fromEntries(
          Object.entries(product.local).map(([key, { request, effects }]) => {
            const run = local[key];
            if (!run) throw Error(`No host body for the local operation ${key}`);
            return [key, { request, effects, run }];
          }),
        ),
      ),
    ),
    /** Every declared host file with its body, by the name `hostFile` gives its input. */
    productFiles: merged(
      "host file",
      hosts.map(({ product, files }) =>
        Object.fromEntries(
          Object.keys(product.files).map((key) => {
            const run = files[key];
            if (!run) throw Error(`No host body for the host file ${key}`);
            return [key, run];
          }),
        ),
      ),
      platformFiles,
    ),
    /** Every `snapshot` call of a reading that declares `emits`, with the kind the kernel keeps. */
    productEmitters: merged(
      "emitting call",
      hosts.map(({ emitters }) => emitters),
    ),
    productExecutors(bridge: RevitBridge["Service"], deps: HostOffers) {
      const executors: Record<string, CommandExecutor> = Object.create(null);
      const sheets = new Map<string, SheetOwner>();
      for (const { product, executors: make } of hosts) {
        const {
          [SHEET_COMMANDS.plan]: plan,
          [SHEET_COMMANDS.apply]: apply,
          ...commands
        } = make(bridge, deps);
        for (const [key, executor] of Object.entries(commands)) {
          if (Object.hasOwn(executors, key)) throw Error(`Duplicate product executor ${key}`);
          executors[key] = executor;
        }
        const sheet = product.sheetWrites;
        if (!sheet) continue;
        if (!plan || !apply || sheets.has(sheet.route))
          throw Error(`Work route ${sheet.route} needs both sheet bodies from one product`);
        sheets.set(sheet.route, { [SHEET_COMMANDS.plan]: plan, [SHEET_COMMANDS.apply]: apply });
      }
      return { executors, sheets };
    },
  };
}
