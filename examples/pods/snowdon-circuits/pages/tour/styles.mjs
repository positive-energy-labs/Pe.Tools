export const worksheetCss = `
.snowdon-circuits { width: 100%; min-width: 0; max-width: 1280px; box-sizing: border-box; margin: auto; padding: 32px; }
.snowdon-circuits .mast, .snowdon-circuits .heading, .snowdon-circuits .summary, .snowdon-circuits .section-head, .snowdon-circuits .foot { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.snowdon-circuits .mast { border-bottom: 1px solid var(--pe-line-2); padding-bottom: 12px; }
.snowdon-circuits .eyebrow { font-size: var(--type-small-size); letter-spacing: var(--track-upper); text-transform: uppercase; color: var(--pe-ink-2); }
.snowdon-circuits .heading { margin: 32px 0 24px; }
.snowdon-circuits h1 { font: var(--weight-medium) var(--type-display-size)/var(--type-display-line-height) var(--font-display); margin: 0 0 8px; }
.snowdon-circuits h2 { font-size: var(--type-title-size); font-weight: var(--weight-strong); margin: 0; }
.snowdon-circuits p { margin: 0; }
.snowdon-circuits .muted { color: var(--pe-ink-2); }
.snowdon-circuits .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.snowdon-circuits .workspace { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 1fr); gap: 24px; margin-top: 28px; }
.snowdon-circuits .workspace > *, .snowdon-circuits .fields > * { min-width: 0; }
.snowdon-circuits .section-head { margin-bottom: 12px; }
.snowdon-circuits .summary { padding: 20px 0; border-top: 1px solid var(--pe-line-2); border-bottom: 1px solid var(--pe-line-2); margin-bottom: 20px; }
.snowdon-circuits .metric { font: var(--weight-regular) var(--type-display-size)/var(--type-display-line-height) var(--font-mono); margin-top: 6px; }
.snowdon-circuits .unit { font-size: var(--type-title-size); color: var(--pe-ink-2); margin-left: 4px; }
.snowdon-circuits .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 20px; }
.snowdon-circuits .field { display: grid; gap: 6px; }
.snowdon-circuits .field:first-child { grid-column: 1 / -1; }
.snowdon-circuits .artifact-body { min-height: 280px; }
.snowdon-circuits .artifact-body > .dl-code-frame { border: 0; }
.snowdon-circuits .notes { padding: 16px 20px; border-top: 1px solid var(--pe-line); }
.snowdon-circuits .diagram { margin-top: 24px; }
.snowdon-circuits .foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--pe-line-2); }
.snowdon-circuits .comparison { min-height: 300px; }
.snowdon-circuits .comparison [data-slot="table"] { min-height: 0; }
.snowdon-circuits .result-note { margin-top: 8px; }
.snowdon-circuits table[aria-label="Electrical circuits"] { min-width: 1200px; }
.snowdon-circuits table[aria-label="Electrical circuits"] td { padding-inline: 8px; }
.snowdon-circuits .error { padding: 20px 0; color: var(--pe-alarm); }
.snowdon-circuits .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.snowdon-circuits .target { display: flex; gap: 12px; align-items: center; margin: 20px 0; }
.snowdon-circuits .target input { width: 100px; }
.snowdon-circuits .proposal { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; margin-top: 24px; }
.snowdon-circuits .proposal > * { min-width: 0; }
.snowdon-circuits .capture { margin: 24px 0; }
.snowdon-circuits .capture img { display: block; max-height: 560px; width: 100%; object-fit: contain; background: white; }
.snowdon-circuits .capture figcaption { margin-top: 8px; }
@media (max-width: 1000px) { .snowdon-circuits { padding: 24px; }
.snowdon-circuits .workspace { grid-template-columns: minmax(0, 1.2fr) minmax(300px, 1fr); gap: 16px; }
.snowdon-circuits .metric { font-size: var(--type-head-size); } }
@media (max-width: 720px) { .snowdon-circuits { padding: 16px; }
.snowdon-circuits .workspace { grid-template-columns: 1fr; }
.snowdon-circuits .heading, .snowdon-circuits .foot { align-items: flex-start; flex-direction: column; }
.snowdon-circuits .mast { flex-wrap: wrap; } }`;
