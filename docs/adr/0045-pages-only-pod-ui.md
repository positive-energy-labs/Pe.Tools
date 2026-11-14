# Pages are the only Pod UI

## Context

The owner ruled on 2026-11-14: "i still lean yes. ... I frankly still do not understand any benefit pod routes give. since they need build and version match, that kills tons of flexibiliity, which is the entire reason I want teirs below real routes. pods+pages seem better in every way to me".

Compiled Pod routes required published executable closures and content-pinned admission for browser and Node code. Their kernel Work and slots were useful integration, but they did not uniquely provide React, native reads, calculation or export. Maintaining a second UI tier constrained portable authoring without a demonstrated product need.

## Decision

A Pod is `pod.json` plus Pages plus C# scripts and the files they use. Pages are the only Pod UI. They use the existing native read doors and declared scripts, share their Page event log, and use `pe.diff` for inspectable heals. They require no route publisher, artifact or host Node module enrollment.

This supersedes ADR 0030's Pod-route promotion part. ADR 0035's kernel slots, Work and History apply to builtin routes, not Pod Pages. The builtin kernel, directory generator, Vite refresh plugin and builtin source-closure projection remain.

## Consequences

Snowdon's circuit tour owns the voltage-drop worksheet and current `pe.state` API. Hydronic's plain sizing Page reuses the sizing math and native system/segment reads and declares its diameter heal. Page state deliberately replaces typed Work; kernel Sheet/Goal/Picture and app History are not ported.

Existing Pod-route Work files remain on disk untouched and simply stop having a reader. This change neither migrates nor deletes user data. Old `/tool/<key>` links cease to open.

Hydronic firm settings (`Settings/hydronic.json`, formerly `ctx.files.firm`) and marked pictures remain owed. Its visible local default is 400 Pa/m and 1.5 m/s. Live Pages currently run in unsandboxed same-origin iframes (`ts/apps/web/src/pages-bind/mount.tsx`); caller admission is not a JavaScript containment boundary. Isolation is separate work, and deletion makes no claim that arbitrary Pages are safe untrusted code.
