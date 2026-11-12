# Homes glossary

Canonical language for content homes, tiered values, guards and secrets ([ADR 0037](../../adr/0037-three-content-homes-one-write-door.md), [ADR 0038](../../adr/0038-consent-is-a-notice-three-guards-on-project-documents.md), [ADR 0039](../../adr/0039-two-failure-policies-by-class.md)). The shapes are rulings of 2026-11-11 and are not built yet.

## Places

**Home**:
A folder that holds authored content and carries the marker file `pe-home.json`. The folder name is its display name.
_Avoid_: root, drawer, place, shared root; "home" for the T3 home, the product home override or the agent's working directory

**Tier**:
The one field of the marker: `user`, `project` or `firm`. It says whose content the home holds.
_Avoid_: scope, level, layer (a layer is a value tier)

**Firm home**:
The one home of tier `firm`, at `04 PE Software Files\Pe.Tools` on the shared drive. It also holds `keys.json`.
_Avoid_: shared root, team folder

**Project home**:
The child folder `Pe.Tools` inside the project folder the humans use. Pea's view of the project is the whole human folder.
_Avoid_: project root, job folder, a mirror of the cloud project

**Layout**:
The fixed set of folders in every home: `Pods/`, `Pages/`, `Catalogs/` and `Settings/<owner>.json`.
_Avoid_: `Firm/` (the old name of `Settings/`)

**Home list**:
The ordered homes one target document resolves to: user, the project home of the open model, firm.
_Avoid_: content roots, search path

**Project pointer**:
The value stored in a model that names its project home, as a path with no drive letter relative to the shared drive root. It is one owner blob in the in-model carrier.
_Avoid_: binding file, cloud index, project id

**Unbound**:
A model with no project pointer, or a machine with no firm home. Both must work.
_Avoid_: orphan, offline

## Writing

**Write door**:
The one function that writes into a home. It is a compare-and-swap on SHA-256 and writes to the home the thing came from.
_Avoid_: save path, copy-on-write, publish

**Safety net**:
The prior bytes of an overwritten shared file, kept in the writer's local blob store, with their hash in the receipt.
_Avoid_: backup, undo, version history (that is Drive's own second net)

**Fork**:
An explicit copy of a pod into another home under a new id.
_Avoid_: shadow, override, user copy

**Derived file**:
A write-once file in a project home's `Derived/` folder (or the machine's `state\Derived` for a source in no project), named `<key>.<sha256 of its own bytes>`. The key hashes the source bytes with the producer's identity and revision, so a second person finds it; a file whose name does not match its bytes is discarded with one notice.
_Avoid_: cache, output (run output never lives in a home)

## Values

**Value tier**:
One layer a value can come from, most specific first: `run`, staged `Work`, saved in model, `project`, `firm`, `default`.
_Avoid_: scope, home tier (a home has a tier; a value has a value tier)

**Setting**:
A value that resolves across value tiers, declared as the sheet binding kind `setting(owner, path, schema, tiers)`.
_Avoid_: preference, option; "setting" for per-user view state or for the ADR 0026 Page field role

**Save at**:
The verb that makes a staged value shared, with three targets: model, project, firm.
_Avoid_: publish, promote

**Owner**:
The route or library that owns one `Settings/<owner>.json` file in each home.
_Avoid_: module, namespace

## Failure and safety

**Class**:
The failure policy of a stored kind: `keep` (refuse and keep the bytes) or `discard` (delete with a notice). T3's files are a third class, `foreign`, that Pe never decodes.
_Avoid_: type, category, a class table in code

**Guard**:
One of exactly three acts on a project document that Pea leaves to the person: synchronize with central; overwrite or discard a person's model state; send outward.
_Avoid_: gate, permission, approval, guardrail

**Held**:
The immediate return of a guarded call. Pea is told the act waits for the person, never that the person refused.
_Avoid_: pending, blocked, denied, refused

**Notice**:
A line in the host's one notice feed that tells a person what Pea did or what is held. It asks nothing.
_Avoid_: prompt, consent window, toast

**Honest limit**:
The written statement that guards cover Pea's own doors only. A shell command gets past them, so they catch mistakes and not adversaries.
_Avoid_: sandbox, security boundary

## Secrets and threads

**Secret role name**:
The stable name of a secret by what it is for: `openai.api-key`, `anthropic.api-key`, `llamaparse.api-key`.
_Avoid_: a name derived from a provider's display name

**Subscription**:
A person's own harness login. It rests in the harness's own home and is not a Pe secret.
_Avoid_: personal key (a personally entered API key is a different thing)

**Thread ref**:
A thread or run id with its engine tag (`acp` or `t3`). Nothing authored holds one, and one used in a path is hashed.
_Avoid_: thread id as a folder name

**Engine**:
The program that runs agent threads: Pe's ACP harness host today, T3 after a cutover.
_Avoid_: harness (a harness is Claude Code or Codex), runtime
