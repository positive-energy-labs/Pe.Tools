# substrate ledger

The substrate is the declared set of tools, runtimes, tasks, env, and dotfiles that makes a Pe.Tools dev machine reproducible on Windows and macOS. mise is its base. Wave evidence lives in `.artifacts/mise-swarm/` (gitignored).

## Decided
- 2026-10-05, mise is the substrate, adopted in stages. The core (tools, `mise.lock`, a small task table) lands first; `mise bootstrap`, `mise dot`, `mise skills`, and daemons wait for a Windows proof. kaitpw: "staged is fine, im not naive enough to think that our first try will be perfect".
- 2026-10-05, two mise configs. The repo `mise.toml` holds repo tools that have no GUI; `~/.config/mise/config.toml` holds general user tools. Runtimes appear in both, and the repo pin wins inside the repo. GUI apps go to a per-OS app manifest, because mise does not install GUI apps.
- 2026-10-05, mise owns `node`, provisionally, until the Windows kill test in Owed passes or fails. A pass reverses the Vite+-owned Node ruling at `docs/BUILD.md:320`. kaitpw: "vp's node management on windows seems a little fragile".
- 2026-10-05, the shipped Pea and Pe.Host runtime moves off end-of-life Node 25.7.0 to Node 26 (LTS from 2026-10-28), in its own wave.
- 2026-10-05, PATH has one owner per entry, and a doctor check fails on drift. The Machine-scope shadowers (nvm4w, Python313, the Chocolatey bin) go by uninstalling their owners, not by editing PATH by hand; one admin step then removes the dead Cursor and Rider entries. The Volta, Roaming\npm, and Programs\nodejs entries are not in the registry: T3 Code injects them at launch. kaitpw: "i rly need to find a long term solution for path management".
- 2026-10-05, take toolchain upgrades and fix the repo and the environment to match; PowerShell 7 is installed on that basis. kaitpw: "forgoing these types of upgrades is how a repos goes stale and unmaintainable".
- 2026-10-05, tasks default to TypeScript, not PowerShell or Python. Several runners are expected, because the mise `github:` backend will manage some local tools and possibly libraries. kaitpw: "pwsh quoting never seems to work".
- 2026-10-05, user-global agent configs go to a new private dotfiles repo; `kaitpw/config` stays public for shareable config.
- 2026-10-05, `Pe.Revit.Sdk` gets a private GitHub remote and a private NuGet feed now; a nuget.org release is the final target, later.
- 2026-10-05, the substrate serves 1-2 macOS machines and 2-3 Windows machines; 2 Windows machines run Revit. All are owner-administered, so admin steps are allowed.

## Tried & rejected
- 2026-10-05, an `http:` mise tool that hydrates a zip of nupkgs as a folder feed. Restore fails repo-wide (MSB4236, NU1301) when `PE_FEED` is unset on a cold cache.
- 2026-10-05, dotagents for skills distribution. It needs file symlinks, and Developer Mode is off.
- 2026-10-05, a git submodule for the public config fragment. `mise bootstrap --adopt` leaves the submodule empty.
- 2026-10-05, env-var-only isolation for agent trials of mise and Vite+. vp 1.0.0 ignores `VP_HOME` and wrote the real `~/.vite-plus`; a shim call without `MISE_*` installed into the real `%LOCALAPPDATA%\mise`.

- 2026-10-05, `trusted_config_paths = ["~/source/repos"]` as the trust posture. In normal mode a hostile clone in `%TEMP%` showed `untrusted` and its `_.source` script still ran on the first shim call; mise then recorded the clone as trusted. The setting only matters with `paranoid = true`. Also `.explore/` clones live inside Pe.Tools, so any path root includes them. PROVEN[trial, `.artifacts/runs/mise-trial-20261005/exp-trust`, bd50cb55, 2026-10-05].
- 2026-10-05, `not_found_auto_install = false` as the defense against a shim installing into a fresh data dir. The shim still installed jq in 1.1 s. `auto_install = false` (`MISE_AUTO_INSTALL=0`) is the switch that works: the shim warns and falls through to PATH. PROVEN[trial, `exp-autoinstall`, 2026-10-05].
- 2026-10-05, the registry name `tokei`. Its default backend is cargo and needs rust. `github:XAMPPRocky/tokei` installs the release exe in 1.3 s.

## Owed
- Rotate the OpenAI project key that sits in plaintext in the Zed, VS Code, and Cursor configs and in user env. Move it behind an env-reading launcher before any dotfile manager tracks those files. The key also appears in past session transcripts under `~/.claude/projects`.
- Give `Pe.Revit.Sdk` a private remote after a secrets scan of its history; publish the SDK family to a private feed; make Pe.Tools CI restore from it.
- Node kill test, two arms: Vite+ with `ts/.node-version` against mise-owned Node. Each arm runs `vp run -r test`, `pnpm verify`, a `Pe.Dev.Cli` launch, and `vp pack` from a non-interactive Claude and Herdr shell. Wave 2 found the observed 25.7.0 pin comes from a stale `~/.vite-plus/.session-node-version` (written 2026-06-16), not from vp fragility.
- `pnpm --dir ts verify` is red at `bd50cb55` on Node 25.7.0 and 26.10.0 alike (knip on `peaClaudeSkillsRoot`, 6 guard files). Every Node claim needs it green first.
- `product.payloads.json:113` and `product-mirror.test.ts:114` call `corepack`, which Node 25+ does not ship.
- mise trust posture: `trusted_config_paths` alone is dead (Tried & rejected). Open ruling: `paranoid = true` plus a `mise trust` step in worktree tooling, with or without shims off the agent PATH. Land `auto_install = false` in the user config before any shim reaches a registry PATH.
- fallow as a factory sensor: `github:fallow-rs/fallow` 3.31.0 installs in 2.9 s and `fallow health --format json` over `ts/` takes 2.4 s (387 findings, score 63.2). It writes a cache at `ts/.fallow`, which must be gitignored before it lands. Reading: `.artifacts/runs/mise-trial-20261005/exp-fallow/health.json`.
- The page kit's `check.py` got an empty DOM from Edge 154 headless on this box; Chrome renders. The kit now falls through to the next browser on an empty dump.
- Candidate `mise.toml`, `mise.lock`, and task layer sit on local branches `mise/tools-trial` and `mise/tasks-trial`; wave evidence is in `.artifacts/mise-swarm/w2/SYNTHESIS.md`.
- Node 26 wave: `pnpm verify` and `vp pack` pass on an exact 26.x pin; the shipped executables embed it.
- PATH admin cleanup, then the PATH doctor check.
- Install PowerShell 7; record how Claude Code, Codex, T3, and Herdr shells change.
