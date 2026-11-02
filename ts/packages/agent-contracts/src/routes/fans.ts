import { ductsAddress } from "./ducts.ts";
import { field, manyCodec } from "../route-field.ts";
import { INVALID } from "../page-keys.ts";
import { z } from "zod";
export const fansAddress = {
  ...ductsAddress,
  path: "/fans" as const,
  title: "Fans",
  fields: {
    ...ductsAddress.fields,
    fan: {
      ...ductsAddress.fields.fan,
      schema: z.union([z.array(z.string().min(1)).max(32), z.literal("all")]).default([]),
      codec: {
        encode: manyCodec.encode,
        decode: (text: string) => {
          const value = manyCodec.decode(text);
          return Array.isArray(value) && value.length > 32 ? INVALID : value;
        },
      },
    },
    stage: field(z.enum(["sheet"]).default("sheet"), { url: "push", agent: "set" }),
  },
  agent: {
    policy:
      "Pick stable UniqueId@port keys from the fan roster through fan, a list or all. Each fan retains its own total.",
  },
};
