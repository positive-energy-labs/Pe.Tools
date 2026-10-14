import type { Plugin, PluginContext, PluginHookName, PluginHooks, PluginStatus } from "./plugin.ts";

type Entry<T> = { plugin: Plugin<T>; status: PluginStatus; dispose: (() => Promise<void>) | null };
/** One scoped registration path for builtin and authored contributions. Installation is explicit. */
export function createPluginRuntime<T>(
  options: { persist?: (id: string, enabled: boolean) => Promise<void>; changed?: () => void } = {},
) {
  const entries = new Map<string, Entry<T>>();
  const contributions = new Map<string, { owner: string; value: T }>();
  const hooks = new Map<
    PluginHookName,
    Set<{ owner: Entry<T>; run: (event: never) => void | Promise<void> }>
  >();
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <R>(work: () => Promise<R>): Promise<R> => {
    const next = tail.catch(() => {}).then(work);
    tail = next;
    return next;
  };
  async function deactivate(entry: Entry<T>) {
    const dispose = entry.dispose;
    entry.dispose = null;
    entry.status = { id: entry.plugin.id, status: "disabled" };
    try {
      await dispose?.();
    } catch (error) {
      entry.status = { id: entry.plugin.id, status: "error", error: String(error) };
    }
  }
  async function activate(entry: Entry<T>) {
    const cleanup: (() => void)[] = [];
    let active = true;
    let finalizer: void | (() => void | Promise<void>);
    entry.dispose = async () => {
      active = false;
      for (const dispose of cleanup.reverse()) dispose();
      await finalizer?.();
    };
    const requireActive = () => {
      if (!active) throw Error(`Plugin '${entry.plugin.id}' is inactive`);
    };
    const context: PluginContext<T> = {
      id: entry.plugin.id,
      contribute(key, value) {
        requireActive();
        if (contributions.has(key)) throw Error(`Duplicate plugin contribution '${key}'`);
        const row = { owner: entry.plugin.id, value };
        contributions.set(key, row);
        const dispose = () => {
          if (contributions.get(key) === row) contributions.delete(key);
        };
        cleanup.push(dispose);
        return { dispose };
      },
      hook(name, observer) {
        requireActive();
        let callbacks = hooks.get(name);
        if (!callbacks) hooks.set(name, (callbacks = new Set()));
        const row = { owner: entry, run: observer as (event: never) => void | Promise<void> };
        callbacks.add(row);
        const dispose = () => {
          callbacks.delete(row);
        };
        cleanup.push(dispose);
        return { dispose };
      },
    };
    try {
      finalizer = await entry.plugin.setup(Object.freeze(context));
      entry.status = { id: entry.plugin.id, status: "active" };
    } catch (error) {
      await deactivate(entry);
      entry.status = { id: entry.plugin.id, status: "error", error: String(error) };
    }
  }
  return {
    install: (plugin: Plugin<T>, enabled = true) =>
      serial(async () => {
        const previous = entries.get(plugin.id);
        if (previous) await deactivate(previous);
        const entry: Entry<T> = {
          plugin,
          status: { id: plugin.id, status: "disabled" },
          dispose: null,
        };
        entries.set(plugin.id, entry);
        if (enabled) await activate(entry);
        options.changed?.();
      }),
    setEnabled: (id: string, enabled: boolean) =>
      serial(async () => {
        const entry = entries.get(id);
        if (!entry) throw Error(`Unknown plugin '${id}'`);
        await options.persist?.(id, enabled);
        if (!enabled) await deactivate(entry);
        else if (entry.status.status !== "active") await activate(entry);
        options.changed?.();
      }),
    remove: (id: string) =>
      serial(async () => {
        const entry = entries.get(id);
        if (entry) await deactivate(entry);
        entries.delete(id);
        options.changed?.();
      }),
    inventory: () => [...entries.values()].map((e) => ({ ...e.status })),
    contributions: () => [...contributions.values()].map((c) => c.value),
    active: (id: string) => entries.get(id)?.status.status === "active",
    emit: async <N extends PluginHookName>(name: N, event: PluginHooks[N]) => {
      const immutable = freeze(structuredClone(event));
      for (const row of [...(hooks.get(name) ?? [])]) {
        if (!hooks.get(name)?.has(row) || !row.owner.dispose) continue;
        try {
          await row.run(immutable as never);
        } catch (error) {
          row.owner.status.error = `${name}: ${String(error)}`;
        }
      }
    },
    close: () =>
      serial(async () => {
        for (const entry of entries.values()) await deactivate(entry);
        entries.clear();
      }),
  };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
