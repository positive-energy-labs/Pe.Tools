import { useLiveOrbit } from "#/scene/live-orbit";
/**
 * The pane strip specimen (ledger 2026-10-21): one pane with two modes, two floaters (a plane
 * minimap over a stand-in 4000x3000 field, an orbit globe with a few painted segments) and three
 * layers. Every chord is the pane's (S, M, G, 1-3) and Help (Alt+/) lists them; no key card here.
 */
import { useCallback, useState } from "react";

import { Floater } from "#/components/lang/floater";
import { Pane } from "#/components/lang/pane";
import { PaneStrip } from "#/components/lang/pane-strip";
import {
  canvasColor,
  OrbitMinimap,
  PlaneMinimap,
  type OrbitViewport,
  type PlaneViewport,
  type ScrollViewport,
} from "#/components/lang/minimap";
import { tokenRef } from "@pe/kit/lib/token";

import { SpecimenFrame } from "./recipe-grid";

const EXTENT = { width: 4000, height: 3000 };
const WINDOW = { width: 800, height: 600 };

const ROOMS = [
  ["A", 500, 500, 1000, 500],
  ["B", 2000, 1000, 1500, 1000],
  ["C", 500, 2000, 500, 500],
] as const;

/** Stand-in rooms on a 500-unit grid, drawn per layer; a consumer paints its own field. */
const paintField = (ctx: CanvasRenderingContext2D, k: number, layers: readonly string[]) => {
  if (layers.includes("grid")) {
    ctx.strokeStyle = canvasColor(ctx, "line-2");
    for (let x = 0; x < EXTENT.width; x += 500)
      for (let y = 0; y < EXTENT.height; y += 500) ctx.strokeRect(x * k, y * k, 500 * k, 500 * k);
  }
  ctx.fillStyle = canvasColor(ctx, "ink-2");
  for (const [name, x, y, w, h] of ROOMS) {
    if (layers.includes("rooms")) ctx.fillRect(x * k, y * k, w * k, h * k);
    if (layers.includes("labels")) ctx.fillText(name, x * k, y * k - 2);
  }
};

/** Three stand-in duct runs in unit-sphere space (z up). */
const SEGMENTS: readonly (readonly (readonly number[])[])[] = [
  [
    [-0.6, -0.4, 0],
    [0.5, -0.4, 0],
    [0.5, 0.5, 0],
  ],
  [
    [0.5, -0.4, 0],
    [0.5, -0.4, 0.5],
  ],
  [
    [-0.6, -0.4, 0],
    [-0.6, 0.4, 0],
  ],
];

const paintSegments = (project: (p: readonly number[]) => [number, number]) =>
  SEGMENTS.map((line, i) => (
    <path
      key={i}
      d={line
        .map(
          (p, j) =>
            `${j ? "L" : "M"}${project(p)
              .map((v) => v.toFixed(1))
              .join(" ")}`,
        )
        .join("")}
      fill="none"
      stroke={tokenRef("ink-2")}
      strokeWidth={1.5}
    />
  ));

const MODES = [
  { key: "plane", label: "plane", says: "Pan and zoom the field; the minimap writes tx/ty." },
  {
    key: "scroll",
    label: "scroll",
    chord: "S" as const,
    says: "Scroll the field; the minimap writes top/left.",
  },
];
const unbound = <T extends { chord?: unknown }>(options: readonly T[]) =>
  options.map(({ chord: _, ...option }) => option);
const LAYERS = [
  { key: "grid", label: "grid", chord: "1" as const, says: "The 500-unit grid." },
  { key: "rooms", label: "rooms", chord: "2" as const, says: "The stand-in rooms." },
  { key: "labels", label: "labels", chord: "3" as const, says: "Room labels." },
];

/** The parts alone, as the pane draws them: the strip in a header's trail, a floater in a body corner. */
function PaneStripAnatomy() {
  const [mode, setMode] = useState("plane");
  const [open, setOpen] = useState(true);
  const corner = {
    key: "anatomy",
    label: "corner",
    place: "tl" as const,
    open,
    onOpenChange: setOpen,
    render: () => "a corner surface; Esc inside closes it",
  };
  return (
    <SpecimenFrame name="PaneStrip and Floater, alone" importPath="#/components/lang/floater">
      <div className="flex flex-wrap items-start gap-4">
        {/* No chords here: the pane above owns S, M, G and 1-3. */}
        <PaneStrip
          modes={{ value: mode, label: "viewport", options: unbound(MODES), onChange: setMode }}
          floaters={[corner]}
          layers={{ value: ["grid"], options: unbound(LAYERS), onToggle: () => {} }}
        />
        <div className="relative h-24 w-64" data-surface="recess">
          {open ? <Floater spec={corner} /> : null}
        </div>
      </div>
    </SpecimenFrame>
  );
}

/** The same strip at 400 px and full width: narrow, layers and floaters fold into popovers and the
 * mode labels shorten; the title stays. The corner floater gives way to the legend. */
