import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { addressSchema, historyPoseSchema } from "@pe/agent-contracts";
import { z } from "zod";
import { localHistory, type History } from "./history.ts";
import { RequestIdentity } from "../request-services.ts";
import { InvalidRead } from "../native-reads.ts";
import { httpProblems, isDoorFailure } from "../http-problems.ts";

const run = <A>(work: () => Promise<A>) =>
  Effect.tryPromise({
    try: work,
    catch: (error) =>
      isDoorFailure(error)
        ? error
        : new InvalidRead({ message: String(error), status: 409, problem: "history.unavailable" }),
  });
const local = Effect.flatMap(RequestIdentity, (identity) => run(async () => localHistory(identity.caller)));
/** Local History has the same request admission as the surrounding Pe doors. No write can name Value bindings. */
export const historyRoutes = (history?: History) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const owner = () => {
        if (!history)
          throw new InvalidRead({
            message: "History storage is unavailable",
            status: 409,
            problem: "history.unavailable",
          });
        return history;
      };
      yield* router.add("GET", "/pe/history", (request) =>
        Effect.andThen(local, run(async () => {
          const query = new URL(request.originalUrl, "http://host").searchParams;
          const id = query.get("at");
          if (id) {
            const point = await owner().get(z.uuid().parse(id));
            return { point, work: await owner().work(id) };
          }
          return owner().list(addressSchema.parse(query.get("document")));
        })).pipe(Effect.map(HttpServerResponse.jsonUnsafe)),
      );
      yield* router.add("POST", "/pe/history", (request) =>
        Effect.gen(function* () {
          yield* local;
          if (request.headers["x-pe-history-point"])
            return yield* new InvalidRead({
              message: "needs live Revit",
              status: 409,
              problem: "history.read-only",
            });
          const body = yield* request.json;
          return yield* run(async () => {
            const input = z
              .discriminatedUnion("kind", [
                z.object({ kind: z.literal("captured"), document: addressSchema }),
                z.object({
                  kind: z.literal("page"),
                  document: addressSchema,
                  pose: historyPoseSchema,
                }),
              ])
              .parse(body);
            if (input.kind === "page") {
              owner().pose(input.document, input.pose);
              return { ok: true };
            }
            return owner().capture(input.document);
          }).pipe(Effect.map(HttpServerResponse.jsonUnsafe));
        }),
      );
    }),
  ).pipe(Layer.provide(httpProblems));
