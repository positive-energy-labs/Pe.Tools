/**
 * proto: encoding — the one picker for what the drawing's lines say, under the globe beside the run
 * lens. A kit `ListPopup` on a control face: the face names the reading, the list says what each
 * one draws (its scale kind beside it, its sentence under the cursor row). The key rides
 * `page.encoding`, so the URL carries it.
 */
import { ListPopup } from "@pe/kit/lang/list-popup";

import { encodingFor, ENCODING_KEYS, type EncodingKey, type ScaleKind } from "../../encoding";

const KIND_WORD: Record<ScaleKind, string> = {
  plain: "plain ink",
  categorical: "categories",
  sequential: "one-hue ramp",
  weight: "line weight",
  flow: "arrows",
};

interface Option {
  key: EncodingKey;
  label: string;
  says: string;
  kind: ScaleKind;
}

export function EncodingPicker({
  value,
  onPick,
}: {
  value: string;
  onPick: (key: EncodingKey) => void;
}) {
  const options: Option[] = ENCODING_KEYS.map((key) => {
    const { label, says, kind } = encodingFor(key);
    return { key, label, says, kind };
  });
  const current = options.find((o) => o.key === value) ?? options.find((o) => o.key === "health")!;
  return (
    <ListPopup<Option>
      anchor="trigger"
      face="control"
      trigger={
        <span data-encoding-picker={current.key} className="whitespace-nowrap">
          <span className="text-ink-2">lines:</span> {current.label}
        </span>
      }
      triggerLabel={`lines show ${current.label}`}
      // No `title`: the kit's TooltipHint renders the trigger with className="" and drops the
      // control face (owed to the kit). The list's detail line says each reading instead.
      aria-label="what the lines show"
      items={options}
      keyOf={(o) => o.key}
      labelOf={(o) => o.label}
      select="single"
      selected={[current.key]}
      onPick={(o) => onPick(o.key)}
      empty="no reading"
      detail={(o) => o.says}
      row={(o) => ({
        label: o.label,
        aside: <span className="text-ink-2">{KIND_WORD[o.kind]}</span>,
        title: o.says,
      })}
    />
  );
}
