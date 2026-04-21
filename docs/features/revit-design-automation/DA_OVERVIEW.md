# Revit Design Automation Overview

## Purpose

This document explains the nature of Autodesk Design Automation for Revit as it matters to `Pe.Tools`: what the service is, what boundaries it imposes, which APS services it touches, where responsibilities should live in this repo, and why.

The audience assumption is: you already understand software architecture and Revit add-ins. The goal here is not to teach basics, but to make the cloud/runtime boundary legible enough that design decisions stop feeling arbitrary.

## Mental Model

Design Automation for Revit is best thought of as:

- a **headless Revit runtime**
- launched by an **APS workitem**
- configured by an **activity**
- supplied with code via an **appbundle**
- connected to files through **declared inputs and outputs**
- destroyed after the workitem finishes

That last point matters most. DA is **stateless compute**, not a long-lived application host. It can consume packaged inputs and produce durable outputs, but the compute instance itself should be treated as disposable.

In `Pe.Tools`, the practical mental split is:

- `Pe.App` = desktop shell
- `Pe.Dev.RevitAutomation.Worker` = DA shell
- `Pe.Dev.RevitAutomation` = local orchestration around DA 
- `Pe.Revit.Global` and other DA-safe packages = shared runtime graph beneath both shells

## What DA Is Good At

DA is a strong fit when the job is:

- document-bounded
- deterministic
- non-interactive
- artifact-producing
- parallelizable across many models

That matches the collections well:

- one cloud model per workitem
- open model
- run a document-owned collector
- emit JSON
- download artifact later

## What DA Is Not

DA is not:

- a desktop session
- a ribbon host
- a long-lived service process
- a place to run `Pe.App` startup unchanged
- a good home for UI/session-dependent logic (no WPF, no UIApplication)
- a good place to improvise side effects outside declared input/output flows

`IExternalDBApplication`, a requirement of DA, intentionally disallows/errors on these things, unlike the usual `IExternalApplication` for desktop/UI. In DA, the worker should subscribe to `DesignAutomationReadyEvent`, do the bounded job, and exit.

## Service Boundary Maps

The current DA flow touches several distinct systems. They should not be mentally collapsed into one "cloud thing."

### ACC / BIM 360 Docs

This is where the Revit cloud models live.

Use it for:

- project/folder/item/version browsing
- locating cloud models
- deriving the `projectGuid` and `modelGuid` needed for Revit cloud-open

Do not confuse ACC storage with APS OSS. They serve different roles. ACC's API is the APS Data Management API, which is to say theres no API product with the "ACC" or "BIM 360" name

### APS Data Management API

This is the browse/discovery layer in front of ACC/BIM 360 Docs.

Use it for:

- hubs
- projects
- folders
- items
- versions
- extracting `projectGuid` and `modelGuid` from Revit item/version metadata

In this repo, `discover-models` belongs here conceptually, even though the operator entrypoint is `pe-dev revit automation ...`.

### APS Automation API

This is the control plane for DA itself.

Use it for:

- appbundle CRUD
- activity CRUD
- workitem submission
- workitem status
- report fetch

This is where orchestration lives, not model discovery.

### APS OSS

Object Storage Service is APS file storage.

Use it for:

- workitem input artifacts when needed
- workitem output artifacts
- durable machine-readable results outside the ephemeral DA runtime

Important distinction:

- DA compute is stateless
- OSS objects are durable according to bucket policy

That is not a contradiction. Stateless compute can still read packaged inputs and write files to durable storage.

For OSS retention policy, APS documents three bucket modes:

- `transient`: objects older than **24 hours** are removed automatically
- `temporary`: objects older than **30 days** are removed automatically
- `persistent`: retained until explicitly deleted

Current `Pe.Tools` DA result download flow uses a transient OSS bucket, so OSS should be treated as a transport layer and short-lived artifact handoff, not a permanent archive.

## Authentication Boundary

The current Revit DA flow intentionally uses multiple tokens with different responsibilities.

### Management token

Use a 2-legged token for:

- appbundle management
- activity management
- workitem submission
- workitem inspection

This is orchestration-only auth.

### User-context token

Use a 3-legged delegated token for:

- opening the actual ACC/BIM 360 cloud model inside Revit DA

This is model-access auth.

### Artifact token

Use an OSS-capable token for:

- creating/ensuring bucket access
- downloading or uploading result objects

The important point is that these are different concerns. Do not blur them into one giant “automation token.”

## Packaging Boundary

The packaging story has three separate layers:

### Worker assembly

This is your actual DA add-in code.

### Appbundle

This is the DA-deployable package APS downloads for the engine. It includes:

- the `.bundle` root
- `PackageContents.xml`
- `.addin`
- worker binaries and dependencies

### Activity

This is the executable job definition that says:

- which engine to use
- which appbundle(s) to load
- which command line to run
- which named arguments exist

The appbundle is durable package input to a stateless workitem. The workitem instance itself is still disposable.

## Responsibility Split In This Repo

The clean split for `Pe.Tools` is:

### `Pe.App`

Own:

- ribbon/UI
- interactive commands
- host bridge
- scripting session behavior
- anything that depends on `UIApplication` or user session state

Do not try to upload this startup path into DA unchanged.

### `Pe.Dev.RevitAutomation.Worker`

Own:

- `IExternalDBApplication` entrypoint
- `DesignAutomationReadyEvent` hook
- job input parsing
- document open/close
- workload dispatch
- artifact write
- stdout markers for diagnostics

Keep it thin. The worker should feel like a job host, not a second application.

### `Pe.Dev.RevitAutomation`

Own:

- token acquisition
- appbundle build/upsert
- activity upsert
- workitem submit
- status inspection
- report parsing
- OSS artifact download
- batch submission
- ACC/Data Management discovery used by the CLI

