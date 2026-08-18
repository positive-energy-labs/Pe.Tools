# Flows

The skill set as conditional flows — our fork (no external tracker; ledgers/MAP.md per the `docs` skill; `find-the-product` and `delegation` are first-class). Each skill leaves the next a better input: shared decisions, a spec, an Owed line, a failing test, or a reviewable diff.

## The main flow

```mermaid
flowchart TD
    I([An idea, in this repo]) --> G["grill-with-docs<br/>→ CONTEXT.md + ADRs"]
    G --> Q{"Settleable<br/>by talking?"}
    Q -- no --> PR["prototype<br/>→ verdict to LEDGER"] --> Q
    Q -- yes --> M{"Fits one<br/>session?"}
    M -- yes --> IMP["implement<br/>same conversation"]
    M -- no --> SP["to-spec<br/>seams + out-of-scope<br/>→ spec file + Owed line"] --> TT["to-tickets<br/>tracer bullets<br/>→ Owed lines w/ blocking edges"]
    TT --> CL(["/clear"]) --> IMP
    IMP --> CR["code-review<br/>Standards + Spec"]
    CR --> H([human reconciles,<br/>Owed line deleted]) --> CL
```

## On-ramps

```mermaid
flowchart LR
    FTP["find-the-product<br/>UI/product discovery<br/>rounds → MAP.md live, LEDGER settled"] -- "closing the chain<br/>outgrows a session" --> SP2["to-spec"]
    WF["wayfinder<br/>too foggy for one session<br/>→ MAP.md decision tickets"] --> SP2
    DBG["diagnosing-bugs<br/>hard bug or regression"] --> RED["red loop → hypotheses<br/>→ fix + regression test<br/>falsified hypotheses → LEDGER"]
    ICA["improve-codebase-architecture<br/>periodic upkeep"] -- "pick one candidate" --> GD2["grill-with-docs"]
    SP2 --> MAIN([main flow])
    GD2 --> MAIN
    DBG -. "no correct seam" .-> ICA
```

## Engines underneath

```mermaid
flowchart TD
    subgraph invoke["User- or index-invoked"]
      FTPX["find-the-product"]
      GWD["grill-with-docs"]
      WAY["wayfinder"]
      ARC["improve-codebase-architecture"]
      IMPL["implement"]
    end
    subgraph eng["Engines — pulled in, rarely invoked alone"]
      GRL["grilling<br/>rounds · frontier"]
      TDDX["tdd"]
      CRX["code-review"]
      DMX["domain-modeling"]
      CDX["codebase-design"]
      DLG["delegation"]
      PRX["prototype"]
      DOCS["docs<br/>where everything persists"]
    end
    FTPX --> GRL & PRX & DLG
    GWD --> GRL & DMX
    WAY --> GRL
    ARC --> GRL & CDX
    IMPL --> TDDX & CRX
    TDDX --> CDX
```

## Phase boundaries

At a phase end — never mid-phase — walk in order; first yes wins. See [PHASE-BOUNDARIES.md](PHASE-BOUNDARIES.md).

```mermaid
flowchart TD
    B([Phase boundary]) --> Q1{"Next phase needs this<br/>conversation verbatim,<br/>context still healthy?"}
    Q1 -- yes --> C1["Continue"]
    Q1 -- no --> Q2{"Everything behind<br/>you disposable?"}
    Q2 -- yes --> C2["/clear"]
    Q2 -- no --> Q3{"Must it travel?<br/>harness, directory,<br/>person, side task"}
    Q3 -- yes --> C3["handoff"]
    Q3 -- no --> Q4{"Tightly scoped,<br/>runs without steering?"}
    Q4 -- yes --> C4["Subagent"]
    Q4 -- no --> C5["/compact"]
```

Continuing preserves a primary source; every alternative is lossy, so `/compact` is the fallback, not the first move.

## The shortest useful rule

**Decide with the human, persist only what code can't say, split work into independently provable slices, build one slice in a fresh context, and verify it at an agreed public seam.**