function PaneStripWidths() {
  const [mode, setMode] = useState("plane");
  const [layers, setLayers] = useState<readonly string[]>(["grid", "rooms"]);
  const [open, setOpen] = useState(true);
  const strip = (id: string) => (
    <Pane
      id={id}
      title="supply air, level 2"
      flush
      scroll="clip"
      modes={{ value: mode, label: "viewport", options: unbound(MODES), onChange: setMode }}
      layers={{
        value: layers,
        options: unbound(LAYERS),
        onToggle: (key) =>
          setLayers((on) => (on.includes(key) ? on.filter((k) => k !== key) : [...on, key])),
      }}
      floaters={[
        {
          key: "corner",
          label: "corner",
          says: "A stand-in corner surface; it moves off the legend when the pane is narrow.",
          place: "br",
          size: { width: 160, height: 72 },
          open,
          onOpenChange: setOpen,
          render: () => "corner",
        },
        {
          key: "globe",
          label: "globe",
          place: "tr",
          open: false,
          onOpenChange: () => {},
          render: () => null,
        },
      ]}
    >
      <div className="relative size-full">
        <span
          data-slot="pane-legend"
          className="absolute bottom-2 left-2 whitespace-nowrap t-small text-ink-2"
        >
          stand-in legend, wide enough to meet the corner at 400 px
        </span>
      </div>
    </Pane>
  );
  return (
    <SpecimenFrame name="Pane strip, narrow and wide" importPath="#/components/lang/pane-strip">
      <div className="flex flex-col gap-4">
        <div className="h-48 w-[400px]" data-strip-width="narrow">
          {strip("pane-strip-narrow")}
        </div>
        <div className="h-48 w-full" data-strip-width="wide">
          {strip("pane-strip-wide")}
        </div>
      </div>
    </SpecimenFrame>
  );
}

export function PaneStripSpecimen() {
  const [mode, setMode] = useState("plane");
  const [plane, setPlane] = useState<PlaneViewport>({ kind: "plane", scale: 1, tx: 0, ty: 0 });
  const [scroll, setScroll] = useState<ScrollViewport>({ kind: "scroll", top: 0, left: 0 });
  const [orbit, setOrbit] = useState<OrbitViewport>({
    kind: "orbit",
    yaw: 30,
    elev: 30,
    zoom: 1,
    pivot: [0, 0, 0],
  });
  const camera = useLiveOrbit(orbit, setOrbit, "specimen");
  const [mapOpen, setMapOpen] = useState(true);
  const [globeOpen, setGlobeOpen] = useState(false);
  const [layers, setLayers] = useState<readonly string[]>(["grid", "rooms"]);
  const viewport = mode === "plane" ? plane : scroll;
  // A new paint identity per layer set: the thumbnail repaints only when a layer turns.
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, k: number) => paintField(ctx, k, layers),
    [layers],
  );
  return (
    <>
      <SpecimenFrame name="Pane strip, Floater, Minimap" importPath="#/components/lang/pane-strip">
        <div className="h-96 w-full max-w-3xl">
          <Pane
            id="pane-strip-specimen"
            title="field"
            modes={{ value: mode, label: "viewport", options: MODES, onChange: setMode }}
            layers={{
              value: layers,
              options: LAYERS,
              onToggle: (key) =>
                setLayers((on) => (on.includes(key) ? on.filter((k) => k !== key) : [...on, key])),
            }}
            floaters={[
              {
                key: "minimap",
                label: "minimap",
                chord: "M",
                says: "The whole field with the view drawn on it; a click moves the view.",
                place: "br",
                open: mapOpen,
                onOpenChange: setMapOpen,
                render: () => (
                  <PlaneMinimap
                    viewport={viewport}
                    onViewport={(next) =>
                      next.kind === "plane" ? setPlane(next) : setScroll(next)
                    }
                    extent={EXTENT}
                    viewportSize={WINDOW}
                    paint={paint}
                  />
                ),
              },
              {
                key: "globe",
                label: "globe",
                chord: "G",
                says: "The orbit camera; a stop click turns the view to it.",
                place: "tr",
                open: globeOpen,
                onOpenChange: setGlobeOpen,
                render: () => <OrbitMinimap orbit={camera} paint={paintSegments} />,
              },
            ]}
          >
            {/* Stand-in: the consumer's canvas draws here; this reads back what the floaters wrote. */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 face-mono t-small">
              <dt className="text-ink-mute">viewport</dt>
              <dd>
                {viewport.kind === "plane"
                  ? `plane scale ${viewport.scale} tx ${Math.round(viewport.tx)} ty ${Math.round(viewport.ty)}`
                  : `scroll top ${Math.round(viewport.top)} left ${Math.round(viewport.left)}`}
              </dd>
              <dt className="text-ink-mute">orbit</dt>
              <dd>
                yaw {Math.round(orbit.yaw)}° elev {Math.round(orbit.elev)}°
              </dd>
              <dt className="text-ink-mute">layers</dt>
              <dd>{layers.length ? layers.join(", ") : "none on"}</dd>
            </dl>
          </Pane>
        </div>
      </SpecimenFrame>
      <PaneStripWidths />
      <PaneStripAnatomy />
    </>
  );
}
