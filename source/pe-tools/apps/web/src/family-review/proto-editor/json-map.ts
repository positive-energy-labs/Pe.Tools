/**
 * PROTOTYPE (round 3) — the json pane's other half: JSON Pointer ↔ character range.
 *
 * The composed page paints a structured field's json range and, in the other direction, names the
 * structured row the caret is sitting in. Both need one fact the runtime does not give you: where
 * in the serialized text each pointer lives.
 *
 * SO WE SERIALIZE IT OURSELVES. `jsonWithSpans` emits byte-for-byte what `JSON.stringify(v, null,
 * 2)` emits — the test pins that equality — while recording, for every property and array item,
 * the range from the opening quote of its key through the end of its value. Correct beats clever:
 * no regex over the text, no parser, no source map to drift. If the two ever disagree the test
 * fails rather than the highlight quietly landing on the wrong line.
 *
 * ponytail: pointers are NOT RFC-6901-escaped, here or in `shell.tsx`'s `flatten` — the two must
 * agree or the pending-write diff cannot address the json, and unescaped reads better in the diff.
 * A key containing `/` or `~` would collide. Revit parameter names can contain `/`
 * ("Center (Front/Back)" is a plane name), so escape BOTH sides before this ships.
 */

export interface JsonSpan {
  /** JSON Pointer, unescaped — same dialect as `shell.tsx`'s `flatten`. */
  pointer: string;
  /** Character offsets into the emitted text: `"key": value` for a property, the value alone
   *  for an array item or the root. */
  start: number;
  end: number;
}

export interface JsonMap {
  text: string;
  spans: JsonSpan[];
  byPointer: Map<string, JsonSpan>;
}

const pad = (depth: number) => "  ".repeat(depth);

export function jsonWithSpans(root: unknown): JsonMap {
  let text = "";
  const spans: JsonSpan[] = [];

  const emit = (value: unknown, pointer: string, depth: number): void => {
    if (value === null || typeof value !== "object") {
      text += typeof value === "string" ? JSON.stringify(value) : String(value);
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        text += "[]";
        return;
      }
      text += "[\n";
      value.forEach((item, index) => {
        text += pad(depth + 1);
        const start = text.length;
        emit(item, `${pointer}/${index}`, depth + 1);
        spans.push({ pointer: `${pointer}/${index}`, start, end: text.length });
        text += index === value.length - 1 ? "\n" : ",\n";
      });
      text += `${pad(depth)}]`;
      return;
    }
    // `JSON.stringify` drops undefined-valued keys; so must we, or every offset after one shifts.
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, item]) => item !== undefined,
    );
    if (entries.length === 0) {
      text += "{}";
      return;
    }
    text += "{\n";
    entries.forEach(([key, item], index) => {
      text += pad(depth + 1);
      const start = text.length;
      const child = `${pointer}/${key}`;
      text += `${JSON.stringify(key)}: `;
      emit(item, child, depth + 1);
      spans.push({ pointer: child, start, end: text.length });
      text += index === entries.length - 1 ? "\n" : ",\n";
    });
    text += `${pad(depth)}}`;
  };

  emit(root, "", 0);
  spans.push({ pointer: "", start: 0, end: text.length });
  return { text, spans, byPointer: new Map(spans.map((span) => [span.pointer, span])) };
}

/** The DEEPEST pointer whose range contains this offset — the row that owns the caret. */
export function pointerAtOffset(map: JsonMap, offset: number): string | null {
  let best: JsonSpan | null = null;
  for (const span of map.spans) {
    if (offset < span.start || offset > span.end) continue;
    if (best == null || span.end - span.start < best.end - best.start) best = span;
  }
  return best == null || best.pointer === "" ? null : best.pointer;
}

/** 1-based inclusive line range of a span — `HighlightLineDecoration` speaks lines. */
export function lineSpan(map: JsonMap, span: JsonSpan): [number, number] {
  const before = map.text.slice(0, span.start);
  const first = before.split("\n").length;
  const inner = map.text.slice(span.start, span.end).split("\n").length - 1;
  return [first, first + inner];
}

/**
 * The nearest pointer that a structured surface actually owns a row for.
 *
 * The caret inside `/solids/body/width` should light the `body` sentence, not vanish because no
 * row is keyed on the field. Walk up until the pointer is one of the owners the caller knows.
 */
export function ownerOf(pointer: string | null, owners: ReadonlySet<string>): string | null {
  let at = pointer;
  while (at != null && at !== "") {
    if (owners.has(at)) return at;
    const cut = at.lastIndexOf("/");
    at = cut <= 0 ? "" : at.slice(0, cut);
  }
  return null;
}
