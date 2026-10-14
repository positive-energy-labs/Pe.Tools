# Voltage drop Page

Open `index.html` directly, or copy this folder to `<PE_TOOLS_PRODUCT_HOME>/Pages/voltage-drop/` and open `/pages/voltage-drop/`. The shipped HTML contains React, the actual app kit, the calculator source, styles, and Mermaid rendering. It needs no server, credentials, fonts, or CDN. Inputs and the selected artifact tab travel in the URL fragment.

Edit `page.js` for the interface, `calc.mjs` for the calculation, and `index.source.html` for layout. From `ts`, run `pnpm --filter @pe/kit build` to regenerate the portable HTML, then `pnpm --filter @pe/kit test`. The packager embeds the exact authored calculation and interface in the Source tab. These source files remain beside the HTML for route promotion.

The consumer writes ordinary JavaScript with `pe.kit.h`. `@pe/kit` supplies the app's actual `Picker`, `Input`, `Table`, `Code`, `Mermaid`, `ArtifactFrame`, `PaneTabs`, and `Button`. This first-round spike bundles those app-owned components through a package facade. It is not an independently publishable package yet. A full extraction must move their ownership out of the web app and remove its `#` alias dependency. Host-owned `/pages/pe.js` is unchanged; its eventual kit loader should deliver these same bytes. This local calculator does not load Revit doors or persist shared host state.

The [IAEI copper K method](https://iaeimagazine.org/2017/march2017/voltage-drop-formulas/) uses K = 12.9 at 75 °C, one-way feet, amperes, and circular-mil area. The example assumes unity power factor and negligible reactance. Three-phase inputs mean a balanced load and line-to-line voltage. The 3% comparison is an example design target. Ampacity, derating, motor starting, and code compliance need separate evaluation.

Browser acceptance from `ts/packages/kit`:

```powershell
node tests/browser.mjs http://127.0.0.1:<port>/pages/voltage-drop/ <evidence-directory>
```

The walk uses Playwright with installed Edge, closes its browser, checks arithmetic through interactions, restores a tab from the URL, captures 1440/900 light/dark screenshots, and opens the portable file with network requests blocked. It records inherited hotkey-registration warnings separately from errors. The package facade deliberately does not modify app-owned keyboard machinery.
