# Revit Panel Schedule Control Model

Read this first. Keep `REVIT_PANEL_SCHEDULES.md` as the long raw research note.

Diagram-first overview: `REVIT_PANEL_SCHEDULE_TOPOLOGY.md`

## User-Facing vs Internal

User-facing:

- panel schedule
- circuit row
- load summary
- panel
- wire graphic / homerun
- connected load

Internal / API-facing:

- `PanelScheduleView` / `PanelScheduleTemplate` / `PanelScheduleData`
- `ElectricalSystem`
- `ElectricalEquipment`
- `ElectricalLoadClassification` / `ElectricalDemandFactorDefinition`
- `Wire` / `WireType`

Working rule:

- explain behavior to users in the user-facing terms
- debug ownership and data flow in the internal terms

## Ownership Stack

```text
Family params
  -> connector electrical values
  -> ElectricalSystem (circuit)
  -> Electrical Equipment (panel)
  -> PanelScheduleTemplate/Data/View
```

Native Revit mostly reads:

- panel header/footer from `Electrical Equipment` + `Project Information`
- panel body from `Electrical Circuits`
- load summary from panel + `ElectricalLoadClassification` + `ElectricalDemandFactorDefinition`

Wire ownership:

- circuits own electrical identity
- wires are attached routing/graphics elements on those circuits
- wire types own conductor/material defaults, not panel-body identity

## Hard Boundaries

- A family param does not flow directly into the panel body.
- A connector-driven electrical value can flow indirectly by changing circuit built-ins.
- A panel metadata field belongs on `Electrical Equipment`, not on downstream loads.
- A body-row custom field must exist on `Electrical Circuits`.
- A combined field in the panel body can only combine circuit-owned fields.
- Revit does not natively aggregate arbitrary child metadata like `MOCP`, `MCA`, `PE_G___TagInstance`, or `PE_M___ServesRoom` across all circuit children.
- There is no native project-GUI rule binding like `connected equipment.MOCP -> circuit.Rating`.
- Binding the same shared parameter to equipment and circuits creates two schedulable fields, not one live linked value.
- `ElectricalSystem.Rating` is settable, but it is still circuit-owned breaker/OCP data. If equipment metadata should drive it, an add-in, script, Dynamo graph, or Pea operation must copy/apply that policy.
- In Revit 2026+, conductor/cable control moved toward explicit `CableType` / `CableSize` assignment. That helps automation own conductor selection, but it does not add cross-element parameter formulas.

## What Actually Flows

Good native flow:

- `PE_E___Voltage` -> connector -> circuit `Voltage`
- `PE_E___ApparentPower` -> connector -> circuit `Apparent Load` / `Apparent Current`
- `PE_E___NumberOfPoles` -> connector -> circuit pole/slot behavior
- `PE_E___LoadClassification` -> connector/project classification -> load summary + demand

No direct native flow to panel body:

- `PE_G___TagInstance`
- `PE_M___ServesRoom`
- `PE_E___MCA`
- `PE_E___MOCP`
- `PE_E___FLA`
- `PE_E___LRA`
- `PE_E_LoadCalc_*`

## Missing Rule Layer

The observed BIM gap is not just "copy this parameter." It is the missing native rule layer between:

```text
connected equipment metadata
  -> circuit breaker / frame / description / conductor policy
  -> panel schedule body
```

Autodesk docs and forum evidence point to the same boundary:

- circuit table template cells can use `Electrical Circuits` parameters only
- circuit `Rating` is one of the few editable circuit properties and is used for wire sizing / overload behavior
- Autodesk support describes load-based breaker-size automation in panel schedules as a Revit limitation
- forum users report managing MOCP/breaker size independently between equipment and panel schedules unless they use Dynamo/API/manual coordination

## Third-Party Pattern

Design Master ElectroBIM's "parameter linking" is not a native Revit breakthrough. It is a product-owned electrical rule engine:

```text
device family/shared parameter
  -> ElectroBIM setting such as OCP Trip / circuit description
  -> ElectroBIM calculate/update command
  -> Revit circuit Rating / Frame / description + output shared parameters
```

Their docs explicitly treat many shared parameters as output-only and say ElectroBIM controls Revit circuit `Rating`. Useful Pea takeaway:

- read Revit equipment parameters as inputs
- apply an explicit office/code policy
- write circuit-owned `Rating`, `Frame`, `LoadName`, custom `Electrical Circuits` fields, and Revit 2026+ cable fields as outputs
- emit provenance/conflict evidence instead of pretending the GUI can keep values linked

Panel-owned, not child-owned:

- `PE_E___FedFromOverride*`
- `PE_E___MainBreakerRating`
- `PE_E___MinAICRating`
- `PE_E___MinBusRating`
- `PE_E___NEMAEnclosureRating`
- `PE_E___NumberOfSpaces`
- `PE_E___NumberOfWires`
- `PE_E___TypeOfMain`
- `PE_E___VoltageLtoL`
- `PE_E___VoltageLtoN`

## Live Observations

- Template `No Feed-Through Lugs_Total Load Sum_Wire Sizes_MCB` uses built-in circuit `Load Name` in both body halves: `BuiltInParameter.RBS_ELEC_CIRCUIT_NAME`.
- In the template model, `Electrical Circuits` had only 5 project params and none of the cached `PE_E*` params were bound.
- In `Riverbend_Clone`, working circuit names were already stored on the circuit:
  - `P 15 -> HOOD-1 - Kitchen 100`
  - `P 10,12 -> EVSE-1 - Carport`
  - `M 1 -> GD-1 - Kitchen 100`
  - `MDP 1 -> Panel 'L'`
- For sampled single-load circuits, the `Load Name` prefix matched the connected element `Mark`.
- For the `DH-1` proxy case:
  - selected mechanical equipment was not circuited
  - nearby receptacle proxy `DH-1` was on `Panel L / Circuit 1`
  - selected wire `6714280` had `MEPSystem -> ElectricalSystem 6714279`
  - wire type `THWN (Copper w/ Neutral)` described the wire, not the panel row

## Repo Anchors

- Connector authoring: `source/Pe.Revit.FamilyFoundry/Operations/MakeElecConnector.cs`
- Revit script workspace: `source/Pe.App/Commands/Scripting/CmdScriptingWorkspace.cs`
- Script execution lane: `source/Pe.Revit.Scripting/Execution/RevitScriptExecutionService.cs`

## Read Next

- `REVIT_PANEL_SCHEDULE_TOPOLOGY.md`
- `REVIT_PANEL_SCHEDULE_DECISION_TREES.md`
- `REVIT_PANEL_SCHEDULE_API_TOUCHPOINTS.md`
