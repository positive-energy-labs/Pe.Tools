import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { field, when, split, route, scrollBody } from "./defaults";
import { mountTypedRoute } from "../shell/typed-mount";
import { hostRead } from "./host-read";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { module as ducts } from "../ducts/route";

const fields = { stage: field(z.enum(["closed", "open"]), "closed", "stage", "push") };
function typeWitness() {
  // @ts-expect-error the value must belong to this field's enum
  when(fields, "stage", "nope", "detail");
  // @ts-expect-error the field must exist
  when(fields, "missing", "open", "detail");
}
void typeWitness;

test("wire preserves the ducts subject gates and declares stage roles", () => {
  expect(ducts.data.layout).toEqual(ducts.spec.layout);
  expect(JSON.stringify(ducts.data.layout).match(/"when":"subject"/g)).toHaveLength(2);
  expect(ducts.data.fields.stage?.role).toBe("stage");
  for (const key of ["stages", "stageOrder", "predicates"]) expect(ducts.data).not.toHaveProperty(key);
});

test("closed gates acquire no pane read; closing releases it and shared reads survive", async () => {
  const read = (key: string) => ({ ...hostRead({ ...ducts.spec.core!, key, input: z.object({}) }), args: () => ({}) });
  const detail = read("gate.detail"), shared = read("gate.shared");
  const pane = (read: typeof detail) => ({ title: "Witness", purpose: "Read demand", read, body: "scroll" as const, draw: () => scrollBody(null) });
  const declaration = route({ key: "gate-witness", name: "Gates", needs: "host", directory: ducts.data.directory, fields,
    panes: { always: pane(shared), detail: pane(detail), duplicate: pane(shared) },
    layout: split("h", ["always", when(fields, "stage", "open", split("v", ["detail", "duplicate"], { id: "inside", size: 200 }))], { id: "outside", size: 200 }),
  });
  const stopped = vi.fn(), sharedStopped = vi.fn();
  const open = vi.fn(() => stopped), sharedOpen = vi.fn(() => sharedStopped);
  const mount = mountTypedRoute(declaration, { address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    fixture: null, target: { kind: "host" }, work: { address: null, open: null }, custody: { current: () => true }, memory: () => ({}) },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { sources: { "gate.detail": { kind: "use", open }, "gate.shared": { kind: "use", open: sharedOpen } } });
  try {
    expect(open).not.toHaveBeenCalled();
    expect(sharedOpen).toHaveBeenCalledOnce();
    mount.page.pose({ stage: "open" });
    expect(open).toHaveBeenCalledOnce();
    await Promise.resolve();
    mount.page.pose({ stage: "closed" });
    expect(stopped).toHaveBeenCalledOnce();
    expect(sharedStopped).not.toHaveBeenCalled();
    mount.page.pose({ stage: "open" });
    expect(open).toHaveBeenCalledTimes(2);
  } finally { mount.dispose(); }
});
