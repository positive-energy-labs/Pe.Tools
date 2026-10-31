import type { ReadingContext, ReadingDelivery, WorkerChannel, WorkerSource } from "./readings";

export interface ReadingWorkerRequest<I> {
  id: number;
  /** Versions, Work revision and algorithm version are part of this job's identity. */
  key: string;
  input: I;
}
export type ReadingWorkerResponse<T, D> = { id: number } & (
  | { result: T }
  | { delta: D }
  | { error: string }
);
export interface ReadingWorkerPort<I, T, D = never> {
  postMessage(request: ReadingWorkerRequest<I>): void;
  terminate(): void;
  onmessage: ((event: { data: ReadingWorkerResponse<T, D> }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
}

/** One running job plus one replaceable latest job; obsolete deltas still advance the decode base. */
export function workerSource<I, T, D = never>(options: {
  algorithmVersion: string;
  input(context: ReadingContext, previous?: ReadingContext): I;
  spawn(): ReadingWorkerPort<I, T, D>;
  applyDelta?(previous: T | undefined, delta: D): T;
}): WorkerSource<T> {
  return {
    kind: "worker",
    algorithmVersion: options.algorithmVersion,
    connect(): WorkerChannel<T> {
      const worker = options.spawn();
      type Job = { context: ReadingContext; deliver: ReadingDelivery<T> };
      let latest: Job | undefined;
      let running: (Job & { id: number }) | undefined;
      let sequence = 0;
      let decoded: T | undefined;
      let sentContext: ReadingContext | undefined;
      let stopped = false;
      const send = () => {
        if (stopped || running || !latest) return;
        const job = latest;
        latest = undefined;
        running = { ...job, id: ++sequence };
        const { context } = job;
        const inputs = Object.entries(context.inputs).map(([id, state]) => [id, state.version]);
        try {
          worker.postMessage({
            id: sequence,
            key: JSON.stringify([
              context.attempt,
              inputs,
              context.workRevision,
              options.algorithmVersion,
            ]),
            input: options.input(context, sentContext),
          });
          sentContext = context;
        } catch (error) {
          running = undefined;
          job.deliver({ kind: "failure", error });
          send();
        }
      };
      worker.onmessage = ({ data }) => {
        if (stopped || !running || running.id !== data.id) return;
        const job = running;
        running = undefined;
        try {
          if ("error" in data) job.deliver({ kind: "failure", error: data.error });
          else {
            if ("delta" in data) {
              if (!options.applyDelta) throw Error("Worker sent a delta without a decoder");
              decoded = options.applyDelta(decoded, data.delta);
            } else decoded = data.result;
            job.deliver({ kind: "complete", value: decoded, revision: data.id });
          }
        } catch (error) {
          job.deliver({ kind: "failure", error });
          latest?.deliver({ kind: "failure", error });
          stop();
        }
        send();
      };
      worker.onerror = (event) => {
        if (stopped) return;
        const jobs = [running, latest];
        running = undefined;
        latest = undefined;
        for (const job of jobs)
          job?.deliver({ kind: "failure", error: event.message || "Worker failed" });
        stop();
      };
      function stop() {
        if (stopped) return;
        stopped = true;
        latest = undefined;
        running = undefined;
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
      return {
        update(context, deliver) {
          if (stopped) {
            deliver({
              kind: "failure",
              error: "Worker stopped; explicitly refresh with a new channel",
            });
            return;
          }
          latest = { context, deliver };
          send();
        },
        stop,
      };
    },
  };
}
