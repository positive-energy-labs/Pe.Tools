import { z } from "zod";
import { deepEqual } from "@tanstack/react-router";
import type {
  AdmittedRoute,
  AdmittedRouteRegistry,
} from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type {
  AcceptanceOwner,
  MoveOrigin,
  MoveResult,
  SchemaTable,
} from "../../../../packages/agent-contracts/src/route-kernel-page";
import { resolveRouteBindings } from "../../../../packages/agent-contracts/src/route-module";
import { routeBindingSchema } from "../../../../packages/agent-contracts/src/route-bodies";
import { createPagePolicy, selectionCodec } from "./page-port";

import type { AdmittedAddressPort } from "./typed-address";

const decodedValue = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
const refused = (message: string): MoveResult => ({ kind: "refused", code: "address", message });

/** One admitted transport; Page policy owns precedence and the owner owns the single commit. */
export function createAdmittedAddress<G extends RouteGraphJson, S extends SchemaTable>(options: {
  readonly route: AdmittedRoute<
    G,
    SchemaTable,
    import("../../../../packages/agent-contracts/src/route-kernel-bodies").EntryTable,
    unknown,
    Record<string, unknown>
  >;
  readonly registry: AdmittedRouteRegistry;
  readonly owner: AcceptanceOwner<G, S>;
  readonly policy: Pick<ReturnType<typeof createPagePolicy<G, S>>, "restoreState">;
  readonly address: AdmittedAddressPort;
  readonly memory: () => unknown;
  readonly origin: Extract<MoveOrigin, { kind: "restore" }>;
}) {
  const { route, registry, owner, policy, address } = options;
  const resolve = () => {
    const bindings = resolveRouteBindings(registry, route);
    if (!bindings) throw Error("Foreign or retired address admission");
    return bindings;
  };
  // Dynamic field iteration uses the checked runtime view, without a route-specific cast.
  const codecs = routeBindingSchema.shape.codecs.parse(resolve().codecs);
  const fields = Object.entries(route.data.fields).filter(
    ([, field]) =>
      field.role === "selection" ||
      (!["setting", "device", "transient"].includes(field.role) &&
        "url" in field &&
        field.url !== false),
  );
  let closed = false;
  let restoring = false;
  let writing = false;
  let previous = owner.read();

  const restore = (): MoveResult => {
    if (closed) return refused("Address transport is closed");
    resolve();
    const search = address.read();
    const url: Record<string, unknown> = {};
    try {
      for (const [key, field] of fields) {
        if (!search.has(key)) continue;
        if (search.getAll(key).length !== 1) return refused(`Repeated address field: ${key}`);
        const text = search.get(key)!;
        const result =
          field.role === "selection"
            ? selectionCodec(route.data, field.kinds, field.allowAll === true).decode(text)
            : decodedValue.parse(codecs[field.codec]!.decode(text));
        if (!result.ok) return refused(`Invalid address field ${key}: ${result.reason}`);
        url[key] = result.value;
      }
    } catch {
      return refused("Address codec failed");
    }
    const state = policy.restoreState(url, options.memory());
    if (!state.ok) return refused(state.reason);
    restoring = true;
    try {
      return owner.restorePage(state.value, options.origin);
    } finally {
      previous = owner.read();
      restoring = false;
    }
  };

  // Address writes and Place links project the same accepted Page through admitted codecs.
  const encodePage = (
    search: URLSearchParams,
    snapshot: NonNullable<ReturnType<typeof owner.read>>,
    share = false,
  ) => {
    for (const [key, field] of fields) {
      if (share && field.role !== "selection" && !("share" in field && field.share)) continue;
      const text =
        field.role === "selection"
          ? selectionCodec(route.data, field.kinds, field.allowAll === true).encode(
              snapshot.page[key],
            )
          : {
              ok: true as const,
              value: z.string().parse(codecs[field.codec]!.encode(snapshot.page[key])),
            };
      if (!text.ok) throw Error(text.reason);
      search.set(key, text.value);
    }
  };
  const initial = restore();
  const unsubscribeOwner = owner.subscribe((snapshot, origin) => {
    const before = previous;
    previous = snapshot;
    if (closed || restoring || !before) return;
    const changed = fields.filter(([key]) => !deepEqual(before.page[key], snapshot.page[key]));
    if (!changed.length) return;
    resolve();
    const search = new URLSearchParams(address.read());
    // Include defaults: omission would let stale tab memory win on Back/Forward.
    encodePage(search, snapshot);
    // ADR 0030 rule 10: a Pea move pushes history so Back undoes it.
    const history =
      origin?.kind === "human"
        ? origin.history
        : origin?.kind === "pea"
          ? "push"
          : changed.some(
                ([, field]) =>
                  field.role === "selection" || ("url" in field && field.url === "push"),
              )
            ? "push"
            : "replace";
    writing = true;
    try {
      address.write(search, history);
    } finally {
      writing = false;
    }
  });
  const unsubscribeAddress = address.subscribe(() => {
    if (!closed && !writing) restore();
  });
  return Object.freeze({
    initial,
    restore,
    link() {
      if (closed) throw Error("Address transport is closed");
      resolve();
      const snapshot = owner.read();
      if (!snapshot) throw Error("Page is unavailable");
      const search = new URLSearchParams();
      encodePage(search, snapshot, true);
      for (const key of ["target", "work", "fixture"]) {
        const value = address.read().get(key);
        if (value !== null) search.set(key, value);
      }
      return `${route.data.address}${search.size ? `?${search}` : ""}`;
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribeOwner();
      unsubscribeAddress();
    },
  });
}
