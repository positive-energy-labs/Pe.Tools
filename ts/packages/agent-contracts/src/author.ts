import { z } from "zod";

/** Caller identity stamped by the host, separate from a caller-cited evidence ref. */
export const authorSchema = z.enum(["human", "pea"]);
export type Author = z.infer<typeof authorSchema>;