This is the correct place for orchestration because it lives outside the DA runtime and can absorb APS/API complexity without polluting the worker.

### Shared runtime packages

Own:

- document-owned collectors
- DA-safe Revit helpers
- shared contracts
- serialization and result models

These packages must stay usable by both desktop and DA shells.

## Dependency Rule

The most important architectural rule is:

- **desktop and DA are sibling shells over a shared DA-safe runtime graph**

More concretely:

- both shells may depend on shared runtime packages
- shared runtime packages must not depend back on either shell
- DA-safe code must not depend on UI/session-only behavior

That means no:

- `UIApplication`
- WPF
- ribbon helpers
- desktop bridge assumptions
- “active document” session services

inside collector paths that the worker needs.

One concrete example from this repo: formula collection initially leaked through a UI-only session helper. That had to be refactored to a headless document/application-owned seam before DA parameter collection could succeed.

## Input / Output Rule

DA behaves best when inputs and outputs are explicit.

Preferred pattern:

- declare job input envelope
- declare artifact output
- run bounded work
- write machine-readable artifact

Avoid treating `report.log` as the primary result channel. Logs are for:

- diagnostics
- classification
- progress hints

Artifacts are for:

- actual output contracts
- downstream wrangling
- stable machine consumption

## Network Rule

A good default rule for Revit DA workers is:

- keep arbitrary network behavior out of the worker
- prefer APS-declared inputs and outputs
- prefer local orchestration to fetch and prepare upstream data

This keeps the worker:

- deterministic
- easier to debug
- less coupled to external service failures
- easier to secure and reason about

If upstream data is needed, the better shape is often:

- fetch/cache it outside DA
- pass it in as an input artifact
- let the worker stay focused on document work

That matters for features like parameter caching or external lookups. The worker should not quietly become a general network client just because it technically can make HTTP calls.

## Batch Shape

For the current use case, the right batch model is:

- **one workitem per cloud model**

Why:

- natural failure isolation
- clean artifact ownership
- parallelization is simple
- retries are simple
- result wrangling stays model-scoped

Multi-model orchestration belongs outside the worker, in `Pe.Dev.RevitAutomation`.

## Rate Limits and Status

Polling workitems too aggressively does not scale. APS has enforced rate limits on `GET workitems/:id`, and Autodesk explicitly recommends reduced-call alternatives such as batched status or callback-based approaches.

So:

- do not treat tight-loop polling as an architectural primitive
- keep status strategy in orchestration, not in the worker

## Why OSS Matters For This Repo

Without OSS, you can still run DA, but your result handoff gets much worse.

You would be reduced to:

- scraping logs
- parsing report text
- reconstructing outputs from noisy channels

OSS gives you:

- explicit artifact handoff
- one JSON result per model
- transport decoupled from runtime
- durable enough output for local retrieval and later wrangling

That is exactly the right shape for the current collection problem.

## Recommended Design Rules

- Keep the DA worker thin.
- Keep UI/session code out of DA-safe collector paths.
- Keep orchestration outside the worker.
- Use Data Management for discovery, Automation for execution, OSS for artifacts.
- Prefer one workitem per model.
- Prefer JSON artifacts over stdout-driven outputs.
- Treat `Pe.App` and the DA worker as siblings, not as the same app in different packaging.
- Treat OSS as a handoff/storage layer, not as the model source of truth.

## Sources

### Autodesk / APS

- APS Automation overview  
  https://aps.autodesk.com/developer/overview/design-automation-api

- Revit Automation API landing page  
  https://aps.autodesk.com/apis-and-services/design-automation-api-revit

- APS blog: Revit cloud model support in Design Automation  
  https://aps.autodesk.com/blog/design-automation-api-supports-revit-cloud-model

- APS blog: Automation OAuth `code:all` scope  
  https://aps.autodesk.com/blog/automation-api-enforcing-oauth-scope

- APS Data Management tutorial: hubs / projects / folders / items / versions  
  https://get-started.aps.autodesk.com/tutorials/hubs-browser/data/

- APS Data Management overview  
  https://aps.autodesk.com/data-management-api

- APS OSS retention policy example and bucket policy summary  
  https://get-started.aps.autodesk.com/tutorials/simple-viewer/data/

- APS OSS direct-to-S3 migration background  
  https://aps.autodesk.com/blog/data-management-oss-object-storage-service-migrating-direct-s3-approach

- APS blog: batched / reduced-call workitem status guidance and rate limits  
  https://aps.autodesk.com/blog/design-automation-get-workitemsid-will-be-enforced-rate-limit-150-rate-minute-rpm

- APS blog: `adskMask` for secure debug logs  
  https://aps.autodesk.com/blog/introducing-adskmask-secure-debugging-automation

- APS blog: posting Automation output to your own endpoint  
  https://aps.autodesk.com/blog/design-automation-and-azure-function-service

### Revit API

- Revit API cloud files overview  
  https://help.autodesk.com/cloudhelp/2021/ENU/Revit-API/files/Revit_API_Developers_Guide/Introduction/Application_and_Document/Revit_API_Revit_API_Developers_Guide_Introduction_Application_and_Document_CloudFiles_html.html

- Revit API: `ModelPathUtils.ConvertCloudGUIDsToCloudPath`  
  https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API-MainReference/files/html/aa710231-4cab-98ba-951f-00c72e06bb6e.htm

- Revit API: `IExternalApplication`  
  https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Developers_Guide/Introduction/Add_In_Integration/Revit_API_Revit_API_Developers_Guide_Introduction_Add_In_Integration_External_Application_html.html

- Revit API: `IExternalDBApplication`  
  https://help.autodesk.com/view/RVT/2026/ENU/?guid=97318be3-45c4-d93b-ee7b-174fa80ab951
