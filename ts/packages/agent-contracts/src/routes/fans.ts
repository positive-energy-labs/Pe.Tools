import { ductsAddress } from "./ducts.ts";
import { field } from "../route-field.ts";
import { z } from "zod";
export const fansAddress = {
  ...ductsAddress,
  path: "/fans" as const,
  title: "Fans",
  fields: {
    ...ductsAddress.fields,
    stage: field(z.enum(["sheet"]).default("sheet"), { url: "push", agent: "set" }),
  },
  agent: {
    policy:
      "Pick fan marks with port indices through fan, a list or all. Each fan retains its own total.",
  },
};
