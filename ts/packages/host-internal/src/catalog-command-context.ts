import { AsyncLocalStorage } from "node:async_hooks";
import { Context, Fiber } from "effect";
// Private host provenance. Public payloads and headers never populate this scope.
/** The command an owned attempt's fiber runs for; the dispatcher reads it synchronously. */
export const CatalogCommand = Context.Reference<string | undefined>("pe/CatalogCommand", {
  defaultValue: () => undefined,
});
const promiseScope = new AsyncLocalStorage<string>();
// ADR 0029 rule 2 retires the ALS crossing; `definition` and `bind` are still Promise code, so
// their bridge reads keep it. A running fiber's reference wins: `run` is an Effect (rule 10).
export const catalogCommandContext = {
  run: <A>(key: string, work: () => A): A => promiseScope.run(key, work),
  getStore: (): string | undefined =>
    Fiber.getCurrent()?.getRef(CatalogCommand) ?? promiseScope.getStore(),
};
