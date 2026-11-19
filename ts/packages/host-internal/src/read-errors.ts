import { Schema } from "effect";

const fields = { message: Schema.String, status: Schema.Number, problem: Schema.String };
export class ReadBusy extends Schema.TaggedError<ReadBusy>()("ReadBusy", fields) {}
export class ReadRetiring extends Schema.TaggedError<ReadRetiring>()("ReadRetiring", fields) {}
export class InvalidRead extends Schema.TaggedError<InvalidRead>()("InvalidRequest", fields) {}
