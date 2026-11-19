import { Schema } from "effect";
import type { Refusal } from "@pe/agent-contracts";

export class Refused extends Schema.TaggedError<Refused>()("Refused", {
  message: Schema.String,
  status: Schema.Number,
  problem: Schema.String,
  refusal: Schema.declare<Refusal>(
    (value): value is Refusal =>
      typeof value === "object" && value !== null && "code" in value && "reason" in value,
  ),
}) {
  constructor(refusal: Refusal) {
    super({
      message: `${refusal.code}: ${refusal.reason}`,
      status: 403,
      problem: refusal.code,
      refusal,
    });
  }
}
