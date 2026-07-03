import { Schema } from "effect";
import { hostErrorKindSchema } from "./contracts/index.js";

export class HostRpcError extends Schema.ErrorClass<HostRpcError>("HostRpcError")({
  _tag: Schema.tag("HostRpcError"),
  key: Schema.String,
  kind: hostErrorKindSchema,
  message: Schema.String,
  status: Schema.Number,
}) {}
