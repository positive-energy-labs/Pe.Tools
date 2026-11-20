import { readingRequestSchema } from "@pe/agent-contracts";
import { ductsReadingSchema } from "@pe/ducts-contract/reading";

export const resourceReadingSchema = readingRequestSchema.or(ductsReadingSchema);
