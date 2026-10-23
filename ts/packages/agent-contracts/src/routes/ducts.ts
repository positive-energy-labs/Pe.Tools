import { z } from "zod";
import {
  fitViewportCodec,
  layersKey,
  modeKey,
  orbitLooks,
  subjectKey,
  viewportCodec,
  viewportKey,
  viewportSchema,
  type OrbitLook,
  type Viewport,
} from "../page-keys.ts";
import { DUCTS_FINDS } from "../ducts.ts";
import { field, setKeys, text, type RouteDeclaration } from "../route-field.ts";

/** The layer keys the Ducts spatial picture draws. */
export const DUCTS_LAYERS = ["meshes", "context", "centrelines", "labels", "findings"] as const;

const ductsFields = {
  /** The subject: a Revit system name, read across every group it is in; empty = the whole document. */
  system: field(subjectKey(), { url: "push", agent: "set" }),
  /** A level id; empty = every level. */
  level: field(text(), { url: "push", agent: "set" }),
  /** The selected element id; empty = none. */
  selected: field(text(), { url: "push", agent: "set" }),
  /** The picture's encoding, a key of the web's `ENCODINGS`. */
  encoding: field(z.string().max(200).default("health"), { url: "push", agent: "set" }),
  /** The layer keys the picture draws; empty = none. */
  layers: field(layersKey(DUCTS_LAYERS, ["meshes", "labels", "findings"]), {
    url: "push",
    agent: "set",
  }),
  /** What the picture pane draws: the `model` in space, or the `schematic` one-line. */
  picture: field(modeKey(["model", "schematic"], "model"), { url: "push", agent: "set" }),
  /** Where the model picture looks from; null = fit the subject. A drag replaces, a preset pushes. */
  viewport: field(
    viewportKey(viewportSchema),
    { url: "replace", agent: "set" },
    fitViewportCodec<Viewport>(),
  ),
  /**
   * The selected inbox row: an issue id (it may name no element), or `<segment>:<cell key>` for a
   * Work cell; empty = none. Exception to "Pea's, never the URL's": the chat head's review link is
   * an address (`LinkPage` carries URL keys only) and must land on a cell's row. `replace`, so a
   * row pick never fills history; the issue-id half still resets whenever the selection moves.
   */
  issue: field(text(), { url: "replace", agent: "set" }),
  /** The Diagnostics kind picked in its key; empty = none. Pea reads it; only the person sets it. */
  diagnostic: field(text(), { agent: "read" }),
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
 * `system` is the page's subject, a Revit system name: the person's word resolves to the one
 * system the lease's facts name exactly (any case), else the one whose name holds it. A system
 * spans every duct network it is in; the page shows them all.
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
    const word = patch.system.trim().toLowerCase();
    const exact = systems.filter((system) => system.name.toLowerCase() === word);
    const near = systems.filter((system) => system.name.toLowerCase().includes(word));
    const found = exact.length ? exact : near;
    if (found.length !== 1)
      return {
        ok: false as const,
        error: found.length
          ? `'${patch.system}' names ${found.length} systems (${found
              .slice(0, 12)
              .map((system) => system.name)
              .join(", ")}); name one`
          : `no system named '${patch.system}' on this page; read route:ducts.view for the system names`,
      };
    patch.system = found[0]!.name;
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
          "the Ducts picture has published no orbit pose, so a look has no pivot to turn about; set viewport as orbit:yaw,elev,zoom@x,y,z, or empty to fit",
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
      "Move the Ducts page in the person's open browser. Its subject: system (a Revit system name such as SA 19, as the person said it; it resolves against the view's system names), level and selected element id; an empty string clears the key. The page shows every duct network the system is in. Set the system only when the person named it, and never pick a system they did not name. Its picture: encoding, layers (comma separated: meshes, context, centrelines, labels, findings; empty = none), picture (model or schematic), and either look (plan, iso, north, south, east or west: the shown picture turned about its pivot) or viewport (orbit:yaw,elev,zoom@x,y,z in feet; empty fits the subject). issue selects one finding by id. Each set is one step the person can go Back from. No Work or Revit read.",
    words: ductsWords,
    resolve: resolveDucts,
  },
} satisfies RouteDeclaration;
