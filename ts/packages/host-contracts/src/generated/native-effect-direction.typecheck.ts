import { Schema } from "effect";
import { nativeEffectSchemas, nativeEffectResponseDefinitions } from "./native-effect.generated.ts";

const leaf = nativeEffectSchemas["revit.apply.parameter-values"].response;
const nested = Schema.Struct({ optional: Schema.optionalKey(leaf), rows: Schema.Array(leaf) });
Schema.decodeUnknownSync(nested)({ rows: [] });
// Decoder is an explicit public restriction, including under optional and array.
// @ts-expect-error Decoder has no encoding contract.
Schema.encodeSync(leaf);
// @ts-expect-error Composition must not recover an encoding contract.
Schema.encodeSync(nested);

const mark = nativeEffectResponseDefinitions["revit.context.view-image"].RevitViewImageMark;
const markValue = Schema.decodeUnknownSync(mark)({ elementId: 1, left: 0, top: 0, width: 1, height: 1 });
const inferredId: number = markValue.elementId;
void inferredId;
// @ts-expect-error Source definition keys are generated, not caller-chosen strings.
nativeEffectResponseDefinitions["revit.context.view-image"].MissingDefinition;
// @ts-expect-error A generated definition has no public encoding contract.
Schema.encodeSync(mark);
const marks = Schema.Struct({ optional: Schema.optionalKey(mark), rows: Schema.Array(mark) });
// @ts-expect-error Definition composition must not recover an encoding contract.
Schema.encodeSync(marks);
