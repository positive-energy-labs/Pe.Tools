// Source census only. Each row names its blind spot; types own prop and export contracts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import ts from "typescript";
import { REACH_BLOCK } from "./reach-pattern.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const W = "apps/web/src/";
const K = "packages/kit/src/";
type Allow = { glob: string; reason: string; selector?: string };
type Rule = {
  id: string;
  doctrine: `${"N" | "I" | "L" | "P"}${number}`;
  pattern: RegExp;
  roots: string[];
  allow: Allow[];
  max?: Record<string, number>;
  asOf?: string;
  select?: "classes" | "hover-css" | "reach" | "reading-rows";
  exclude?: string[];
  cannotSee: string;
};
const allow = (entries: Record<string, string>): Allow[] =>
  Object.entries(entries).map(([glob, reason]) => ({ glob: W + glob, reason }));

// Filenames use the wave-4 final homes: land.ts, revit-target.tsx and go-to.tsx.
// prettier-ignore
const RULES: Rule[] = [
  { id: "teach-observer-owner", doctrine: "N6", pattern: /new\s+MutationObserver\b/g,
    roots: [K + "components/lang/use-teach.ts"], allow: [],
    cannotSee: "Observer aliases or imports, scheduling and reader liveness; the deterministic observer test owns those." },
  { id: "button-group-css-fold", doctrine: "L3", pattern: /getComputedStyle|\.parentElement\b|(?:toggle|remove)Attribute\(/g,
    roots: [K + "components/lang/button-group.tsx"], allow: [],
    cannotSee: "CSS container sizing and visible label recovery; layout tests pin no geometry subscription and browser checks wide/narrow/wide." },
  { id: "damage-bounded-surfaces", doctrine: "I2", pattern: /:root \[data-damage\]\s*\{[^}]*\banimation\s*:\s*(?!none\b)\S[^;}]*/g,
    roots: [K + "components/lang/lang.css"], allow: [], cannotSee: "Grouped mark structure, composited layers or latency; damage.test.tsx and native production traces cover those." },
  { id: "damage-mask-depth", doctrine: "I2", pattern: /new THREE\.MeshBasicMaterial\(\{(?![^}]*SURFACE_DEPTH)[^}]*\}\)/gs,
    roots: [W + "scene/damage.ts"], allow: [],
    cannotSee: "Aliased constructors or a weakened SURFACE_DEPTH value; material tests pin the offset, browser poses prove coverage." },
  { id: "damage-compositor-motion", doctrine: "I2", pattern: /@keyframes[^{}]*\{(?:(?!\n\})[\s\S])*?\b(?:filter|box-shadow)\s*:/g,
    roots: [K + "components/lang/lang.css"], allow: [], cannotSee: "Compositor eligibility, frame timing or animation phase; browser traces measure those." },
  { id: "message-bubble-themed-ground", doctrine: "L4", pattern: /data-surface="document"/g,
    roots: [W + "components/lang/conversation.tsx"], allow: [],
    cannotSee: "Computed colours or overrides elsewhere; mounted MessageBubble tests pin its plane and the browser checks both themes." },
  { id: "pane-buffer-resize-in-frame", doctrine: "N6",
    pattern: /const resize = \(\) => \{(?:(?!\n  \};)[\s\S])*?renderer\.setSize/g,
    roots: [W + "scene/renderer.ts"], allow: [],
    cannotSee: "Aliases, GPU completion or visible flashes; the size-consumer regression and native rAF buffer readback cover those paths." },
  { id: "list-heads-top-only", doctrine: "N3", pattern: /\bbottom:\s*/g,
    roots: [K + "components/lang/list-view.tsx"], allow: [], cannotSee: "Computed edge aliases or browser hit tests; SS4 requires the parent drive." },

  { id: "list-reveal-reserves-scrollport", doctrine: "N3", pattern: /^(?![\s\S]*scrollPaddingTop\s*=\s*"var\(--list-headroom\)")[\s\S]/g,
    roots: [K + "components/lang/list-view.tsx"], allow: [], cannotSee: "Browser hit tests or nested scrollports; mounted capacity tests cover measured reservation." },
  { id: "list-search-input-floor", doctrine: "N3", pattern: /^(?![\s\S]*\[data-list-search\] input\s*\{[^}]*min-inline-size:\s*8ch;)[\s\S]/g,
    roots: [K + "components/lang/lang.css"], allow: [], cannotSee: "Computed pixel widths or clipped controls; browser CH2/SS1 remains required." },

  { id: "claim-title-not-sentence", doctrine: "I6", pattern: /title:\s*(?:\w+\.)*claim\.text\b|\bclaimLine\(/g,
    roots: [W + "ducts/**/*.{ts,tsx}"], allow: [],
    cannotSee: "Aliased text fields, computed titles or sentence-like authored titles; D18 mounted proof covers the claim schema and row hint." },
  { id: "help-table-owner", doctrine: "P1", pattern: /grid-cols-\[|<(?:table|thead|tbody|tr|th|td)\b/g,
    roots: [W + "ducts/{compare-table,docs}.tsx"], allow: [],
    cannotSee: "Aliased tables or computed grids; mounted Help tests cover kit cell labels, browser TU3 measures overflow." },
  { id: "table-narrow-default", doctrine: "L3", pattern: /^(?![\s\S]*@container pe-table \(max-width: 36rem\))[\s\S]/g,
    roots: [K + "components/lang/lang.css"], allow: [],
    cannotSee: "Computed layout or intrinsic cell width; browser TU3 measures the whole dialog at 390px." },
  { id: "chat-new-action-has-words", doctrine: "L1", pattern: /<Button\b[^>]*\bicon=\{Plus\}[^>]*\/>|<button\b[^>]*>\s*\+\s*<\/button>/g,
    roots: [W + "chat/**/*.tsx"], allow: [],
    cannotSee: "Aliased plus icons, computed children or CSS-hidden text; thread-palette tests check the labelled pane action." },
  { id: "list-search-always-sticky", doctrine: "N3",
    pattern: /^(?![\s\S]*\[data-list-bar\]\s*\{[^}]*position:\s*sticky;)[\s\S]/g,
    roots: [K + "components/lang/lang.css"], allow: [], cannotSee: "Rendered scroll bounds, stacking or height; mounted tests cover measured search headroom." },
  { id: "list-search-no-sticky-switch", doctrine: "P1", pattern: /\bsticky\??\s*[:=]|<(?:ListView|PlainList|ListBar|TableFrame)\b[^>]*\bsticky\b/g,
    roots: [K + "components/lang/list-{view,search}.tsx", W + "**/*.tsx"], allow: [], cannotSee: "Aliased or spread props; no sticky switch exists in the list contract." },
  { id: "list-sticky-css-owner", doctrine: "P1", pattern: /\[data-list-(?:bar|search|section-head)\][^{}]*\{[^}]*position:\s*sticky/g,
    roots: [W + "**/*.css"], allow: [], cannotSee: "Utility classes, computed selectors or declarations through aliases." },
  { id: "pane-and-picture-stillness", doctrine: "N6",
    pattern: /settle\(next\);\s*if \(commit|onResize=\{state\.resizeTo\}|export function PictureStage\(/g,
    roots: [K + "components/lang/pane-resize.tsx", W + "scene/stage-controller.ts"], allow: [],
    cannotSee: "Aliased writes, fresh props bypassing memo, or browser layout; Profiler tests cover sibling send, focus, 20 drag steps and canvas retention." },
  { id: "readout-notice-slot", doctrine: "N6", pattern: /\breadoutLine\b|data-e-(?:capturing|refreshing|opening)/g,
    roots: [W + "ducts/proto/e/canvas.tsx"], allow: [],
    cannotSee: "Rendered geometry or pending timing; kit readout tests cover stable slot and fact nodes." },
  { id: "minimap-kind-css-scope", doctrine: "L2", pattern: /\[data-minimap\]/g,
    roots: [K + "**/*.css"], allow: [],
    cannotSee: "Rendered cascade or natural SVG bounds; the headed r5 browser assertion covers popup containment. jsdom covers portals and focus only." },
  { id: "floater-resize-obstacles", doctrine: "L2",
    pattern: /export const PANE_OBSTACLES\s*=\s*"(?![^"\n]*pane-resize-grip)[^"]*"|field\s*\.\s*querySelectorAll\(PANE_OBSTACLES\)/g,
    roots: [K + "components/lang/floater.tsx"], allow: [],
    cannotSee: "Delivered size observers, collisions or stacking; mounted tests cover arrival geometry and r6 Chrome asserts yielding after a sibling resize." },
  { id: "pane-seam-only-grip", doctrine: "L3", pattern: /\bsetExtent\b|\["tr", "bl"\]/g,
    roots: [K + "components/lang/pane-resize.tsx"], allow: [],
    cannotSee: "First-paint bounds or hit testing; mounted tests require one centred grip and preserve seam pointer paths." },
  { id: "floater-kind-resize", doctrine: "L3", pattern: /resizable\??\s*:|^(?![\s\S]*spec\.kind === "picture")[\s\S]/g,
    roots: [K + "components/lang/floater.tsx"], allow: [],
    cannotSee: "Actual glyph visibility, persisted rectangles or drag hit testing; r6 browser script drives the real globe grip." },
  { id: "focused-floater-above-siblings", doctrine: "N7", pattern: /^(?![\s\S]*\[data-slot="floater"\]:focus-within\s*\{[^}]*z-index: calc\(var\(--z-popup\) \+ 1\);)[\s\S]/g,
    roots: [K + "components/lang/lang.css"], allow: [],
    cannotSee: "Computed stacking and hit tests; r6 drives the actual maximum-size grip where the legend formerly intercepted it." },
  { id: "floater-popup-intrinsic-tracks", doctrine: "L2", pattern: /^(?![\s\S]*\[data-floater-popup\]\s*\{[^}]*display: grid;[^}]*grid-template: minmax\(0, 1fr\) \/ minmax\(0, 1fr\);)[\s\S]/g,
    roots: [K + "components/lang/lang.css"], allow: [],
    cannotSee: "Computed track sizing or SVG overflow; r6 Chrome asserts containment in both a 200px-wide and 200px-high field." },
  { id: "folded-popup-content-and-flip", doctrine: "L2",
    pattern: /data-sized=|side: "shift", align: "shift"|content\.getBoundingClientRect\(\)|node\.style\.max(?:Width|Height)\s*=/g,
    roots: [K + "components/lang/floater.tsx"], allow: [],
    cannotSee: "Measured SVG containment or clipping; the headed r6 assertion exercises native intrinsic popup/SVG sizing and field clamping; jsdom checks portal ownership and focus only." },
  { id: "tutorial-spatial-page-not-column-census", doctrine: "P1", pattern: /getBoundingClientRect\(\)\.width|flex flex-wrap items-center gap-x-4/g,
    roots: [W + "route/help.tsx"], allow: [],
    cannotSee: "Other flattened layouts, CSS wrapping or actual proportions; teach integration tests cover rectangles and one leader per pane, browser measures the responsive result." },
  { id: "subject-contact-one-reach", doctrine: "N7", pattern: /data-lit=\{lit|aria-pressed=|data-pressed=/g,
    roots: [K + "components/lang/subject-text.tsx"], allow: [],
    cannotSee: "Computed paint or focus/pointer lifetime; reach.test.tsx checks press metadata and the shared grace." },
  { id: "landing-outline-only", doctrine: "N7",
    pattern: /\[data-landed\]\s*\{[^}]*background(?:-[\w-]+)?\s*:|@keyframes pe-land\s*\{(?:(?!\n\})[\s\S])*background(?:-\w+)?\s*:/g,
    roots: [K + "components/lang/lang.css"], allow: [],
    cannotSee: "Call-site paint, cascade or browser animation; reach.test.tsx inspects the CSS owner and a computed transparent focus box." },
  { id: "hint-travel-focus-owner", doctrine: "N7",
    pattern: /^(?![\s\S]*contact\?\.\(popup, inside\(event\)\)[\s\S]*popup\.ownerDocument\.addEventListener\("keydown", keydown\))[^]/g,
    roots: [K + "components/lang/hover-grace.ts"], allow: [],
    cannotSee: "Actual Tab order, default cancellation, closure, Escape or pointer geometry; tooltip.test.tsx exercises entry/return/exit and travel." },
  { id: "nested-hint-parent-plane", doctrine: "N7", pattern: /^(?![\s\S]*const parent = target\?\.closest\('[^']*tooltip-content[^']*'\)[\s\S]*anchor=\{parent \?\? anchor\})[^]/g,
    roots: [K + "components/lang/tooltip.tsx"], allow: [],
    cannotSee: "Rendered collision bounds or native hits; tooltip.test.tsx measures nested hint/sibling intersections and pointer retention in the real positioner." },
  { id: "list-head-meta-yields-at-360", doctrine: "L3",
    pattern: /^(?![\s\S]*@container list \(max-width: 360px\)\s*\{\s*\.dl-row-colhead-meta,[^{}]*\{\s*display: none;)[\s\S]/g,
    roots: [K + "components/lang/lang.css"], allow: [], cannotSee: "Rendered label width, ellipsis and tooltip layout; LN360 needs browser measurement." },
  { id: "list-head-independent-plane", doctrine: "L4",
    pattern: /^(?![\s\S]*\.dl-row-colhead\s*\{[^}]*background:\s*var\(--pe-artifact\))[\s\S]/g,
    roots: [K + "components/lang/lang.css"], allow: [], cannotSee: "Computed theme colours or inherited overrides; D23 needs browser measurement." },
  { id: "composer-outcome-overlay", doctrine: "L3", pattern: /<OutcomeLine\b/g,
    roots: [W + "components/lang/conversation.tsx"], allow: [],
    cannotSee: "Aliased components or layout rects; mounted tests cover portal placement, browser W4 measures stability." },
  { id: "tutorial-no-machine-region-title", doctrine: "I1", pattern: /teachText\(title\)\s*\|\|\s*id/g,
    roots: [K + "components/lang/pane.tsx"], allow: [],
    cannotSee: "Rendered names, zero-size panes or stale facts; teach integration tests exercise those states." },
  { id: "tutorial-no-orphan-rehoming", doctrine: "P1", pattern: /regionOf\(f\)\?\.id\s*\?\?/g,
    roots: [W + "route/help.tsx"], allow: [],
    cannotSee: "Other fallback spellings or layout; integration tests cover withdrawal without rehoming." },
  { id: "selection-never-jumps", doctrine: "N1",
    pattern: /const select = useCallback\([\s\S]*?jump\.current[\s\S]*?\);|if \(into === page\.system && jump\.current\)/g,
    roots: [W + "ducts/proto/e/screen.tsx"], allow: [],
    cannotSee: "Aliased callbacks or renderer gestures; the route test checks the selected address and committed pose." },
  { id: "ruling-selects-row", doctrine: "N4",
    pattern: /pick:\s*\(\)\s*=>\s*onSelect\(item\.ids\[0\]/g,
    roots: [W + "ducts/proto/e/inbox.tsx"], allow: [],
    cannotSee: "Other first-subject spellings or visual selection; the route test checks both subjects through the picture." },
  { id: "picture-retention-document-custody", doctrine: "N6",
    pattern: /const pictureKey = native\b|lastPicture|cloneElement\(holding\.view/g,
    roots: [W + "ducts/proto/e/canvas.tsx"], allow: [],
    cannotSee: "Runtime retention or cross-document leaks; scene3d tests cover canvas identity while native authority is withdrawn." },
  { id: "hint-min-content-floor", doctrine: "I5",
    pattern: /^(?![\s\S]*\[data-slot="tooltip-content"\]\s*\{[^}]*min-width:\s*min-content;)[\s\S]+$/g,
    roots: [K + "components/lang/lang.css"], allow: [],
    cannotSee: "Rendered word width and collisions; this checks the CSS floor only." },
  { id: "hint-width-before-sliver", doctrine: "I5",
    pattern: /max-w-\[min\(24rem,var\(--available-width\)\)\]|collisionAvoidance=\{away \? \{ side: "none"/g,
    roots: [K + "components/lang/tooltip.tsx"], allow: [],
    cannotSee: "Computed min-content width, word clipping or actual collision placement; the browser pass measures LN-INPUT." },
  { id: "folded-floater-content-plane", doctrine: "L3", pattern: /<SubjectPopoverContent\b/g,
    roots: [K + "components/lang/floater.tsx"], allow: [],
    cannotSee: "Rendered popup bounds, focus-induced scrolling and pane shrinkage; the browser pass measures D02/O1." },
  { id: "scene-completeness-forwarded", doctrine: "N6",
    pattern: /return \{(?![^}]*\bomittedElements:)(?=[^}]*meshes: artifact\.meshes)[^}]*\}/g,
    roots: [W + "scene/use-scene.ts"], allow: [],
    cannotSee: "Correct counts, native geometry coverage, distance ordering or advisory visibility; hook tests cover count forwarding." },
  { id: "tutorial-facts-from-primitives", doctrine: "P1",
    pattern: /\b\w+_(?:KEYS|MODES|VIEWS)\s*(?::[^=;]+)?=\s*\[|\{(?:SPACE_LAYERS|ENCODINGS)\.map\(/g,
    roots: [W + "**/*docs*.tsx", W + "**/manifest.tsx"], allow: [],
    cannotSee: "Aliased or computed lists, prose that repeats a control, hidden DOM and rendered geometry; mounted registry tests cover lifecycle." },
  { id: "subject-kind-id", doctrine: "I1", pattern: /\$\{[^}\n]*\bkind\} \$\{[\w.]+\.id\}/g,
    roots: [W + "ducts/**/*.{ts,tsx}", "packages/ducts-domain/src/**/*.ts"], allow: [],
    cannotSee: "Concatenated ids, runtime names and prose received from Revit." },
  { id: "work-outside-floaters", doctrine: "N6",
    pattern: /<(?:PaneOverlay|Floater)\b(?:(?!<\/(?:PaneOverlay|Floater)>)[\s\S])*?\brole=["']status["']/g,
    roots: [W + "**/*.tsx"], allow: [],
    cannotSee: "Status components hidden behind imports, aliases, and DOM placement after portals." },
  { id: "composer-control-local-outcome", doctrine: "L3",
    pattern: /data-composer-(?:refusal|tools)|<Textarea\b[\s\S]*?\/>\s*(?:\{(?:refusal|tools)\b|<(?!\/)[A-Za-z])/g,
    roots: [W + "components/lang/conversation.{tsx,css}"], allow: [],
    cannotSee: "Arbitrary expression aliases between the textarea and controls, and computed grid placement." },
  { id: "scene-ground-presets", doctrine: "L4",
    pattern: /\b(?:opacity|color)\s*[:=]\s*(?:0x[\da-f]+|\d+(?:\.\d+)?|["'])|new THREE\.Color\(\s*(?:\d|["'])|setClearColor\(\s*(?:\d|["'])|\b0x[\da-f]{6}\b|\.color\.set(?:Hex|RGB|HSL)?\(\s*(?:\d|["'])/gi,
    roots: [W + "scene/**/*.ts"],
    allow: [{ glob: W + "scene/grounds.ts", reason: "One owner for subject/context materials, marker alpha and mask channel values." }],
    cannotSee: "Computed literals, GLSL expressions, token values or rendered contrast/occlusion." },
  { id: "label-placement-owner", doctrine: "L3", pattern: /while\s*\(|taken\.some|clear\(box\)/g,
    roots: [W + "ducts/{annotations,subject-labels}.tsx"], allow: [],
    cannotSee: "Computed placement or visual overlaps; only the former local collision loops are scanned." },
  { id: "css-damage-owner", doctrine: "I2", pattern: /pe-damage-beat|\[data-damage\]/g,
    roots: [W + "**/*.css", K + "**/*.css"],
    allow: [{ glob: K + "components/lang/lang.css", reason: "One shared critical-damage mark owns the pulse and selectors." }],
    cannotSee: "Computed appearance and animation." },
  { id: "subject-fallback-ids", doctrine: "I1", pattern: /(?:element|region) \$\{/g,
    roots: [W + "**/*.tsx"], allow: [], cannotSee: "Other raw-id spellings and runtime names." },
  { id: "picture-furniture-floater", doctrine: "L2",
    pattern: /^(?![\s\S]*\binset-[xy]-)(?=[\s\S]*\babsolute\b)(?=[\s\S]*(?:^|\s)(?:left|right|top|bottom)-\d)[\s\S]+$/g,
    roots: [W + "**/*.tsx"], select: "classes",
    allow: [
      { glob: W + "ducts/annotations.tsx", selector: ".absolute.left-0.top-0", reason: "SVG marks stay registered to the picture origin." },
      { glob: W + "rooms/sketch.tsx", selector: ".absolute.left-0.top-0", reason: "SVG sketch shares the picture origin." },
      { glob: W + "grounded-doc/view/block-markdown.tsx", selector: ".absolute.left-2.top-1/2", reason: "Link glyph marks its own text block." },
      { glob: W + "grounded-doc/view/page-pane.tsx", selector: ".absolute.left-0.5.top-0.5", reason: "Block-kind glyph marks its document rectangle." },
    ], cannotSee: "Computed classes or browser geometry." },
  { id: "surface-plane-inferred", doctrine: "L4", pattern: /data-surface=["'](?:recess|artifact)["']/g,
    roots: [W + "**/*.tsx"], allow: allow({
      "components/lang/conversation.tsx": "MessageBubble owns the theme-aware user-message plane; document is light-only paper.",
      "revit/element-menu.tsx": "Native action portal has no pane ancestor from which to infer its plane.",
      "machine/notice.tsx": "Detached notification portal has no pane ancestor.",
      "machine/notice-preview.tsx": "Notification specimen renders the same detached plane.",
    }), cannotSee: "Runtime-set surfaces and computed contrast." },
  { id: "kit-hover-layout", doctrine: "L3",
    pattern: /(?:^|;)\s*(?:(?:min-|max-)?(?:width|height)|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|border(?:-[\w-]+)?-width)\s*:/g,
    roots: [K + "**/*.css"], select: "hover-css", allow: [], cannotSee: "Nested CSS, inherited dimensions and media-query interactions." },
  { id: "web-hover-handler", doctrine: "N7", pattern: /onMouseEnter|onPointerEnter|onMouseOver/g,
    roots: [W + "**/*.tsx"], allow: [
      { glob: W + "{ducts/schematic,family/anatomy-model-views,space/cuts,rooms/plan,takeoff/level-plan}.tsx", reason: "SVG hit-testing projects geometry to domain identity; it does not paint hover locally." },
      ...allow({
        "ducts/annotations.tsx": "Segment/issue proxies synchronize subject badges.",
        "ducts/claims.tsx": "Claim geometry lights its underlying part.",
        "ducts/proto/e/bar.tsx": "Aggregate bars light multiple domain elements.",
        "ducts/proto/e/inbox.tsx": "Issue dwell and subject-numbering ownership include expanded detail.",
        "ducts/proto/e/tree-sidebar.tsx": "Ancestors light every descendant element.",
        "ducts/proto/e/rules-pane.tsx": "Rules light their governed set.",
        "ducts/proto/e/run-detail.tsx": "Run and fitting rows light underlying elements.",
        "family/anatomy.tsx": "Part geometry focus differs from native element identity.",
        "family/doc-pane.tsx": "Evidence engine owns document hover.",
        "grounded-doc/view/page-pane.tsx": "Page geometry synchronizes evidence blocks.",
        "grounded-doc/view/images-pane.tsx": "Markdown images synchronize evidence blocks.",
        "machine/notice.tsx": "Reading a notice pauses expiry.",
        "open/bay.tsx": "Pointer chooses the file preview.",
        "workbench/lens/peek.tsx": "Travel funnel and linger timing keep the popover reachable.",
        "rooms/inbox.tsx": "Room GUID identity is not a numeric Revit id.",
      }),
    ], cannotSee: "Event aliases, hit-test correctness and computed paint." },
  { id: "kit-reach-block", doctrine: "N7", pattern: /:hover/g,
    roots: [K + "**/*.css"], select: "reach", allow: [], cannotSee: "Cascade precedence and runtime reach transitions." },
  { id: "t-prose-ratchet", doctrine: "I6", pattern: /\bt-prose\b/g,
    roots: [W + "**/*.{ts,tsx}"], asOf: "2026-10-23",
    exclude: [W + "{doc,docs,guide,tutorial,help,chat}/**"],
    allow: allow({
      "routes/duct-loss.tsx": "Input labels, measured values, headings and equations name the calculation.",
      "duct/charts.tsx": "Caption labels the plotted law.",
      "components/work/band.tsx": "Recovery receipts, write conflicts and staged tallies support a decision.",
      "route/situation-verbs.tsx": "Outcomes and refusals disclose effects before a write.",
      "route/situation-grids.tsx": "Ledger values and log labels name machine state.",
      "route/schedules/stale-resolve.tsx": "Readback failure explains recovery before overwrite.",
      "workbench/moments.tsx": "Reader opens reasoning or a chat rendering failure.",
      "workbench/world/lane.tsx": "Reader explicitly expands a tool-result payload.",
      "route/help.tsx": "Tutorial body explains the route.",
      "route/flow.tsx": "Reader opens runtime relation inspection.",
      "route/situation-lamp.tsx": "Reader opens state inspection.",
      "route/situation-marks.tsx": "Reader opens state details.",
    }), max: {
      [W + "routes/duct-loss.tsx"]: 7,
      [W + "duct/charts.tsx"]: 1,
      [W + "components/work/band.tsx"]: 3,
      [W + "route/situation-verbs.tsx"]: 2,
      [W + "route/situation-grids.tsx"]: 1,
      [W + "route/schedules/stale-resolve.tsx"]: 2,
      [W + "workbench/moments.tsx"]: 2,
      [W + "workbench/world/lane.tsx"]: 1,
      [W + "route/help.tsx"]: 1,
      [W + "route/flow.tsx"]: 1,
      [W + "route/situation-lamp.tsx"]: 1,
      [W + "route/situation-marks.tsx"]: 1,
    }, cannotSee: "Unclassed prose and whether a sentence belongs in Tutorial." },
  { id: "nav-list-kit", doctrine: "N3", pattern: /<ul\b|<li\b|role=["']list["']/g,
    roots: [W + "**/*.tsx"], allow: allow({
      "components/lang/leg-strip.tsx": "Fixed receipt-stage chips have no picks or navigation.",
      "ducts/docs.tsx": "Tutorial prose has no row navigation.",
      "ducts/proto/e/preview-lines.tsx": "Static proposed-change and refusal text has no picks.",
      "lib/schema-to-field-render/field-metadata.tsx": "Static validation messages have no picks.",
    }), cannotSee: "Rows built by helpers; ListReading is the wave-4 kit reading name." },
  { id: "list-column-width-owner", doctrine: "L3",
    pattern: /const\s+\w*(?:COL|COLUMNS)\w*\s*=\s*\{[^;]*?\bw-\d|<[^>]*data-list-column[^>]*className=["'][^"']*\bw-\d/g,
    roots: [W + "**/*.tsx"], allow: [],
    cannotSee: "Aliased cell recipes, computed classes and rendered container-query layout." },
  { id: "list-owner", doctrine: "N4",
    pattern: /(?:setAttribute|removeAttribute)\(\s*["']data-landed["']|onChange:\s*\(search:\s*ListSearch/g,
    roots: [W + "**/*.{ts,tsx}"], allow: [], cannotSee: "Computed attributes; kit lang/land.ts owns arrival." },
  { id: "slash-owner", doctrine: "N3", pattern: /hotkey:\s*["']\/["']|bindings:\s*\[\s*["']\/["']\s*\]/g,
    roots: ["{apps,packages}/*/src/**/*.{ts,tsx}"], allow: [
      { glob: K + "components/lang/list-search.tsx", reason: "The list/search arbiter owns slash." },
      { glob: W + "chat/composer.tsx", reason: "Slash edits text and starts a skill menu inside the composer." },
    ], cannotSee: "Computed bindings and key aliases; lang/go-to.tsx uses the list arbiter." },
  { id: "native-title-hint", doctrine: "I5", pattern: /<title\b/g,
    roots: [W + "**/*.tsx"], allow: [], cannotSee: "SVG generated by helpers or inside kit." },
  { id: "crumb-handbuilt", doctrine: "I4", pattern: /data-e-crumb|^(?=[\s\S]*<ChevronRight\b)(?=[\s\S]*\b(?:crumb|breadcrumb)\b)/g,
    roots: [W + "**/*.{ts,tsx}"], allow: [], cannotSee: "Other glyphs and computed breadcrumbs." },
  { id: "picture-crumb-derived", doctrine: "I4", pattern: /<PaneCrumb\b[^>]*\bsegments\s*=/gs,
    roots: [W + "**/*.tsx"], allow: allow({
      "param-tables/variants/variant-e/view.tsx": "This table names a fixture substrate and parameter scope; it has no picture stage or readout from which to derive them.",
    }), cannotSee: "Spread props and aliases. Picture panes derive their scope, subject and selection in kit." },
  { id: "picture-subject-box", doctrine: "I5", pattern: /<SubjectBox\b/g,
    roots: [W + "**/*.tsx"], allow: [], cannotSee: "Aliases and spread-built providers; the picture pane supplies geometry through its reach channel." },
  { id: "scene-keys", doctrine: "N2",
    pattern: /hotkey:\s*["']F["']|how === "gesture" \? "replace" : "push"|navigateNativeHistory|hotkey:\s*["']Alt\+Arrow/g,
    roots: [W + "**/*.{ts,tsx}"], exclude: [W + "scene/**", W + "navigation/**"], allow: [],
    cannotSee: "Key aliases, callback-hidden navigation and actual camera/history behavior." },
  { id: "reading-list-adapter", doctrine: "N6", pattern: /.+/g,
    roots: [W + "**/*.{ts,tsx}"], select: "reading-rows", allow: [],
    cannotSee: "Cross-component props and imported projections; follows local aliases only." },
  { id: "row-revit-inferred", doctrine: "N4",
    pattern: /revit=\{\(\w+\)\s*=>\s*(?:\(?\w+(?:\.\w+)*\.(?:elementId|targetElementId)\s*==\s*null\s*\?\s*\[\]\s*:\s*)?(?:\[(?:\w+\.)+(?:elementId|targetElementId)\]|\w+\.ids)\)?\}/g,
    roots: [W + "**/*.tsx"], allow: [],
    cannotSee: "Named callbacks, composite projections and aliased identity fields." },
  { id: "revit-target-attr", doctrine: "N4",
    pattern: /\bdata-revit-ids\s*=|<[^>]*className="contents"[^>]*\{\.\.\.revit|<[^>]*\{\.\.\.revit[^>]*className="contents"/gs,
    roots: ["{apps,packages}/*/src/**/*.{ts,tsx}"], exclude: [K + "**"],
    allow: [], cannotSee: "Spread-built props and scope correctness; kit lang/revit-target.tsx owns declarations." },
];

const walk = (dir: string, rel = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      return ["node_modules", ".git", ".artifacts", "dist", "dist-installed", ".output"].includes(
        entry.name,
      )
        ? []
        : walk(join(dir, entry.name), path);
    return /\.(?:tsx?|css)$/.test(path) && !/\.test\./.test(path) ? [path] : [];
  });
const sources = ["apps", "packages"]
  .flatMap((kind) =>
    readdirSync(join(ROOT, kind)).flatMap((name) => {
      const src = `${kind}/${name}/src`;
      return existsSync(join(ROOT, src)) ? walk(join(ROOT, src), src) : [];
    }),
  )
  .filter(
    (path) =>
      !/\/(?:prototypes|lab|design-system)\//.test(path) &&
      !path.startsWith(W + "routes/design-system"),
  );
const bytes = new Map(sources.map((path) => [path, readFileSync(join(ROOT, path), "latin1")]));
const matches = (path: string, globs: string[]) => globs.some((glob) => matchesGlob(path, glob));
const selectorMatches = (classes: string, selector: string) =>
  selector
    .slice(1)
    .split(/\.(?!\d)/)
    .every((token) => classes.split(/\s+/).includes(token));

// Follow local aliases to the read that produced rows, rather than banning unrelated readings in a file.
function unadaptedReadings(source: string): string[] {
  const file = ts.createSourceFile(
    "rows.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const bindings = new Map<ts.Node, Map<string, ts.Expression | undefined>>();
  const scope = (node: ts.Node): ts.Node =>
    ts.isFunctionLike(node) || ts.isSourceFile(node) ? node : scope(node.parent);
  const bind = (node: ts.Node, name: string, value?: ts.Expression) => {
    const owner = scope(node);
    if (!bindings.has(owner)) bindings.set(owner, new Map());
    bindings.get(owner)!.set(name, value);
  };
  const visit = (node: ts.Node, act: (node: ts.Node) => void) => {
    act(node);
    ts.forEachChild(node, (child) => visit(child, act));
  };
  visit(file, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      bind(node, node.name.text, node.initializer);
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) bind(node, node.name.text);
  });
  const fromReading = (node: ts.Node, seen = new Set<ts.Node>()): boolean => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "listOf") return false;
    if (ts.isCallExpression(node) && node.expression.getText(file) === "previousOf") return true;
    if (ts.isPropertyAccessExpression(node) && ["observation", "previous"].includes(node.name.text))
      return true;
    if (ts.isIdentifier(node)) {
      let owner = scope(node);
      while (true) {
        const local = bindings.get(owner);
        if (local?.has(node.text)) {
          const value = local.get(node.text);
          return !!value && !seen.has(value) && fromReading(value, new Set([...seen, value]));
        }
        if (ts.isSourceFile(owner)) return false;
        owner = scope(owner.parent);
      }
    }
    return ts.forEachChild(node, (child) => fromReading(child, seen) || undefined) ?? false;
  };
  const hits: string[] = [];
  visit(file, (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "useList") {
      const options = node.arguments[0];
      if (options && ts.isObjectLiteralExpression(options)) {
        const items = options.properties.find((prop) => prop.name?.getText(file) === "items");
        if (items && fromReading(items)) hits.push(items.getText(file));
      }
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      if (!["Table", "List", "ListPopup", "ListView"].includes(node.tagName.getText(file))) return;
      for (const prop of node.attributes.properties)
        if (
          ts.isJsxAttribute(prop) &&
          ["rows", "items", "list"].includes(prop.name.getText(file)) &&
          prop.initializer &&
          fromReading(prop.initializer)
        )
          hits.push(prop.getText(file));
    }
  });
  return hits;
}

it.each(RULES)("$id ($doctrine)", (rule) => {
  const used = new Set<Allow>();
  const violations: string[] = [];
  let reachBlocks = 0;
  for (const path of sources.filter(
    (path) => matches(path, rule.roots) && !matches(path, rule.exclude ?? []),
  )) {
    let source = bytes.get(path)!;
    if (rule.select === "reach") {
      const blocks = source.match(REACH_BLOCK) ?? [];
      reachBlocks += blocks.length;
      if (blocks.length) {
        expect(path).toBe(K + "components/lang/lang.css");
        expect(blocks).toHaveLength(1);
        for (const rung of ["rest", "reach", "hover", "focus"])
          expect(blocks[0]).toContain(`data-reach="${rung}"`);
      }
      source = source.replace(REACH_BLOCK, "");
    }
    if (rule.select === "hover-css") source = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const values =
      rule.select === "reading-rows"
        ? unadaptedReadings(source)
        : rule.select === "classes"
          ? [...source.matchAll(/\bclassName=["']([^"']*)["']/g)].map((m) => m[1]!)
          : rule.select === "hover-css"
            ? [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
                .filter((m) => /:(?:hover|focus(?:-visible|-within)?)/.test(m[1]!))
                .map((m) => m[2]!)
            : [source];
    const hits = values.flatMap((value) => [...value.matchAll(rule.pattern)].map(() => value));
    let allowed = 0;
    for (const hit of hits) {
      const entry = rule.allow.find(
        (entry) =>
          matchesGlob(path, entry.glob) &&
          (!entry.selector || selectorMatches(hit, entry.selector)),
      );
      if (entry) {
        used.add(entry);
        allowed++;
      } else violations.push(path);
    }
    if (rule.max?.[path] !== undefined && allowed > rule.max[path]!)
      violations.push(`${path}: ${allowed} > ${rule.max[path]} (${rule.asOf})`);
  }
  if (rule.select === "reach") expect(reachBlocks).toBe(1);
  const stale = rule.allow.filter((entry) => !used.has(entry)).map((entry) => entry.glob);
  expect(
    { violations, stale },
    `${rule.id} / ${rule.doctrine}: cannot see ${rule.cannotSee}`,
  ).toEqual({ violations: [], stale: [] });
});
