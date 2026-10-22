import { z } from "zod";
import { field, type RouteAddress } from "../route-field.ts";

export const capturesAddress = {
  path: "/captures",
  title: "Captures",
  fields: { sha: field(z.string().max(64).optional(), { url: "push" }) },
} satisfies RouteAddress;
