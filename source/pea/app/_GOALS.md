# pea app Goals

## North Star

The TypeScript app exposes two clearly separated agent products: Pea as the deployed Revit/operator workbench, and Peco as the Pe.Tools repo coding agent with high-quality product-verification access but no repo posture leaking into Pea.

## User Goals

- Start deployed operator work with `pea agent` and see only Revit/product-facing Pea posture.
- Start repo source work through one TS-owned Peco command without needing another broad PATH surface.
- Let Peco use Pea as a black-box feedback harness: pose operator-like work, observe product/harness behavior, and revise source.
- Keep `pe-dev` available for narrow helper fallback where it remains the owning surface, but never require it to launch Peco or run live-loop sync/restart.

## Developer Goals

- Preserve normal MastraCode modes, subagents, tools, memory, and TUI behavior for Peco.
- Keep Pea runtime policy explicit: `.pea` config, Pea instructions, Pea product tools, Pea bundled skills, MCP disabled by default.
- Keep Peco runtime policy explicit: project-scoped config/skills, MastraCode coding defaults, Pea product tools, and only narrow repo verification tools.
- Encode complex repo workflows as Peco-only skills instead of expanding tool count.
- Make verification wrappers report provenance: executable/path, cwd, exact command, execution policy, timing, exit code, output tails, and artifact paths where applicable.

## Integration Goals

- Use `Pe.Host`, scripting, host operations, logs, and Revit API docs as the product-observation boundary.
- Use TypeScript Pe.RiderBridge helpers for AttachedRrd sync/restart, keep `pe-dev test` as the FreshRevitProcess helper boundary, and keep `./build` only for packaging/release proof.
- Install Pea bundled skills only under `.pea/skills`.
- Install Peco repo workflow skills only into normal project-scoped MastraCode skill roots for this repo.
- Reuse generated product layout values where helpful without making Peco depend on installed `pe-dev`.

## Non-Goals

- Pea is not a repo source reviewer, repo build/test runner, or Peco persona.
- Peco should not replace normal MastraCode coding tools with custom wrappers.
- Repo verification tools should not become a large duplicate of `pe-dev` or `dotnet`.
- Isolated compile/package proof should not be described as live RRD freshness.
- The installed Pea runtime should not load Peco skills, repo instructions, or repo workflow tools.
