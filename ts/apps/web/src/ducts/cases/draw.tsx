import { useId } from "react";

type Point2 = [number, number];
type Point3 = [number, number, number];
type Axis = "x" | "y" | "z";
type Kind = keyof typeof K;
interface BoxOptions {
  op?: number;
  ghost?: boolean;
}
interface LineOptions {
  w?: number;
  dash?: boolean;
  arrow?: boolean;
}
interface TextOptions {
  size?: number;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  bold?: boolean;
}
interface Drawing {
  body: string;
  tx: number;
  ty: number;
}

// Green: real Revit connection; dashed red: inferred join; orange: open end;
// blue: air flow; purple F: fan; grey: passive unit; red X: refused join.
const INK = "#37474f",
  GREEN = "#2a8a3c",
  RED = "#d32f2f",
  ORANGE = "#e07a00",
  BLUE = "#2563eb",
  PURPLE = "#7b3fb0",
  GREY = "#d6d6d6";

// Ported from the scratchpad generator: preserve projection, paint order and scene coordinates.
// Markup below is built only from these local drawing helpers and literal scene data.
// ---------- iso helpers ----------
const P = (x: number, y: number, z: number): Point2 => [(x - y) * 0.866, (x + y) * 0.5 - z];
const f = (n: number) => n.toFixed(1);
const pts = (a: Point2[]) => a.map((p) => f(p[0]) + "," + f(p[1])).join(" ");
const K = {
  duct: ["#eef2f7", "#cfd9e5", "#b3c1d2"],
  sa: ["#e4f0fb", "#bcd6ee", "#9fc0e0"],
  ra: ["#e6f5e6", "#c3e2c3", "#a6d0a6"],
  unit: ["#efe7f7", "#d6c4e8", "#bda5d8"],
  pass: ["#eeeeee", GREY, "#bdbdbd"],
  grille: ["#fafafa", "#dcdcdc", "#c4c4c4"],
  cap: ["#78848f", "#5d6872", "#49535c"],
  fit: ["#fff3d6", "#f0dca8", "#e2c985"],
};
function box(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  kind: Kind = "duct",
  o: BoxOptions = {},
) {
  const c = K[kind],
    op = o.op ?? 1;
  const top = [
    P(x, y, z + dz),
    P(x + dx, y, z + dz),
    P(x + dx, y + dy, z + dz),
    P(x, y + dy, z + dz),
  ];
  const yf = [
    P(x, y + dy, z),
    P(x + dx, y + dy, z),
    P(x + dx, y + dy, z + dz),
    P(x, y + dy, z + dz),
  ];
  const xf = [
    P(x + dx, y, z),
    P(x + dx, y + dy, z),
    P(x + dx, y + dy, z + dz),
    P(x + dx, y, z + dz),
  ];
  const st = o.ghost
    ? `stroke="#8a97a3" stroke-dasharray="3 2" fill="none"`
    : `stroke="${INK}" stroke-width="1" stroke-linejoin="round"`;
  const fl = (i: number) => (o.ghost ? "" : `fill="${c[i]}" fill-opacity="${op}"`);
  return `<polygon points="${pts(yf)}" ${fl(1)} ${st}/><polygon points="${pts(xf)}" ${fl(2)} ${st}/><polygon points="${pts(top)}" ${fl(0)} ${st}/>`;
}
const UV: Record<Axis, [Point3, Point3]> = {
  x: [
    [0, 1, 0],
    [0, 0, 1],
  ],
  y: [
    [1, 0, 0],
    [0, 0, 1],
  ],
  z: [
    [1, 0, 0],
    [0, 1, 0],
  ],
};
const AX: Record<Axis, Point3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
function ring(c: Point3, axis: Axis, r: number, t = 0) {
  const [u, v] = UV[axis],
    a = AX[axis],
    out = [];
  for (let i = 0; i < 28; i++) {
    const th = (i / 28) * Math.PI * 2,
      cs = Math.cos(th) * r,
      sn = Math.sin(th) * r;
    out.push(
      P(
        c[0] + a[0] * t + u[0] * cs + v[0] * sn,
        c[1] + a[1] * t + u[1] * cs + v[1] * sn,
        c[2] + a[2] * t + u[2] * cs + v[2] * sn,
      ),
    );
  }
  return out;
}
function hull(p: Point2[]) {
  p = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: Point2, a: Point2, b: Point2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Point2[] = [],
    up: Point2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.slice().reverse()) {
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function cyl(c: Point3, axis: Axis, L: number, r: number, kind: Kind = "duct") {
  const k = K[kind],
    a = ring(c, axis, r, 0),
    b = ring(c, axis, r, L);
  return `<polygon points="${pts(hull(a.concat(b)))}" fill="${k[1]}" stroke="${INK}" stroke-linejoin="round"/><polygon points="${pts(b)}" fill="${k[0]}" stroke="${INK}"/>`;
}
function frustum(c: Point3, axis: Axis, L: number, r1: number, r2: number, kind: Kind = "fit") {
  const k = K[kind],
    a = ring(c, axis, r1, 0),
    b = ring(c, axis, r2, L);
  return `<polygon points="${pts(hull(a.concat(b)))}" fill="${k[1]}" stroke="${INK}" stroke-linejoin="round"/><polygon points="${pts(b)}" fill="${k[0]}" stroke="${INK}"/>`;
}
const MK: Record<string, string> = {
  [GREEN]: "g",
  [RED]: "r",
  [ORANGE]: "o",
  [BLUE]: "b",
  [PURPLE]: "p",
  "#888": "k",
};
function conn(
  p: Point3,
  axis: Axis,
  sign: number,
  color: string,
  o: { r?: number; len?: number } = {},
) {
  const r = o.r ?? 7,
    len = o.len ?? 14,
    a = AX[axis];
  let s = `<polygon points="${pts(ring(p, axis, r))}" fill="#fff" fill-opacity=".7" stroke="${color}" stroke-width="2"/>`;
  if (len > 0) {
    const e: Point3 = [
      p[0] + a[0] * sign * len,
      p[1] + a[1] * sign * len,
      p[2] + a[2] * sign * len,
    ];
    s += `<line x1="${f(P(...p)[0])}" y1="${f(P(...p)[1])}" x2="${f(P(...e)[0])}" y2="${f(P(...e)[1])}" stroke="${color}" stroke-width="1.6" marker-end="url(#ah-${MK[color]})"/>`;
  }
  return s;
}
function line(a: Point3, b: Point3, color: string, o: LineOptions = {}) {
  const A = P(...a),
    B = P(...b);
  return `<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}" stroke="${color}" stroke-width="${o.w ?? 2.2}" ${o.dash ? 'stroke-dasharray="5 3"' : ""} ${o.arrow ? `marker-end="url(#ah-${MK[color]})"` : ""}/>`;
}
const flow = (a: Point3, b: Point3) => line(a, b, BLUE, { w: 2, arrow: true });
function T(p: Point3, txt: string, dx = 0, dy = 0, o: TextOptions = {}) {
  const s = P(...p);
  return `<text x="${f(s[0] + dx)}" y="${f(s[1] + dy)}" font-size="${o.size ?? 9}" fill="${o.fill ?? "#26323b"}" text-anchor="${o.anchor ?? "middle"}" ${o.bold ? 'font-weight="700"' : ""}>${txt}</text>`;
}
function dim(a: Point3, b: Point3, txt: string, dx = 0, dy = -6) {
  const A = P(...a),
    B = P(...b),
    m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  return `<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}" stroke="#555" stroke-width="1"/><circle cx="${f(A[0])}" cy="${f(A[1])}" r="1.6" fill="#555"/><circle cx="${f(B[0])}" cy="${f(B[1])}" r="1.6" fill="#555"/><text x="${f(m[0] + dx)}" y="${f(m[1] + dy)}" font-size="9" font-weight="700" fill="#111" text-anchor="middle">${txt}</text>`;
}
function fanSym(x: number, y: number, z: number) {
  const c = P(x, y, z);
  return `<ellipse cx="${f(c[0])}" cy="${f(c[1])}" rx="10" ry="6" fill="#fff" stroke="${PURPLE}" stroke-width="1.6"/><text x="${f(c[0])}" y="${f(c[1] + 3)}" font-size="8" font-weight="700" fill="${PURPLE}" text-anchor="middle">F</text>`;
}
function slots(x: number, y: number, z: number, dx: number, dy: number, n = 5) {
  // grille slots on a top face
  let s = "";
  for (let i = 1; i <= n; i++)
    s += line(
      [x + 3, y + (dy * i) / (n + 1), z],
      [x + dx - 3, y + (dy * i) / (n + 1), z],
      "#7a7a7a",
      { w: 1 },
    );
  return s;
}
const grille = (x: number, y: number, z: number, dx: number, dy: number, dz = 4) =>
  box(x, y, z, dx, dy, dz, "grille") + slots(x, y, z + dz, dx, dy);
const RD = (x0: number, L: number, y = 0, z = 0, kind: Kind = "duct", o: BoxOptions = {}) =>
  box(x0, y - 14, z - 11, L, 28, 22, kind, o);
const svg = (body: string, _label: string, tx = 130, ty = 95): Drawing => ({ body, tx, ty });

// ---------- scenes ----------
const S: Record<string, () => Drawing> = {};
S.nearMiss = () =>
  svg(
    RD(-80, 76) +
      RD(4, 76) +
      conn([-4, 0, 0], "x", 1, ORANGE, { len: 7, r: 8 }) +
      conn([4, 0, 0], "x", -1, ORANGE, { len: 7, r: 8 }) +
      line([-4, 0, 0], [4, 0, 0], RED, { dash: true, w: 2.5 }) +
      dim([-4, -18, -11], [4, -18, -11], "0.5 in", 0, 26) +
      T([0, 0, 0], "centred, facing", 0, -52, { fill: "#555" }) +
      flow([-60, 0, 20], [-20, 0, 20]),
    "two open duct ends under one inch apart, centred",
  );
// A short 16x8 riser, capped at the bottom, fed through a side takeoff; a grille on its open top.
function riser(o: { off: number }) {
  let s =
    box(-12, -6, -44, 24, 12, 4, "cap") + // end cap plate
    box(-12, -6, -40, 24, 12, 68, "duct") + // riser
    cyl([12, 0, -28], "x", 56, 7) + // round branch
    conn([12, 0, -28], "x", 1, GREEN, { len: 0, r: 7 });
  s += grille(-14 + o.off, -10, 28, 28, 20, 4);
  if (o.off)
    s +=
      conn([0, 0, 28], "z", 1, ORANGE, { len: 0, r: 6 }) +
      line([0, 0, 28], [o.off, 0, 28], RED, { dash: true, w: 2.5 });
  return s;
}
S.stretched = () =>
  svg(
    riser({ off: 6 }) +
      flow([66, 0, -16], [22, 0, -16]) +
      flow([-18, -6, -24], [-18, -6, 16]) +
      dim([0, -14, 34], [6, -14, 34], "2.0 in off-centre", -6, -8) +
      T([0, 0, 34], "grille 8747668", 24, -14, { size: 8, anchor: "start", bold: true }) +
      T([0, 0, -10], "riser 8750451", -26, 0, { size: 8, anchor: "end" }) +
      T([0, 0, -44], "cap 9405610", -22, 8, { size: 8, anchor: "end" }) +
      T([68, 0, -28], "takeoff 13675158", 0, 18, { size: 8 }) +
      T([0, 0, 0], "no boot between riser and grille", 0, 72, { fill: "#555", size: 8 }),
    "grille on the open top of a capped riser, two inches off-centre",
    130,
    84,
  );
S.anomalous = () =>
  svg(
    box(-50, -44, -5, 100, 88, 10, "duct") +
      box(-16, -16, -12, 32, 32, 26, "grille") +
      slots(-16, -16, 14, 32, 32) +
      conn([0, 0, 14], "z", 1, ORANGE, { len: 20, r: 9 }) +
      T([0, 0, 0], "connector faces away", 0, -58, { fill: RED, bold: true }) +
      T([0, 0, 0], "grille pushed through plenum", 0, 62, { fill: "#555" }) +
      T([0, 0, 0], "BLOCKS", 0, -70, { fill: RED, bold: true, size: 11 }),
    "slot grille pushed through a flat plenum duct, connector facing away",
  );
S.tap = () =>
  svg(
    RD(-65, 130) +
      cyl([0, 14, 0], "y", 52, 9) +
      conn([0, 14, 0], "y", -1, ORANGE, { len: 8, r: 8 }) +
      line([0, 14, 0], [0, 0, 0], RED, { dash: true, w: 2.5 }) +
      T([0, 40, 0], "open end on side face", 32, 22, { anchor: "start", fill: "#555" }) +
      T([0, 0, 0], "tap", 0, -44, { bold: true, size: 11 }),
    "open end of a branch landing on the side of a duct",
  );
S.inline = () =>
  svg(
    RD(-70, 140, 0, 0, "duct", { op: 0.4 }) +
      box(-4, -13, -10, 8, 26, 20, "pass") +
      conn([-4, 0, 0], "x", -1, ORANGE, { len: 8, r: 8 }) +
      conn([4, 0, 0], "x", 1, ORANGE, { len: 8, r: 8 }) +
      line([-70, 0, 0], [-4, 0, 0], RED, { dash: true, w: 2 }) +
      line([4, 0, 0], [70, 0, 0], RED, { dash: true, w: 2 }) +
      T([0, 0, 0], "damper floats inside one duct", 0, -48, { fill: "#555" }) +
      T([0, 0, 0], "spliced in, with a warning", 0, 56, { fill: "#555" }),
    "damper floating inside one straight duct",
  );
S.airTypes = () =>
  svg(
    RD(-80, 76, 0, 0, "sa") +
      RD(4, 76, 0, 0, "ra") +
      conn([-4, 0, 0], "x", 1, ORANGE, { len: 7, r: 8 }) +
      conn([4, 0, 0], "x", -1, ORANGE, { len: 7, r: 8 }) +
      line([-8, -7, 6], [8, 7, -6], RED, { w: 2.5 }) +
      line([-8, 7, -6], [8, -7, 6], RED, { w: 2.5 }) +
      T([-45, 0, 0], "supply", 0, -34, { fill: "#1f5f99", bold: true }) +
      T([45, 0, 0], "return", 0, -34, { fill: "#2f7a2f", bold: true }) +
      T([0, 0, 0], "never joined silently: warning only", 0, 52, { fill: "#555" }),
    "supply end near a return end, never joined",
  );
S.bendFixed = () => {
  const a: Point3 = [-70, 0, 0],
    b: Point3 = [-8, 0, 62],
    m = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
  return svg(
    RD(-70, 50) +
      box(-20, -12, -11, 24, 24, 24, "fit") +
      box(-18, -10, 13, 20, 20, 49, "duct") +
      conn([-20, 0, 0], "x", 1, GREEN, { len: 0, r: 8 }) +
      conn([-8, 0, 13], "z", 1, GREEN, { len: 0, r: 7 }) +
      conn(a, "x", -1, ORANGE, { len: 0, r: 8 }) +
      conn(b, "z", 1, ORANGE, { len: 0, r: 7 }) +
      line(a, b, RED, { dash: true, w: 2 }) +
      line([m[0] - 5, 0, m[2] - 5], [m[0] + 5, 0, m[2] + 5], RED, { w: 3 }) +
      line([m[0] - 5, 0, m[2] + 5], [m[0] + 5, 0, m[2] - 5], RED, { w: 3 }) +
      T([-8, 0, 0], "bend 14567949", 22, 4, { size: 8, anchor: "start" }) +
      T([0, 0, 0], "stub", -60, 26, { size: 8 }) +
      T([-8, 0, 62], "riser", 14, 0, { size: 8, anchor: "start" }) +
      T([0, 0, 0], "old: a 28 in gap to join (a loop)", 0, 56, { fill: RED, size: 8 }) +
      T([0, 0, 0], "now: each loose end is capped", 0, 68, { fill: "#555", size: 8 }),
    "two loose ends already connected through a bend are no longer offered as a gap",
    140,
    92,
  );
};
S.erv = () => {
  const ports: [number, number, string, "in" | "out", Kind][] = [
    [20, 12, "FA 6 in", "in", "sa"],
    [20, -12, "EX 55 in", "in", "ra"],
    [-20, -12, "FA 14 out", "out", "sa"],
    [-20, 12, "EX 3 out", "out", "ra"],
  ];
  let s =
    box(-40, -26, -24, 80, 52, 34, "unit") +
    T([0, 0, -24], "RV-1 6078870 (ERV)", 0, 18, { size: 8, bold: true });
  for (const [x, y, l, d, k] of ports) {
    s += cyl([x, y, 10], "z", 10, 6, k);
    s += d === "in" ? flow([x, y, 44], [x, y, 24]) : flow([x, y, 24], [x, y, 44]);
    s += T([x, y, 48], l, 0, -4, { size: 8, bold: true });
  }
  return svg(
    s +
      T([0, 0, 0], "directions as Revit states them; Pe never flips one", 0, 70, {
        fill: "#555",
        size: 8,
      }),
    "an ERV with four ports, each with the direction Revit reports",
    130,
    92,
  );
};
S.trans = () =>
  svg(
    cyl([-90, 0, 0], "x", 60, 10) +
      frustum([-30, 0, 0], "x", 26, 10, 7) +
      cyl([-4, 0, 0], "x", 70, 7) +
      conn([-30, 0, 0], "x", -1, RED, { len: 16, r: 10 }) +
      conn([-4, 0, 0], "x", 1, RED, { len: 16, r: 7 }) +
      T([-30, 0, 0], "Out", -16, 24, { fill: RED, bold: true, size: 8 }) +
      T([-4, 0, 0], "Out", 18, 20, { fill: RED, bold: true, size: 8 }) +
      flow([-80, 0, 26], [40, 0, 26]) +
      T([-20, 0, 26], "tree: from the fan", 0, -6, { fill: BLUE, size: 8 }) +
      T([-70, 0, 0], "6 in", 0, 26, { size: 8 }) +
      T([40, 0, 0], "5 in", 0, 22, { size: 8 }) +
      T([0, 0, 0], "transition 13692119: both connectors say Out", 0, 64, {
        fill: "#555",
        size: 8,
      }),
    "a transition whose two connectors both say Out, priced in the tree direction",
    140,
    90,
  );
S.collar = () =>
  svg(
    riser({ off: 0 }) +
      frustum([12, 0, -28], "x", 8, 9, 7) +
      flow([70, 0, -14], [26, 0, -14]) +
      flow([-18, -6, -24], [-18, -6, 16]) +
      T([68, 0, -28], "6 in branch, 102 cfm", 0, 18, { size: 8 }) +
      T([0, 0, -44], "cap", -18, 8, { size: 8, anchor: "end" }) +
      T([0, 0, 34], "grille", 22, -10, { size: 8, anchor: "start" }) +
      T([16, 0, -28], "takeoff collar", 6, -14, { size: 8, anchor: "start", bold: true }) +
      T([0, 0, 0], "all the air turns: branch Cb at Qb/Qc = 1", 0, 72, { fill: "#555", size: 8 }),
    "a takeoff entered from its collar, all air turning into a capped riser",
    130,
    84,
  );
S.side = () =>
  svg(
    RD(-90, 150) +
      box(60, -14, -11, 24, 28, 22, "fit") +
      cyl([48, 14, 0], "y", 44, 8) +
      conn([48, 14, 0], "y", 1, GREEN, { len: 0, r: 8 }) +
      conn([60, 0, 0], "x", 1, GREEN, { len: 0, r: 8 }) +
      flow([48, 50, 18], [48, 18, 18]) +
      flow([50, 0, 22], [64, 0, 22]) +
      dim([-90, -22, -11], [60, -22, -11], "charged: 7.14 ft (whole duct)", 0, 34) +
      dim([48, -22, 14], [60, -22, 14], "0.65 ft", 6, -6) +
      T([48, 58, 0], "takeoff", 0, 14, { size: 8 }) +
      T([72, 0, 0], "elbow", 16, -6, { size: 8, anchor: "start" }) +
      T([0, 0, 0], "drawn level; the real duct is a 14x14 riser", 0, 70, { fill: "#555", size: 8 }),
    "a duct entered through a side takeoff, charged friction over its whole length",
    135,
    88,
  );
function loopScene(closedByPe: boolean) {
  const right = closedByPe
    ? conn([45, -36, 0], "y", 1, ORANGE, { len: 0, r: 7 }) +
      conn([45, -14, 0], "y", -1, ORANGE, { len: 0, r: 7 }) +
      line([45, -36, 0], [45, -14, 0], RED, { dash: true, w: 2.5 })
    : cyl([45, -36, 0], "y", 22, 8) +
      conn([45, -36, 0], "y", 1, GREEN, { len: 0, r: 7 }) +
      conn([45, -14, 0], "y", 1, GREEN, { len: 0, r: 7 });
  return svg(
    box(-60, -64, -11, 120, 28, 22, "duct") +
      cyl([-45, -36, 0], "y", 22, 8) +
      conn([-45, -36, 0], "y", 1, GREEN, { len: 0, r: 7 }) +
      conn([-45, -14, 0], "y", 1, GREEN, { len: 0, r: 7 }) +
      RD(-60, 120) +
      right +
      T(
        [0, 0, 0],
        closedByPe
          ? "BLOCKS: our guess closed the loop"
          : "loop modelled in Revit: priced as a tree",
        0,
        62,
        { fill: closedByPe ? RED : "#555", bold: closedByPe },
      ),
    closedByPe ? "loop closed by an inferred join" : "loop modelled in Revit",
    130,
    85,
  );
}
S.loopRevit = () => loopScene(false);
S.loopPe = () => loopScene(true);
S.phase = () =>
  svg(
    RD(-70, 70) +
      RD(0, 70) +
      conn([0, 0, 0], "x", 1, GREEN, { len: 0, r: 8 }) +
      box(-10, -14, 22, 70, 28, 22, "duct", { ghost: true }) +
      T([0, 0, 0], "Future-phase duplicate", 40, -60, { fill: "#666", anchor: "start" }) +
      T([0, 0, 0], "left out, warning where it touches", 0, 54, { fill: "#555" }),
    "a Future-phase duplicate left out of the network",
  );
S.ports = () =>
  svg(
    box(-36, -24, -76, 72, 48, 50, "unit") +
      T([0, 0, -50], "FR-1 (RA 1)", 0, 0, { size: 8, bold: true }) +
      box(-36, -24, -16, 72, 48, 34, "unit", { op: 0.55 }) +
      T([0, 0, 2], "FC-5 (SA 29)", 0, 4, { size: 8, bold: true }) +
      conn([0, 0, -26], "z", 1, ORANGE, { len: 7, r: 9 }) +
      conn([0, 0, -16], "z", -1, ORANGE, { len: 7, r: 9 }) +
      line([0, 0, -26], [0, 0, -16], RED, { dash: true, w: 2.5 }) +
      dim([44, 0, -26], [44, 0, -16], "1.9 in", 6, 4) +
      T([0, 0, 0], "ports open, not reported by Revit: NOT joined today", 0, 66, {
        fill: RED,
        size: 8,
      }),
    "two units with open ports facing each other 1.9 in apart",
    130,
    100,
  );
S.shared = () => {
  let s = RD(-60, 120);
  (
    [
      [-45, "RA 1"],
      [-15, "RA 26"],
      [15, "EX 88"],
      [45, "FA 24"],
    ] satisfies [number, string][]
  ).forEach(([x, l]) => {
    s +=
      cyl([x, 0, 11], "z", 28, 7) +
      conn([x, 0, 11], "z", 1, GREEN, { len: 0, r: 6 }) +
      T([x, 0, 42], l, 0, -4, { size: 8, bold: true });
  });
  (
    [
      [-45, "FA 32"],
      [-15, "FA 36"],
      [15, "FA 42"],
    ] satisfies [number, string][]
  ).forEach(([x, l]) => {
    s +=
      cyl([x, 14, 0], "y", 24, 6) +
      conn([x, 14, 0], "y", 1, GREEN, { len: 0, r: 5 }) +
      T([x, 38, 0], l, 0, 12, { size: 8, bold: true });
  });
  s +=
    cyl([60, 0, 0], "x", 20, 7) +
    conn([60, 0, 0], "x", 1, GREEN, { len: 0, r: 6 }) +
    T([80, 0, 0], "SA 71", 4, 3, { size: 8, bold: true, anchor: "start" });
  s += T([0, 0, 0], "plenum 6530455 (shared)", 0, -2, { size: 8, fill: "#444" });
  return svg(s, "one return plenum connected to eight systems", 125, 100);
};
S.split = () => {
  const cluster = (x: number, y: number, n: number, lbl: string, sub: string) => {
    let s = box(x, y, 0, 26, 20, 18, "unit") + box(x + 32, y, 0, 26, 20, 18, "unit");
    for (let i = 0; i < n; i++) s += box(x + 6 + i * 11, y + 30, 0, 7, 7, 2, "grille");
    const c = P(x + 30, y + 14, 0);
    return (
      s +
      `<ellipse cx="${f(c[0])}" cy="${f(c[1] + 4)}" rx="${28 + n * 4}" ry="${24}" fill="none" stroke="#999" stroke-dasharray="4 3"/>` +
      `<text x="${f(c[0])}" y="${f(c[1] - 28)}" font-size="8" text-anchor="middle" font-weight="700">${lbl}</text>` +
      `<text x="${f(c[0])}" y="${f(c[1] + 38)}" font-size="8" text-anchor="middle" fill="#555">${sub}</text>`
    );
  };
  return svg(
    cluster(-70, -50, 5, "FC-17 + DH-21", "5 grilles") +
      cluster(-10, 10, 2, "FC-35 + DH-30", "2 grilles") +
      box(40, -30, 0, 7, 7, 2, "grille") +
      T([40, -30, 0], "grille 8747668", 0, -14, { size: 8, bold: true }) +
      `<text x="130" y="-76" font-size="9" text-anchor="end" fill="${RED}" font-weight="700" transform="translate(0,0)">one name: SA 19</text>`,
    "three separate networks sharing the name SA 19",
    125,
    90,
  );
};
S.cap = () =>
  svg(
    RD(-75, 95) +
      conn([20, 0, 0], "x", 1, ORANGE, { len: 12, r: 8 }) +
      box(36, -15, -12, 4, 30, 24, "cap", { ghost: true }) +
      T([0, 0, 0], "+ cap of the duct type", 0, 52, { fill: "#555" }) +
      T([0, 0, 0], "dangling open end", -20, -48, { fill: ORANGE, bold: true }),
    "dangling open end gets a cap",
  );
S.touch = () =>
  svg(
    RD(-75, 75) +
      RD(0, 75) +
      conn([0, 0, 0], "x", 1, GREEN, { len: 0, r: 9 }) +
      dim([0, -18, -11], [0.4, -18, -11], "&le; 1/16 in", 0, 28) +
      T([0, 0, 0], "touching: connect", 0, -44, { fill: "#555" }),
    "two touching ends become connected",
  );
S.union = () =>
  svg(
    RD(-75, 63) +
      RD(12, 63) +
      box(-12, -16, -13, 24, 32, 26, "fit") +
      conn([-12, 0, 0], "x", 1, GREEN, { len: 0, r: 8 }) +
      conn([12, 0, 0], "x", 1, GREEN, { len: 0, r: 8 }) +
      T([0, 0, 0], "union fitting (or extend the duct)", 0, 56, { fill: "#555" }) +
      dim([-12, -20, -13], [12, -20, -13], "&le; 3 in", 0, 28),
    "same-size gap of up to three inches gets a union fitting",
  );
S.far = () =>
  svg(
    RD(-80, 50) +
      RD(30, 50) +
      conn([-30, 0, 0], "x", 1, ORANGE, { len: 8, r: 8 }) +
      conn([30, 0, 0], "x", -1, ORANGE, { len: 8, r: 8 }) +
      dim([-30, -18, -11], [30, -18, -11], "13.7 in", 0, 40) +
      line([-6, -6, 6], [6, 6, -6], RED, { w: 3 }) +
      line([-6, 6, -6], [6, -6, 6], RED, { w: 3 }) +
      T([0, 0, 0], "fix in Revit (a person)", 0, 56, { fill: RED, bold: true }),
    "gap too big to heal",
  );
S.lonely = () =>
  svg(
    box(-32, -24, -14, 64, 48, 28, "unit") +
      fanSym(0, 0, 14) +
      conn([0, 0, 14], "z", 1, ORANGE, { len: 16, r: 9 }) +
      T([0, 0, 0], "FR-1 guessed as fan", 0, 62, { fill: "#555" }) +
      T([0, 0, 0], "hides its own open port", 0, 74, { fill: ORANGE }),
    "lone filter chassis counted as a fan with an open port",
    130,
    85,
  );
S.twoFans = () =>
  svg(
    box(-84, -18, -12, 36, 36, 24, "unit") +
      fanSym(-66, 0, 12) +
      RD(-48, 84) +
      box(36, -18, -12, 36, 36, 24, "unit") +
      fanSym(54, 0, 12) +
      conn([-48, 0, 0], "x", 1, GREEN, { len: 0, r: 8 }) +
      conn([36, 0, 0], "x", 1, GREEN, { len: 0, r: 8 }) +
      flow([-40, 0, 20], [-8, 0, 20]) +
      flow([30, 0, 20], [2, 0, 20]) +
      T([-66, 0, 0], "FC-30", 0, 36, { size: 8, bold: true }) +
      T([54, 0, 0], "DH-16", 0, 36, { size: 8, bold: true }) +
      T([0, 0, 0], "each prices its stretch until air meets a larger fan", 0, 62, {
        fill: "#555",
        size: 8,
      }),
    "two fans in one network",
    125,
    90,
  );
S.passive = () =>
  svg(
    box(-84, -18, -12, 32, 36, 24, "unit") +
      fanSym(-68, 0, 12) +
      RD(-52, 34) +
      box(-18, -16, -13, 36, 32, 26, "pass") +
      RD(18, 50) +
      conn([-52, 0, 0], "x", 1, GREEN, { len: 0, r: 8 }) +
      conn([-18, 0, 0], "x", 1, GREEN, { len: 0, r: 8 }) +
      conn([18, 0, 0], "x", 1, GREEN, { len: 0, r: 8 }) +
      flow([-76, 0, 22], [60, 0, 22]) +
      T([0, 0, 0], "passive: air passes, networks merge", 0, 58, { fill: "#555" }) +
      T([0, 0, 0], "filter / silencer", 0, -44, { size: 8 }),
    "passive unit merging the networks on both sides",
  );

function Arrowheads({ id }: { id: string }) {
  return (
    <defs>
      {Object.entries(MK).map(([color, key]) => (
        <marker
          key={key}
          id={`${id}-${key}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill={color} />
        </marker>
      ))}
    </defs>
  );
}

export function CaseDrawing({ scene, label }: { scene: string; label: string }) {
  const id = useId();
  const draw = Object.hasOwn(S, scene) ? S[scene] : undefined;
  if (!draw) throw new Error(`Unknown duct case scene: ${scene}`);
  const { body, tx, ty } = draw();
  return (
    <svg viewBox="0 0 260 170" width="260" height="170" role="img" aria-label={label}>
      <Arrowheads id={id} />
      <rect width="260" height="170" fill="#fcfdfe" />
      <g
        transform={`translate(${tx},${ty})`}
        dangerouslySetInnerHTML={{ __html: body.replaceAll("url(#ah-", `url(#${id}-`) }}
      />
    </svg>
  );
}

export function CaseLegend() {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-1">
        <svg width="40" height="14" aria-hidden="true">
          <line x1="2" y1="7" x2="38" y2="7" stroke={GREEN} strokeWidth="2.5" />
        </svg>
        real Revit connection
      </span>
      <span className="inline-flex items-center gap-1">
        <svg width="40" height="14" aria-hidden="true">
          <line x1="2" y1="7" x2="38" y2="7" stroke={RED} strokeWidth="2.5" strokeDasharray="5 3" />
        </svg>
        join Pe infers
      </span>
      <span className="inline-flex items-center gap-1">
        <svg width="20" height="14" aria-hidden="true">
          <ellipse cx="10" cy="7" rx="6" ry="5" fill="#fff" stroke={ORANGE} strokeWidth="2" />
        </svg>
        open end
      </span>
      <span className="inline-flex items-center gap-1">
        <svg width="40" height="14" aria-hidden="true">
          <Arrowheads id={id} />
          <line
            x1="2"
            y1="7"
            x2="36"
            y2="7"
            stroke={BLUE}
            strokeWidth="2"
            markerEnd={`url(#${id}-b)`}
          />
        </svg>
        air flow
      </span>
      <span className="inline-flex items-center gap-1">
        <svg width="30" height="20" aria-hidden="true">
          <ellipse cx="15" cy="9" rx="10" ry="6" fill="#fff" stroke={PURPLE} strokeWidth="1.6" />
          <text x="15" y="12" fontSize="8" fontWeight="700" fill={PURPLE} textAnchor="middle">
            F
          </text>
        </svg>
        fan
      </span>
      <span className="inline-flex items-center gap-1">
        <svg width="30" height="20" aria-hidden="true">
          <polygon points="3,8 20,3 27,8 27,16 10,19 3,14" fill={GREY} stroke={INK} />
        </svg>
        passive unit
      </span>
      <span className="inline-flex items-center gap-1">
        <svg width="20" height="20" aria-hidden="true">
          <path d="M4 4 L16 16 M4 16 L16 4" stroke={RED} strokeWidth="2.5" />
        </svg>
        refused join
      </span>
    </div>
  );
}
