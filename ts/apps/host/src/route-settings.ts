import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  routeSettingFields,
  routeSettingsSnapshotSchema,
  settingsSchema,
  type RouteSettingsSnapshot,
  type SettingField,
} from "@pe/agent-contracts";

/** The directory belongs to the OS user. Neither request bodies nor threads select a user. */
export function createRouteSettings(
  directory: string,
  declarations: Readonly<
    Record<string, Readonly<Record<string, SettingField>>>
  > = routeSettingFields,
) {
  const listeners = new Set<(route: string) => void>();
  const schema = (route: string) => {
    const fields = Object.hasOwn(declarations, route) ? declarations[route] : undefined;
    if (!fields) throw Error(`No settings declared for route '${route}'`);
    return settingsSchema(fields);
  };
  const path = (route: string) =>
    join(directory, `${createHash("sha256").update(route).digest("hex")}.json`);
  const read = (route: string): RouteSettingsSnapshot => {
    const fields = schema(route);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path(route), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { revision: 0, values: fields.parse({}) as RouteSettingsSnapshot["values"] };
      throw error;
    }
    const saved = z
      .strictObject({ route: z.literal(route), ...routeSettingsSnapshotSchema.shape })
      .parse(raw);
    return {
      revision: saved.revision,
      values: fields.parse(saved.values) as RouteSettingsSnapshot["values"],
    };
  };
  return {
    read,
    set(route: string, patch: Record<string, unknown>, expectedRevision: number) {
      const current = read(route);
      if (current.revision !== expectedRevision)
        throw Error("Settings changed; read them again before editing");
      const fields = schema(route);
      // Parse the patch separately: defaults must not reset fields omitted by the caller.
      const validated = fields.partial().parse(patch);
      const parsed = Object.fromEntries(Object.keys(patch).map((key) => [key, validated[key]]));
      const next = {
        revision: current.revision + 1,
        values: fields.parse({ ...current.values, ...parsed }),
      };
      mkdirSync(directory, { recursive: true });
      const temporary = `${path(route)}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify({ route, ...next }));
      renameSync(temporary, path(route));
      for (const notify of listeners) notify(route);
      return next;
    },
    subscribe(notify: (route: string) => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  };
}
