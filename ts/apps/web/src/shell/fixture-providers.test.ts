import { expect, test } from "vite-plus/test";
import { routeRegistry } from "../route/registry.ts";

test.each(Object.values(routeRegistry).map(({ module }) => [module.data.key, module] as const))(
  "%s registered fixture providers satisfy every read contract",
  async (_, module) => {
    const spec = module.spec;
    const page = {
      ...Object.fromEntries(
        Object.entries(spec.fields).map(([key, field]) => [key, field.initial]),
      ),
      selected: [],
    };
    const reads = new Set([
      spec.core,
      spec.goal,
      spec.subject?.read,
      ...Object.values(spec.reads ?? {}),
      ...Object.values(spec.panes).map((pane) => pane.read),
    ]);
    for (const read of reads) {
      if (!read?.fixtures) continue;
      const providers = typeof read.fixtures === "function" ? await read.fixtures() : read.fixtures;
      for (const name of Object.keys(providers)) {
        const args = "args" in read && typeof read.args === "function" ? read.args(page) : {};
        const packet = await read.source.provide!(name, args);
        expect(read.output.parse(packet).value, `${spec.key}/${read.key}/${name}`).not.toBeNull();
      }
    }
  },
);
