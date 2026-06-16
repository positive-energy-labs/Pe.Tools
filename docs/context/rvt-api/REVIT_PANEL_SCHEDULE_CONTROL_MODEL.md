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
