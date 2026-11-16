import { Schema } from "effect";
import { nativeEffectSchemas } from "./native-effect.generated.ts";

const leaf = nativeEffectSchemas["revit.apply.parameter-values"].response;
const nested = Schema.Struct({ optional: Schema.optionalKey(leaf), rows: Schema.Array(leaf) });
Schema.decodeUnknownSync(nested)({ rows: [] });
// Decoder is an explicit public restriction, including under optional and array.
// @ts-expect-error Decoder has no encoding contract.
Schema.encodeSync(leaf);
// @ts-expect-error Composition must not recover an encoding contract.
Schema.encodeSync(nested);
