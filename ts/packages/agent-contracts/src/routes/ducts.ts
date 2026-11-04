import { listSearchKey, listSearchCodec } from "../list-search.ts";
import { z } from "zod";
import { orbitLooks, viewportCodec, type OrbitLook } from "../page-keys.ts";
import { pictureFields } from "./picture.ts";
import { DUCTS_FINDS } from "../ducts.ts";
import {
  field,
  manyField,
  manyCodec,
  setKeys,
  type RouteDeclaration,
} from "../route-field.ts";

/** The layer keys the Ducts spatial picture draws. */
export const DUCTS_LAYERS = [
  "meshes",
  "system-colours",
  "stub-labels",
  "halo",
  "context",
  "centrelines",
  "no-run",
  "labels",
  "findings",
] as const;

/** The picture's keys; the default encoding is this view's choice. */
const picture = pictureFields(
  DUCTS_LAYERS,
  ["meshes", "system-colours", "stub-labels", "halo", "no-run", "labels", "findings"],
  "health",
  "schematic",
);

const ductsFields = {
  /** The body under the Situation: the network picture (`network`) or the fan sheet (`sheet`). A view; it runs no verb. */
  stage: field(z.enum(["network", "sheet"]).default("network"), { url: "push", agent: "set" }),
  /** The fan route subjects, stable fan mark plus port index; empty closes them. */
  fan: manyField("UniqueId", { url: "push", agent: "set" }),
  contextRadiusFt: picture.contextRadiusFt,
  sceneView: picture.sceneView,
  /**
   * The subject: the open Revit system names, oldest first, each read across every group it is in;
   * the last is the active one the write, heal and fan verbs act on. Empty = no picked systems; all resolves the current roster.
   */
  system: manyField("system-name", { url: "push", agent: "set" }),
  selected: picture.selected,
  systemSearch: field(
    listSearchKey().describe(
      "JSON {v:1,keywords:string,pills:[{field,op:'=',value}]}. Literal AND keywords and equality pills: airType (SupplyAir, ReturnAir, ExhaustAir), status (priced, unpriced), needsFix (yes, no). Needs a fix means at least one scoped Fix row holds the price.",
    ),
    { url: "replace", agent: "set" },
    listSearchCodec,
  ),
  systemSort: field(z.enum(["", "name", "loss"]).default(""), { url: "replace", agent: "set" }),
  rulingSearch: field(
    listSearchKey().describe(
      "JSON {v:1,keywords:string,pills:[{field,op:'=',value}]}. Literal AND keywords and equality pills: kind, section, status, change (clean, proposed, staged).",
    ),
    { url: "replace", agent: "set" },
    listSearchCodec,
  ),
  rulingSort: field(z.enum(["", "name", "status"]).default(""), { url: "replace", agent: "set" }),
  treeSearch: field(
    listSearchKey().describe(
      "JSON {v:1,keywords:string,pills:[{field,op:'=',value}]}. Literal AND keywords and equality pills: kind (system, run, leg, element). Element IDs match exactly; ancestors provide context.",
    ),
    { url: "replace", agent: "set" },
    listSearchCodec,
  ),
  treeSort: field(z.enum(["", "name"]).default(""), { url: "replace", agent: "set" }),
  inputSearch: field(
    listSearchKey().describe(
      "JSON {v:1,keywords:string,pills:[{field,op:'=',value}]}. Literal AND keywords and equality pills: kind. Element IDs match exactly.",
    ),
    { url: "replace", agent: "set" },
    listSearchCodec,
  ),
  inputSort: field(z.enum(["", "name"]).default(""), { url: "replace", agent: "set" }),
  encoding: picture.encoding,
  layers: picture.layers,
  contextStyle: picture.contextStyle,
  picture: picture.picture,
  viewport: picture.viewport,
};

type DuctsFacts = {
  systems?: { name: string }[];
  /** The orbit pose the picture shows, fitted or not, as `viewportCodec` writes it. */
  pose?: string;
};

