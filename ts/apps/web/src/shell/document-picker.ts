import { createElement } from "react";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { inventoryOf, previousOf, useInventory } from "../host/resource-state";
import type { AdmittedAddressPort } from "./typed-address";
import type { PlaceInput } from "./typed-place";

/** A choice pins this Place to an exact open lifetime; it never changes the chat's targets. */
export function DocumentPicker({
  place,
  target,
  needs,
  enabled,
}: {
  place: { address: AdmittedAddressPort };
  target: PlaceInput["target"];
  needs: string;
  enabled: boolean;
}) {
  const inventory = useInventory(enabled);
  if (!enabled) return null;
  const options = inventoryOf(previousOf(inventory)?.sessions ?? []).flatMap((session) =>
    (session.openDocuments ?? [])
      .filter(
        (doc) =>
          (needs !== "project" && needs !== "family") ||
          doc.isFamilyDocument === (needs === "family"),
      )
      .map((doc) => ({
        ref: { session: session.sessionId, openId: doc.openId },
        label: doc.title,
        session:
          session.sdkSessionId ??
          `Revit${session.processId === null ? "" : ` - pid ${session.processId}`}`,
      })),
  );
  const key = (ref: { session: string; openId: string }) => JSON.stringify(ref);
  const selected = target?.kind === "document" ? key(target.ref) : null;
  return createElement(ListPopup<(typeof options)[number]>, {
    anchor: "trigger",
    face: "control",
    triggerLabel: "Choose a document",
    trigger: options.find((option) => key(option.ref) === selected)?.label ?? "Choose a document",
    "aria-label": "Document",
    items: options,
    keyOf: (option) => key(option.ref),
    labelOf: (option) => option.label,
    filter: "substring",
    select: "single",
    selected: selected ? [selected] : [],
    empty: inventory.state === "loading" ? "Reading documents..." : "No open documents available",
    row: (option) => ({ label: option.label, sub: option.session }),
    onPick: (option) => {
      const search = place.address.read();
      search.set("target", JSON.stringify({ kind: "open", ref: option.ref }));
      place.address.write(search, "push");
    },
  });
}
