import { Schema } from "effect";
import { nativeEffectSchemas, nativeEffectResponseDefinitions, Op52response, type NativeRequestWire, type NativeRequestValue, type NativeResponseValue } from "./native-effect.generated.ts";

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

const omitted: NativeRequestWire<"revit.resolve.family-instances"> = { familyId: 1, familyUniqueId: "family" };
const populated = Schema.decodeUnknownSync(nativeEffectSchemas["revit.resolve.family-instances"].request)(omitted);
const decoded: NativeRequestValue<"revit.resolve.family-instances"> = populated;
const defaulted: number = decoded.maxResults;
void defaulted;
// @ts-expect-error decoded defaults cannot remain absent
const missing: NativeRequestValue<"revit.resolve.family-instances"> = { familyId: 1, familyUniqueId: "family" };
void missing;
const response: NativeResponseValue<"revit.context.view-image"> = Schema.decodeUnknownSync(nativeEffectSchemas["revit.context.view-image"].response)({});
const disclosure = response.lens;
void disclosure;
for (const factory of [nativeEffectSchemas["revit.context.view-image"].delivery, nativeEffectSchemas["revit.context.view-image.focus"].delivery]) {
  const delivery = factory(Schema.Struct({ sha: Schema.String }));
  const value = Schema.decodeUnknownSync(delivery)({});
  const sha: string | undefined = value.capture?.sha;
  void sha;
  // @ts-expect-error delivered values cannot reveal a native file path
  value.filePath;
  // @ts-expect-error delivery never exposes encoding
  Schema.encodeSync(delivery);
  const composed = Schema.Struct({ optional: Schema.optionalKey(delivery), rows: Schema.Array(delivery) });
  // @ts-expect-error delivery composition never recovers encoding
  Schema.encodeSync(composed);
}
// @ts-expect-error private structural source is not public
Op52response.codec;
// @ts-expect-error structural decoded scope cannot escape through the public namespace
Op52response.Decoded;
