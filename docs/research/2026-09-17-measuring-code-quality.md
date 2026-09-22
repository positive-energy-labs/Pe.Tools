# Measuring code quality without optimizing the wrong thing

Research date: 2026-09-17. Scope: C#, TypeScript, React. This is a research recommendation, not an implemented quality system or a measured audit of Pe.Tools. Three Terra/high research tracks cover structure and concepts, architecture, and runtime/repair. The parent performs synthesis and source checks.

## Position

Measure whether code supports correct behavior, localized changes, accurate understanding, and timely fault detection. Those are different outcomes. Keep them separate.

My synthesis is that good code limits the facts a reader must hold at once, the places a change must reach, the invalid states execution can enter, and the time required to detect a mistake. This is an engineering framework, not a published universal law.

Use three classes of measurement:

1. **Enforceable contracts.** A forbidden dependency, missing exhaustive case, or violated invariant has a defined failure condition.
2. **Investigation signals.** Complexity, churn, co-change, and duplication locate candidates. They do not prescribe a repair.
3. **Outcomes.** Escaped faults, task completion time, latency, failure recovery, and change effort show whether interventions help.

Do not combine all three into a single health score. Empirical work across five Microsoft systems found associations between complexity and failures, but no universally best set of predictors. [Nagappan, Ball, Zeller](https://www.microsoft.com/en-us/research/?p=152897)

## What the theories actually give us

| Lens | Useful mechanism | Practical measurement | Limit |
| --- | --- | --- | --- |
| Information theory | Surprising code can expose inconsistent local patterns | Model-relative token surprisal; optionally rank analyzer findings | Depends on model, training corpus, and context. Familiar bugs can be unsurprising; correct novel code can be surprising |
| Graph theory | Dependencies define possible propagation paths | Strongly connected components, forbidden edges, reverse reachability, fan-in/out | An import graph omits runtime, schema, configuration, and temporal dependencies |
| State-space reasoning | Independent flags multiply representable combinations | Enumerate finite states and transitions; count invalid combinations admitted by a model | Full program state spaces are usually infeasible to enumerate; count a bounded model |
| Control theory | Repairs form a feedback loop with delayed and noisy measurements | Time to trustworthy failure signal, false alarms, regression/revert rate, bounded patch size | This is a design analogy unless the plant and dynamics are explicitly modeled |
| Cognitive science | Nesting and dispersed context affect comprehension | Cognitive complexity plus timed comprehension tasks and answer correctness | Familiarity, task, language, and naming alter difficulty |
| Empirical/causal inference | A predictor need not be an intervention target | Temporal holdout validation; before/after comparisons with comparable untouched code | Selection effects and simultaneous rewrites can defeat causal claims |
| Reliability and queueing | User-visible delay can come from waiting, contention, and failure recovery | Per-stage service/wait times, queue length, failure rate, tail latency | CPU hot spots alone do not explain end-to-end delay |

The information-theory evidence is real but bounded: a Java study found buggy lines were more surprising to a statistical language model and used that signal for inspection prioritization. That supports anomaly ranking, not entropy minimization as a coding goal. Raw character entropy is a different measure. [Ray et al.](https://arxiv.org/abs/1506.01159)

Compression is also an incomplete target. Minification compresses spelling while making reading harder. Extracting a shared function compresses repetition but may couple behaviors that should evolve separately. Kolmogorov complexity is not a computable general code-quality metric.

A second, distinct information-theory application is **change entropy**. For a fixed interval, let p_i be the share of measured change activity in file i; H = -sum(p_i log2 p_i) describes dispersion. Hassan's models use change-process entropy and found predictive value across six open-source projects. A simple entropy calculation is not a reproduction of the full model. Compare fixed windows and granularity; separate formatting from feature work, and report activity volume alongside entropy. A necessary cross-cutting migration can have high entropy, while an unhealthy god file can concentrate change and produce low entropy. [Hassan, 2009](https://sail.cs.queensu.ca/data/pdfs/ICSE2009_PredictingFaultsUsingTheComplexityOfCodeChanges.pdf)

For finite independent booleans, the representable space has 2^n combinations. If three flags describe exactly three mutually exclusive states, five of their eight combinations are invalid. A tagged three-case representation excludes those combinations. This is an exact statement about that model, not a prediction of five fewer bugs. TypeScript discriminated unions support case narrowing; C# can use constrained constructors and explicit case types, but an unrestricted enum alone is not a complete validity guarantee. External inputs still require validation. [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)

Model checking is useful for subtle protocols, retries, ownership transfers, and cancellation. AWS reports design defects found with TLA+. A verified model does not establish that implementation code matches it. Use this selectively for expensive state-transition failures. [AWS experience, with implementation limitation](https://lamport.azurewebsites.net/tla/amazon-excerpt.html)

## Structural properties

| Measure | What to inspect | Useful intervention | How it can mislead |
| --- | --- | --- | --- |
| Cyclomatic complexity | Branch structure per routine, using one consistent analyzer | Simplify decisions; separate independent responsibilities | Moving branches into helpers lowers a local score without simplifying the behavior |
| Cognitive complexity and nesting | Highest values in frequently changed code | Flatten control flow; name a coherent operation | Short expressions can hide difficult data flow |
| Mutable state and write sites | Number of owners/writers; captured mutable variables | Localize ownership; derive values; make transitions explicit | Immutability wrappers can add allocation or obscure a simple local algorithm |
| Duplicated blocks | Clones that receive matching edits | Share a genuine invariant or delete redundant behavior | Similar text may encode different policies |
| Unused code and exports | Reachability from declared entrypoints | Delete dead code or reduce public visibility | Reflection, generated entrypoints, dynamic loading, and external consumers are blind spots |
| Parameter/prop count and pass-through depth | Values relayed without being used | Move ownership or compose at the actual consumer | A parameter object or context can hide the same coupling |
| Size and wrappers | Large changed routines; wrappers with no policy or useful boundary | Delete forwarding layers; retain meaningful boundaries | LOC is affected by formatting and explicitness |

Cognitive Complexity has empirical support for comprehension time and subjective difficulty, with mixed results for answer correctness. Treat it as a useful partial proxy. [Meta-analysis](https://arxiv.org/abs/2007.12520)

There is no defensible universal optimum for function length, parameter count, or number of classes. Compare distributions within the same language and kind of code. Exclude generated sources from authored-code rankings. Start with the worst changed routines, not a repo-wide threshold migration.

Verbosity is best investigated as **unnecessary obligations**: repeated validation of an already established invariant, pass-through wrappers, mirrored DTOs without distinct semantics, duplicated derived state, or comments restating syntax. A few more lines can buy a clearer boundary. Microsoft's refactoring study found dependency/complexity reductions alongside greater size growth in preferentially refactored modules. [Multidimensional refactoring evidence](https://www.microsoft.com/en-us/research/publication/an-empirical-study-of-refactoring-challenges-and-benefits-at-microsoft/)

## Architectural properties

Information hiding asks which design decisions a module keeps from its consumers. Folder structure alone does not answer that question. [Parnas](https://doi.org/10.1145/361598.361623)

Recommended operational measures:

- **Forbidden edges:** imports/references that cross an explicitly disallowed boundary. Suitable for CI once the rule is agreed.
- **Cycles:** list strongly connected components at both file and package granularity. Distinguish runtime from type-only dependencies. A cycle is a concrete graph property; its severity depends on the boundary.
- **Change radius:** packages and semantic contracts touched for one coherent feature change. Track distributions, not a hard maximum.
- **Co-change:** for a fixed window, estimate P(B changes | A changes) = joint changes / changes to A. Report sample count and compare with B's baseline frequency. Exclude bulk formatting, generated files, and bot updates; use coherent PRs where available.
- **Reverse reachability:** possible consumers affected by changing a module. High reach is exposure, not a defect; stable foundational contracts legitimately have many consumers.
- **Relative churn:** changed lines relative to size, with the window and denominator stated. Combine with complexity to choose investigation candidates; do not call the product a calibrated defect probability.
- **Boundary surface:** public symbols/contracts and the frequency with which consumers change when they change. A small API can still expose a large unstable concept.

Relative churn predicted defect density in a Windows Server study. This is evidence for history-based prioritization, not for suppressing necessary edits. Validate transfer to this repository. [Nagappan and Ball](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/icse05churn.pdf)

The common package metric I = Ce / (Ca + Ce) measures outgoing coupling relative to incoming and outgoing coupling. Its name, instability, does **not** mean crash rate, observed change frequency, or unreliability. Specify handling of isolated nodes. [NDepend definitions](https://www.ndepend.com/docs/code-metrics)

DI can expose dependencies and move side effects behind a seam. It can also introduce service locators, lifetime errors, and layers without a useful contract. Count construction/ownership problems and leaked dependencies; do not reward interface count. Likewise, React prop drilling is a symptom to inspect. Composition or nearby state ownership may solve it; context changes dependency visibility and subscription behavior. [React guidance on context](https://react.dev/learn/passing-data-deeply-with-context)

## Conceptual properties: names, docs, comments

Machines can verify symbol references, broken links, examples that compile, schema/doc generation drift, spelling, and naming conventions. They cannot reliably establish that a name communicates the correct domain concept just by scoring its length or vocabulary.

Use a small comprehension probe for costly modules: give a reader unfamiliar with the implementation a concrete change or debugging question. Record time, answer correctness, files consulted, and false assumptions. Repeat with comparable tasks, controlling for familiarity. An agent can serve as a repeatable cold reader if model and prompt are pinned, but its score is not a substitute for human validation.

Useful review questions are whether the same concept has several names, one name has several meanings, a comment describes a constraint the code violates, or the documented authority differs from the actual owner. These are candidate findings requiring source evidence. Do not make a comment-ratio target or add prose merely to satisfy a metric.

For public examples, make the snippet compile or execute against the real API. For generated contracts, compare regenerated output. For explanatory prose, keep the reason, preconditions, and removal condition close to the code it constrains. An LLM can propose contradictions or renames; a symbol-aware refactor plus consumer checks should apply them.

## Tests and runtime

Coverage tells us which code executed. It does not establish that assertions detect faults. A large Java study found only low-to-moderate association with mutation effectiveness after controlling suite size. Use uncovered changed branches to find gaps, rather than making a coverage percentage the quality objective. [Inozemtseva and Holmes](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf)

| Signal | Operational definition | Action |
| --- | --- | --- |
| Fault sensitivity | Selected valid mutants killed; separately list survivors, uncovered mutants, timeouts, and exclusions | Inspect survivors in important logic; add discriminating assertions |
| Property violations | Counterexamples to a stated invariant, with seed and minimized input | Fix the invariant's owner and retain the counterexample |
| Flakiness | Mixed pass/fail outcomes for the same revision under controlled conditions | Identify hidden time, order, concurrency, or environment dependencies |
| Feedback latency | Edit/commit to first trustworthy relevant failure, p50/p95 | Improve test selection and setup cost without omitting the needed runtime |
| User-operation latency | End-to-end p50/p95 with workload and sample size | Split queue, transport, work, and render time before optimizing |
| Resource cost | CPU, allocations, GC, retained memory, I/O per representative operation | Optimize measured dominant cost |
| Escaped faults | Failures per operation or release, severity separated | Reassess which pre-release check could have exposed them |
| Diagnostic usefulness | Time from observed failure to reproducible cause | Improve correlation IDs, provenance, receipts, and state visibility |

Mutation testing measures sensitivity to chosen synthetic faults. Equivalent mutants may survive despite correct behavior; Stryker cannot definitively identify all of them. Do not chase 100%. [Stryker limitations](https://stryker-mutator.io/docs/mutation-testing-elements/equivalent-mutants/)

For React, inspect redundant state, effect chains, and actual commit costs before adding memoization. Deriving values can remove synchronization work and intermediate renders. [State structure](https://react.dev/learn/choosing-the-state-structure), [unnecessary effects](https://react.dev/learn/you-might-not-need-an-effect)

Count renders only to explain a trace. A cheap render can be harmless; a single expensive commit can violate the interaction budget. Measure production-like foreground interactions and retain console/network failures. Revit main-thread wait, host transport, and browser rendering are separate possible bottlenecks.

## Safe automation is proportional to the strength of the check

1. **Mechanical fixes:** formatting and selected analyzer fixes with explicit preconditions. Apply to bounded paths, inspect the diff, then rerun checks.
2. **Reachability-based deletion:** configure entrypoints and external consumers first. A tool finding is a deletion candidate, especially with reflection or dynamic registration.
3. **Semantic changes:** state redesign, module movement, effect removal, and abstraction changes need a behavioral acceptance condition plus consumer checks.
4. **Open-ended agent repair:** require a reproducer, bounded patch scope, independent checks, and a reviewable diff. Preserve the original failing case and prevent acceptance by weakening tests or silencing rules.

Test-suite-based repair can overfit the supplied tests. Passing the same tests used to guide generation is weaker evidence than passing additional independently specified cases. [Repair overfitting study](https://www.cs.cmu.edu/~clegoues/docs/smith15fse.pdf)

The control-loop interpretation suggests bounded interventions and waiting for meaningful feedback. Repeatedly rewriting toward a fluctuating score can produce churn rather than improvement. Keep hard invariants fixed during a repair; stop if the metric improves only because code moved, cases disappeared, or the denominator changed.

## A minimal practical stack

| Need | C# | TypeScript / React |
| --- | --- | --- |
| Immediate semantic feedback | Nullable analysis and selected SDK/Roslyn analyzers | Strict TypeScript and type-aware existing linting |
| Mechanical fixes | Selected analyzer code fixes / `dotnet format` | Existing formatter and safe lint fixes |
| Boundary enforcement | ArchUnitNET or NetArchTest; NDepend when richer graph queries justify it | dependency-cruiser for graph rules |
| Dead code | Analyzer/IDE candidates with reflection review | Knip with framework/workspace entrypoints configured |
| Fault sensitivity | Stryker.NET on compatible pure tests | StrykerJS on compatible test runners |
| Properties | FsCheck for bounded pure/domain properties | fast-check for bounded pure/domain properties |
| Runtime | Appropriate .NET profiler; EventPipe tools only on supported runtimes | Browser performance tools and React Profiler |
| React correctness | Not applicable | Official Hooks/Compiler diagnostics; verify integration with the installed lint runner |

These are options, not a recommendation to install all of them. Start with the existing compiler/linter and one missing capability tied to an observed question. Official capabilities: [.NET analysis](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview), [dotnet format](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format), [Oxlint fix modes](https://oxc.rs/docs/guide/usage/linter/automatic-fixes), [React diagnostics](https://react.dev/reference/eslint-plugin-react-hooks), [dependency-cruiser rules](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md), [Knip fixes](https://knip.dev/features/auto-fix), [Knip reachability limits](https://knip.dev/explanations/how-knip-works).

Additional official references: [ArchUnitNET](https://github.com/TNG/ArchUnitNET), [NetArchTest](https://github.com/BenMorris/NetArchTest), [FsCheck](https://fscheck.github.io/FsCheck/QuickStart.html), [fast-check](https://fast-check.dev/docs/introduction/), [Stryker.NET](https://stryker-mutator.io/docs/stryker-net/introduction/), [StrykerJS Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/), [React Profiler](https://react.dev/reference/react/Profiler), [dotnet-trace](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-trace). The existence of a Vitest runner does not prove compatibility with this checkout's Vite+ configuration.

## Convergence of the research tracks

All three tracks favor explicit rules, baseline-relative investigation, and independent behavior checks. Their evidence does not justify universal metric thresholds or a self-optimizing scalar quality score.

The synthesis makes three choices where the tracks offered broader recommendations:

- Keep the existing Vite+ lint path first. A separate general ESLint/Sonar stack must add a needed capability rather than duplicate checks. Official React compiler diagnostics remain worth a targeted compatibility evaluation.
- Do not require both a static graph warning and historical co-change before investigating a boundary. Their intersection strengthens prioritization, but a new violation of a settled architectural constraint can be actionable without history.
- Autofix safety is conditional, not a tool-level guarantee. Preserve automated mechanical repairs while treating ownership and semantic rewrites as proposals requiring behavioral evidence.

The underlying literature is substantially older than the tools. Current documentation establishes what tools can measure today; it does not establish new causal evidence that optimizing those measures improves C#/TS/React systems. Most cited empirical datasets are Java or large industrial systems, so local validation remains part of the recommendation.

## What is already present in Pe.Tools

Source inspection at `850b8698347aa7501244ddb958aaee67e56c4f3e`, with pre-existing untracked `docs/features/factory/` and `factory.toml` preserved:

- `source/pe-tools/vite.config.ts` already enables type-aware linting and type checking. Extend this path before adding a duplicate general lint stack.
- The inspected web and host tsconfigs already enable `strict`. Neither explicitly enables `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`; these are candidate pilots, not a finding that all packages lack them. [Option semantics](https://www.typescriptlang.org/tsconfig/)
- `source/pe-tools/tests/repo-guards/src/` already contains architecture-adjacent and documentation guards. Reuse these where the required rule is small; use a graph tool for graph questions.
- Several C# project files explicitly enable nullable analysis. Effective SDK-imported analyzer settings were not evaluated in this research, so no repo-wide coverage claim follows.
- Generated and SDK-vendored files already have explicit formatting exclusions. Keep them separate from authored-code metrics.

For this repository, suggested architecture checks should follow the actual documented constraints: portable contracts do not acquire Revit dependencies; DA-safe libraries do not acquire UI dependencies; web and CLI shells do not acquire each other's implementation internals. Derive precise rules from the current architecture before enforcing them.

No test, build, runtime, or compatibility proof was performed. In particular, do not point a generic mutation runner at Revit-backed tests: this repo requires `pe-revit test` to own that execution. Pilot mutation testing on no-Revit logic and establish runner compatibility first. Older .NET Framework Revit targets need different profiling support from modern .NET targets.

## Recommended first experiment

1. Choose one frequently changed C# area and one TS/React area. Record generated-source exclusions and stable symbol identities.
2. Produce a ranked list with complexity, relative churn, boundary violations/cycles, co-change sample counts, and selected test/runtime evidence. Keep the dimensions visible.
3. Inspect ten candidates. Record whether each finding is real, actionable, and expensive enough to fix. This measures alert precision at the actual review budget.
4. Apply one coherent intervention per candidate, with its acceptance condition stated first. Do not rewrite every metric at once.
5. Compare behavior, change radius, comprehension effort, and runtime cost as relevant. Track recurrence and rework over subsequent changes. Use temporal holdouts if building a predictor; do not randomly split near-identical revisions into training and validation.

Hard gates should initially cover agreed forbidden dependencies and correctness diagnostics. Complexity, LOC, entropy, co-change, and conceptual scores should remain advisory. Outcome tracking can borrow delivery measures such as change failure and recovery time, but those are team/system measures, not grades for individual files or developers. [DORA definitions](https://dora.dev/guides/dora-metrics/), [SPACE](https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/)

The next decision is whether to run this bounded, read-only baseline. The research supports an instrumented pilot; it does not support an autonomous whole-repository quality-score optimizer.
