/** Predict the tail of a pull queue. A worker is admitted only if it gets useful work and saves real time. */
export function workerBenefit(
  costs: readonly number[],
  ready: number,
  starting: number,
  startupMs: number,
  minimumSavingMs = 30_000,
): boolean {
  if (costs.length < 4 || ready + starting >= 3) return false;
  const schedule = (extra: boolean) => {
    const slots = [
      ...Array<number>(ready).fill(0),
      ...Array<number>(starting + Number(extra)).fill(startupMs),
    ];
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
    after.assigned >= 2 && before.finish - after.finish > Math.max(minimumSavingMs, startupMs * 0.2)
  );
}

export interface WorkExecutor<T, R> {
  run(item: T): Promise<R>;
  dispose(): Promise<void>;
}

/** One item per idle executor, no upfront partition. Acquisition and disposal belong to the caller's runtime. */
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
  let ready = 1,
    starting = 0,
    opened = 0;
  const extras: Promise<void>[] = [];
  let cleanupFailure: unknown;
  let failure: unknown;
  let admitting = true;
  const useful = () => !failure && !options.cancelled() && queue.length > 0;
  const run = async (executor: WorkExecutor<T, R>, auxiliary: boolean) => {
    try {
      while (useful()) {
        const item = queue.shift()!;
        let value: R;
        try {
          value = await executor.run(item);
        } catch (error) {
          if (!auxiliary) throw error;
          queue.unshift(item);
          options.warning(error);
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
        if (
          admitting &&
          options.canExpand() &&
          starting === 0 &&
          opened < 2 &&
          workerBenefit(queue.map(options.cost), ready, starting, options.startupMs())
        ) {
          opened++;
          starting++;
          extras.push(
            (async () => {
              let worker: WorkExecutor<T, R> | null = null;
              try {
                worker = await options.acquire(useful);
                starting--;
                if (worker) {
                  ready++;
                  await run(worker, true);
                }
              } catch (error) {
                if (!worker) starting--;
                options.warning(error);
              } finally {
                if (worker) {
                  ready--;
                  await worker.dispose();
                }
              }
            })().catch((error: unknown) => {
              cleanupFailure ??= error;
            }),
          );
        }
      }
    } finally {
      /* The primary's caller owns its lifetime. */
    }
  };
  try {
    await run(options.primary, false);
  } catch (error) {
    failure = error;
  }
  // New executors can be admitted by an executor already draining the queue.
  for (let i = 0; i < extras.length; i++) await extras[i];
  admitting = false;
  if (cleanupFailure) throw cleanupFailure;
  if (failure) throw failure;
  if (queue.length && !options.cancelled()) await run(options.primary, false);
}
