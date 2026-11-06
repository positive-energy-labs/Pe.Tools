import { fansReadArgs } from "@pe/agent-contracts";
import { callCompose, publicationSource } from "../shell/readings-api";

export const fansValueSource = () =>
  publicationSource({
    read(ctx, publication, release) {
      if (ctx.target.kind !== "document") return Promise.reject(Error("Choose a document"));
      return callCompose(ctx, "fans.sheet", {
        body: {
          ...publication,
          release,
          args: fansReadArgs.parse({ ...(ctx.args as object), target: ctx.target.ref }),
        },
      });
    },
  });
