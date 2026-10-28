import { listSearchKey, listSearchCodec } from "../list-search.ts";
import { z } from "zod";
import { orbitLooks, viewportCodec, type OrbitLook } from "../page-keys.ts";
import { pictureFields } from "./picture.ts";
import { DUCTS_FINDS } from "../ducts.ts";
import { field, setKeys, text, type RouteDeclaration } from "../route-field.ts";

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
);

const ductsFields = {
  contextRadiusFt: picture.contextRadiusFt,
  sceneView: picture.sceneView,
  /**
   * The subject: the open Revit system names, oldest first, each read across every group it is in;
   * the last is the active one the write, heal and fan verbs act on. Empty = the whole document.
   */
  system: field(z.array(z.string().max(200)).default([]), { url: "push", agent: "set" }),
  /** A level id; empty = every level. */
  level: field(text(), { url: "push", agent: "set" }),
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
  issue: picture.issue,
};

type DuctsFacts = {
  systems?: { name: string }[];
  levels?: { id: string; name: string }[];
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
  const { systems = [], levels = [], pose } = facts as DuctsFacts;
  const keys = [...setKeys(ductsFields), ...Object.keys(ductsWords.shape)];
  const stray = Object.keys(patch).filter((key) => !keys.includes(key));
  if (stray.length)
    return {
      ok: false as const,
      error: `the Ducts page takes ${keys.join(", ")}, not ${stray.join(", ")}; name the system`,
    };
  if (patch.system?.trim()) {
    const named: string[] = [];
    for (const said of patch.system
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean)) {
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
    patch.system = named.join(",");
  }
  if (patch.level && !levels.some((level) => level.id === patch.level))
    return { ok: false as const, error: `unknown level '${patch.level}'` };
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
    : { ok: false as const, error: "name a system, level, selected element, look or viewport" };
}

export const ductsAddress = {
  path: "/ducts",
  title: "Ducts",
  fields: ductsFields,
  agent: {
    finds: [...DUCTS_FINDS, "system", "level"],
    policy:
      "Move the Ducts page in the person's open browser. Its subject: system (the Revit system names the person named, comma separated, such as SA 19 or SA 19,RA 1, as the person said them; each resolves against the view's system names; the last is the active one the write, heal and fan verbs act on, and the page keeps only its newest few, closing the oldest), level and selected element id; an empty string clears the key. The page shows every duct network each system is in, with its owned elements and shared fan-to-terminal paths; unopened branches at equipment, plenums and shared ducts show as short stubs. Set only the systems the person named, and never add one they did not name. Its picture: encoding, layers (comma separated: meshes, system-colours, stub-labels, halo, context, centrelines, no-run, labels, findings; system-colours tints each element by its own system; stub-labels names each stub; halo shows nearby context; context shows all captured context and wins when both are on; meshes, system-colours, stub-labels, halo, no-run, labels and findings are on by default; no-run highlights branches on no fan-to-terminal run; empty = none), picture (model or schematic), and either look (plan, iso, north, south, east or west: the shown picture turned about its pivot) or viewport (orbit:projection:yaw,elev,zoom@x,y,z (projection is perspective or parallel) in feet; empty fits the subject). issue selects one finding by id. Each set is one step the person can go Back from. No Work or Revit read.",
    words: ductsWords,
    resolve: resolveDucts,
  },
} satisfies RouteDeclaration;
