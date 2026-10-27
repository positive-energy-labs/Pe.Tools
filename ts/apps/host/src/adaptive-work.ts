/** Predict a pull queue's tail, including work each existing executor still holds. */
export function workerBenefit(
  costs: readonly number[],
  availableIn: readonly number[],
  startupMs: number,
  minimumSavingMs = 30_000,
): boolean {
  if (!costs.length || !availableIn.length || availableIn.length >= 3) return false;
  const schedule = (extra: boolean) => {
    const slots = [...availableIn, ...(extra ? [startupMs] : [])];
    let assigned = 0;
    for (const cost of [...costs].sort((a, b) => b - a)) {
      const worker = slots.indexOf(Math.min(...slots));
      slots[worker] += cost;
      if (extra && worker === slots.length - 1) assigned++;
    }
    return { finish: Math.max(...slots), assigned };
  };
  const before = schedule(false),
    after = schedule(true);
  return (
    after.assigned > 0 && before.finish - after.finish > Math.max(minimumSavingMs, startupMs * 0.2)
  );
}

export interface WorkExecutor<T, R> {
  run(item: T): Promise<R>;
  dispose(): Promise<void>;
}

/** One indivisible item per idle executor; acquisition and disposal belong to the caller's runtime. */
export async function adaptiveWork<T, R>(options: {
  items: readonly T[];
  primary: WorkExecutor<T, R>;
  acquire: (useful: () => boolean) => Promise<WorkExecutor<T, R> | null>;
  cost: (item: T) => number;
  startupMs: () => number;
  canExpand: () => boolean;
  cancelled: () => boolean;
  completed: (item: T, value: R) => Promise<void>;
  warning: (error: unknown) => void;
}) {
  const queue = [...options.items];
  const available = new Map<WorkExecutor<T, R>, number>([[options.primary, 0]]);
  let starting = false,
    opened = 0,
    admitting = true;
  let failure: unknown, cleanupFailure: unknown;
  const extras: Promise<void>[] = [];
  const useful = () => !failure && !options.cancelled() && queue.length > 0;
  const run = async (executor: WorkExecutor<T, R>, auxiliary: boolean) => {
    while (useful()) {
      const item = queue.shift()!;
      available.set(executor, Date.now() + options.cost(item));
      let value: R;
      try {
        value = await executor.run(item);
      } catch (error) {
        if (!auxiliary) throw error;
        queue.unshift(item);
        if (!options.cancelled()) options.warning(error);
        return;
      }
      if (!options.cancelled()) {
        try {
          await options.completed(item, value);
        } catch (error) {
          failure ??= error;
          throw error;
        }
      }
      available.set(executor, Date.now());
      admit();
    }
  };
  function admit() {
    if (!useful() || !admitting || starting || opened >= 2 || !options.canExpand()) return;
    const now = Date.now();
    if (
      !workerBenefit(
        queue.map(options.cost),
        [...available.values()].map((at) => Math.max(0, at - now)),
        options.startupMs(),
      )
    )
      return;
    opened++;
    starting = true;
    extras.push(
      (async () => {
        let worker: WorkExecutor<T, R> | null = null;
        try {
          try {
            worker = await options.acquire(useful);
          } finally {
            starting = false;
          }
          if (worker) {
            available.set(worker, Date.now());
            // Readiness is an admission point too: the primary can still hold a long family.
            admit();
            await run(worker, true);
          }
        } catch (error) {
          if (!options.cancelled()) options.warning(error);
        } finally {
          if (worker) {
            available.delete(worker);
            await worker.dispose();
          }
        }
      })().catch((error: unknown) => {
        cleanupFailure ??= error;
      }),
    );
  }
  // Retained timings can justify an immediate start; cold estimates wait for the caller's samples.
  admit();
  try {
    await run(options.primary, false);
  } catch (error) {
    failure = error;
  }
  for (let i = 0; i < extras.length; i++) await extras[i];
  admitting = false;
  if (cleanupFailure) throw cleanupFailure;
  if (failure) throw failure;
  if (queue.length && !options.cancelled()) await run(options.primary, false);
}