const ductsWords = z.object({
  /** A direction the person names: plan, iso, north, south, east or west. */
  look: z.string().max(40),
});

/**
 * `system` is the page's subject, the Revit system names the person named, comma separated: each
 * word resolves to the one system the lease's facts name exactly (any case), else the one whose
 * name holds it. A system spans every duct network it is in; the page shows them all.
 */
function resolveDucts(input: Record<string, unknown>, facts: Record<string, unknown>) {
  const patch = { ...input } as Record<string, string>;
  const { systems = [], pose } = facts as DuctsFacts;
  const keys = [...setKeys(ductsFields), ...Object.keys(ductsWords.shape)];
  const stray = Object.keys(patch).filter((key) => !keys.includes(key));
  if (stray.length)
    return {
      ok: false as const,
      error: `the Ducts page takes ${keys.join(", ")}, not ${stray.join(", ")}; name the system`,
    };
  if (patch.system?.trim() && patch.system !== "all") {
    const decoded = manyCodec.decode(patch.system);
    if (!Array.isArray(decoded)) return { ok: false as const, error: "Invalid system names" };
    const named: string[] = [];
    for (const said of decoded.map((word) => word.trim()).filter(Boolean)) {
      const word = said.toLowerCase();
      const exact = systems.filter((system) => system.name.toLowerCase() === word);
      const near = systems.filter((system) => system.name.toLowerCase().includes(word));
      const found = exact.length ? exact : near;
      if (found.length !== 1)
        return {
          ok: false as const,
          error: found.length
            ? `'${said}' names ${found.length} systems (${found
                .slice(0, 12)
                .map((system) => system.name)
                .join(", ")}); name one`
            : `no system named '${said}' on this page; read route:ducts.view for the system names`,
        };
      if (!named.includes(found[0]!.name)) named.push(found[0]!.name);
    }
    patch.system = manyCodec.encode(named);
  }
  if (patch.layers) {
    const known: readonly string[] = DUCTS_LAYERS;
    const unknown = patch.layers.split(",").filter((name) => !known.includes(name.trim()));
    if (unknown.length)
      return {
        ok: false as const,
        error: `unknown layers ${unknown.join(", ")}; the picture draws ${known.join(", ")}`,
      };
  }
  if (patch.look !== undefined) {
    const word = patch.look.trim().toLowerCase();
    const look = Object.hasOwn(orbitLooks, word) ? orbitLooks[word as OrbitLook] : null;
    if (!look)
      return {
        ok: false as const,
        error: `no look '${patch.look}'; say ${Object.keys(orbitLooks).join(", ")}`,
      };
    if ("viewport" in patch)
      return { ok: false as const, error: "name a look or a viewport, not both" };
    // A look turns the shown pose about its pivot; a fit has no pivot until the drawing publishes one.
    const shown = pose ? viewportCodec.decode(pose) : null;
    if (shown?.kind !== "orbit")
      return {
        ok: false as const,
        error:
          "the Ducts picture has published no orbit pose, so a look has no pivot to turn about; set viewport as orbit:projection:yaw,elev,zoom@x,y,z (projection is perspective or parallel), or empty to fit",
      };
    delete patch.look;
    patch.viewport = viewportCodec.encode({ ...shown, ...look });
  }
  return Object.keys(patch).length
    ? { ok: true as const, patch }
    : { ok: false as const, error: "name a system, selected element, look or viewport" };
}

export const ductsAddress = {
  path: "/ducts",
  title: "Ducts",
  fields: ductsFields,
  agent: {
    finds: [...DUCTS_FINDS, "system"],
    policy:
      "Move the systems subject on /ducts. Set system to the named system keys or all for the current roster. Every picked system stays picked. selected is the single element or finding selection. Fan paths live on /fans, keyed by fan mark plus @portIndex. Page changes do not run verbs or write Work. Geometry and inputs follow the authored subjects.",
    words: ductsWords,
    resolve: resolveDucts,
  },
} satisfies RouteDeclaration;
