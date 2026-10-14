import { z } from "zod";

/** Host-minted product identities. Anonymous transport is not a principal. */
export const principalSchema = z.enum(["human", "pea", "page", "external-mcp", "service"]);
export type Principal = z.infer<typeof principalSchema>;
