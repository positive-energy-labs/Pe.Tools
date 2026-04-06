# Revit Electrical Panels, Power Systems, and Panel Schedules

This guide covers both the UI/user mental model and the Revit API surface for:

- electrical panels
- electrical systems/circuits
- panel schedules
- panel schedule templates
- load classifications
- demand factors

Where I make a conclusion that is not stated verbatim in Autodesk docs, I label it as an inference.

## Core model

The useful mental model is:

- a panel is usually an `Electrical Equipment` family instance
- the family instance's electrical API is `ElectricalEquipment`
- a circuit/power system is `ElectricalSystem`
- a panel schedule is `PanelScheduleView`
- a panel schedule template is `PanelScheduleTemplate`
- the editable table/layout data is `PanelScheduleData`
- load classifications are `ElectricalLoadClassification`
- demand-factor profiles are `ElectricalDemandFactorDefinition`

The main data flow is:

`connector data -> circuit/ElectricalSystem -> panel -> panel schedule -> load summary`

## What users mean in the UI

When users talk about this area online, they usually mean some mix of:

- panel schedule
- load summary
- circuit table
- spaces and spares
- distribution system
- load classification
- demand factor
- panel template

That user language maps well to the API:

- panel schedule -> `PanelScheduleView`
- panel template -> `PanelScheduleTemplate`
- circuit -> `ElectricalSystem`
- panel -> `FamilyInstance` + `ElectricalEquipment`
- load summary rows -> `ElectricalLoadClassification` plus demand-factor logic

## API surface

### `PanelScheduleView`

This is the actual schedule view instance users see in the browser or place on a sheet.

Useful members:

- `CreateInstanceView(Document, ElementId)`
- `CreateInstanceView(Document, ElementId, ElementId)`
- `GetPanel()`
- `GetTemplate()`
- `GenerateInstanceFromTemplate()`
- `GetSectionData()`
- `GetTableData()`
- `GetCircuitByCell()`
- `GetCircuitIdByCell()`
- `GetCellsBySlotNumber()`
- `MoveSlotTo()` and `CanMoveSlotTo()`
- `SwitchPhases()`
- `AddSpare()`, `AddSpace()`, `RemoveSpare()`, `RemoveSpace()`
- `SetParamValue()`
- load-summary getters such as:
  - `GetLoadClassificationConnectedLoad()`
  - `GetLoadClassificationDemandLoad()`
  - `GetLoadClassificationConnectedCurrent()`
  - `GetLoadClassificationDemandCurrent()`
  - `GetLoadClassificationDemandFactor()`

Practical point:

- `PanelScheduleView` is not just a read-only report. The API lets you move slots, switch phases, add spaces/spares, and read summary values by load classification.

### `PanelScheduleTemplate`

This is the reusable schedule-template element. Autodesk documents branch-panel, data-panel, and switchboard templates.

Useful members:

- `Create()`
- `CopyFrom()`
- `GetPanelScheduleType()`
- `GetSectionData()`
- `GetTableData()`
- `SetTableData()`
- `IsBranchPanelSchedule`
- `IsDataPanelSchedule`
- `IsSwitchboardSchedule`
- `IsDefault`
- `IsValidPanelConfiguration()`

### `PanelScheduleData`

This is the writable table/layout object behind a template or schedule instance.

Useful members:

- `NumberOfSlots`
- `PanelConfiguration`
- `PhaseLoadType`
- `PhasesAsCurrents`
- `SummaryShowsGroups`
- `SummaryShowsOnlyConnectedLoads`
- `ShowSlotFromDeviceInsteadOfTemplate`
- `ShowMultipleRowsForMultiphaseCircuits`
- `ShowCircuitNumberOnOneRowForMultiphaseCircuits`
- `AddLoadClassification()`
- `SetLoadClassifications()`
- `GetLoadClassifications()`
- `UpdateLoadSummary()`
- `UpdateCircuitTableForTemplate()`
- `UpdateCircuitTableForInstance()`

### `ElectricalSystem`

This is the circuit/power-system object.

Useful members:

- `Create(Connector, ElectricalSystemType)`
- `Create(Document, IList<ElementId>, ElectricalSystemType)`
- `AddToCircuit()`
- `RemoveFromCircuit()`
- `SelectPanel()`
- `DisconnectPanel()`
- `GetCircuitPath()`
- `SetCircuitPath()`

Useful properties:

- `CircuitNumber`
- `PanelName`
- `LoadName`
- `LoadClassifications`
- `CircuitType`
- `SystemType`
- `StartSlot`
- `SlotIndex`
- `PolesNumber`
- `ApparentLoad`, `ApparentLoadPhaseA/B/C`
- `ApparentCurrent`, `ApparentCurrentPhaseA/B/C`
- `TrueLoad`, `TrueLoadPhaseA/B/C`
- `TrueCurrent`, `TrueCurrentPhaseA/B/C`
- `PowerFactor`
- `Voltage`
- `Length`
- conductor and cable sizing properties

### `ElectricalEquipment`

This is the panel/equipment-facing API through the family instance's `MEPModel`.

Useful members:

- `DistributionSystem`
- `CircuitNamingSchemeId`
- `GetCircuitNamingSchemeType()`
- `SetCircuitNamingSchemeType()`
- `GetElectricalSystems()`
- `GetAssignedElectricalSystems()`
- `IsSwitchboard`
- `MaxNumberOfCircuits`

### `ElectricalLoadClassification`

This is a real project element, not just a string.

Useful members:

- `Name`
- `Abbreviation`
- `DemandFactorId`
- `Motor`
- `Other`
- `Spare`
- `SpaceLoadClass`
- label properties such as:
  - `PanelConnectedLabel`
  - `PanelEstimatedLabel`
  - `PanelConnectedCurrentLabel`
  - `PanelEstimatedCurrentLabel`
  - `LoadSummaryDemandFactorLabel`
  - `ActualElectricalLoadLabel`

### `ElectricalDemandFactorDefinition`

This is the demand-factor profile/configuration element.

Useful members:

- `Name`
- `RuleType`
- `AdditionalLoad`
- `IncludeAdditionalLoad`
- `AddValue()`
- `ClearValues()`
- `GetValues()`
- `GetApplicableDemandFactor()`

## 1. What built-in parameters are on panels?

The useful answer is to group them.

These names come from the Revit 2026 `BuiltInParameter` enum/XML docs plus Autodesk's panel-property help.

### Core panel identity and setup

- `RBS_ELEC_PANEL_NAME` -> Panel Name
- `RBS_ELEC_PANEL_CONFIGURATION_PARAM` -> Panel Configuration
- `RBS_ELEC_PANEL_LOCATION_PARAM` -> Location
- `RBS_ELEC_PANEL_FEED_PARAM` -> Feed
- `RBS_ELEC_PANEL_SUPPLY_FROM_PARAM` -> Supply From
- `RBS_ELEC_PANEL_MAINSTYPE_PARAM` -> Mains Type
- `RBS_ELEC_PANEL_MCB_RATING_PARAM` -> MCB Rating
- `RBS_ELEC_PANEL_SUBFEED_LUGS_PARAM` -> SubFeed Lugs
- `RBS_ELEC_PANEL_FEED_THRU_LUGS_PARAM` -> Feed Through Lugs

### Panel hardware and electrical setup

- `RBS_ELEC_PANEL_BUSSING_PARAM` -> Bussing
- `RBS_ELEC_PANEL_GROUND_BUS_PARAM` -> Ground Bus
- `RBS_ELEC_PANEL_NEUTRAL_BUS_PARAM` -> Neutral Bus
- `RBS_ELEC_PANEL_NEUTRAL_RATING_PARAM` -> Neutral Rating
- `RBS_ELEC_PANEL_NUMPHASES_PARAM` -> Number of Phases
- `RBS_ELEC_PANEL_NUMWIRES_PARAM` -> Number of Wires

### Panel totals

- `RBS_ELEC_PANEL_TOTALLOAD_PARAM` -> Total Connected Apparent Power
- `RBS_ELEC_PANEL_TOTALESTLOAD_PARAM` -> Total Demand Apparent Power
- `RBS_ELEC_PANEL_TOTAL_CONNECTED_CURRENT_PARAM` -> Total Connected Current
- `RBS_ELEC_PANEL_TOTAL_DEMAND_CURRENT_PARAM` -> Total Estimated Demand Current
- `RBS_ELEC_PANEL_TOTAL_DEMAND_FACTOR_PARAM` -> Total Demand Factor

### Per-group totals on the panel

- `RBS_ELEC_PANEL_TOTALLOAD_HVAC_PARAM`
- `RBS_ELEC_PANEL_TOTALESTLOAD_HVAC_PARAM`
- `RBS_ELEC_PANEL_TOTALLOAD_LIGHT_PARAM`
- `RBS_ELEC_PANEL_TOTALESTLOAD_LIGHT_PARAM`
- `RBS_ELEC_PANEL_TOTALLOAD_POWER_PARAM`
- `RBS_ELEC_PANEL_TOTALESTLOAD_POWER_PARAM`
- `RBS_ELEC_PANEL_TOTALLOAD_OTHER_PARAM`
- `RBS_ELEC_PANEL_TOTALESTLOAD_OTHER_PARAM`

### Phase totals and panel-side aggregate values

- `RBS_ELEC_PANEL_CURRENT_PHASEA_PARAM`
- `RBS_ELEC_PANEL_CURRENT_PHASEB_PARAM`
- `RBS_ELEC_PANEL_CURRENT_PHASEC_PARAM`
- `RBS_ELEC_PANEL_BRANCH_CIRCUIT_APPARENT_LOAD_PHASEA/B/C`
- `RBS_ELEC_PANEL_BRANCH_CIRCUIT_CURRENT_PHASEA/B/C`
- `RBS_ELEC_PANEL_FEED_THRU_LUGS_APPARENT_LOAD_PHASEA/B/C`
- `RBS_ELEC_PANEL_FEED_THRU_LUGS_CURRENT_PHASEA/B/C`

### Panel-schedule-related fields

- `RBS_ELEC_PANEL_SCHEDULE_HEADER_NOTES_PARAM`
- `RBS_ELEC_PANEL_SCHEDULE_FOOTER_NOTES_PARAM`
- `PANEL_SCHEDULE_NAME`
- `RBS_PANEL_SCHEDULE_SHEET_APPEARANCE_PARAM`
- `RBS_PANEL_SCHEDULE_SHEET_APPEARANCE_INST_PARAM`
- `HOST_PANEL_SCHEDULE_AS_PANEL_PARAM`

### Also relevant from the panel/circuit edge

Users often experience these as "panel schedule fields" even when they live on the circuit:

- `RBS_ELEC_CIRCUIT_PANEL_PARAM`
- `RBS_ELEC_CIRCUIT_NUMBER`
- `RBS_ELEC_CIRCUIT_NAME`
- `RBS_ELEC_CIRCUIT_TYPE`
- `RBS_ELEC_CIRCUIT_RATING_PARAM`
- `RBS_ELEC_CIRCUIT_FRAME_PARAM`
- `RBS_ELEC_CIRCUIT_LENGTH_PARAM`
- `RBS_ELEC_CIRCUIT_SLOT_INDEX`
- `RBS_ELEC_CIRCUIT_START_SLOT`
- `RBS_ELEC_CIRCUIT_NAMING_INDEX`
- `RBS_ELEC_CIRCUIT_CONNECTION_TYPE_PARAM`
- `RBS_ELEC_CIRCUIT_PATH_MODE_PARAM`
- `RBS_ELEC_CIRCUIT_PATH_OFFSET_PARAM`
- `RBS_ELEC_CIRCUIT_NOTES_PARAM`
- `RBS_ELEC_CIRCUIT_NUMBER_OF_ELEMENTS_PARAM`
- `RBS_ELEC_LOAD_CLASSIFICATION`

## 2. What do panel schedules pick up from modeled elements, and from which modeled elements?

The practical answer is that panel schedules pull from four main buckets:

1. the panel element itself
2. the electrical circuits connected to the panel
3. connected family instances through their electrical connectors
4. project/configuration elements such as load classifications, demand factors, and some project-info fields

### From the panel element

Autodesk's panel-schedule docs say schedules show data such as:

- panel name
- distribution system
- number of phases
- number of wires
- mains rating
- mounting
- enclosure
- room/location
- circuit naming context
- modifications

This is panel/equipment-side data.

### From the circuit (`ElectricalSystem`)

The circuit table usually reads from `ElectricalSystem`-level data such as:

- circuit number
- load name
- rating
- frame
- poles
- system type
- slot and start slot
- phase loads and currents
- conductor and cable data
- circuit length
- notes
- number of connected elements
- load classification

### From connected devices through electrical connectors

This is the most important upstream source.

Autodesk explicitly says:

- assign a load classification to the electrical connector
- connector electrical data shown in schedules is derived from the primary connector

So the panel schedule indirectly depends on connector-side values such as:

- load classification
- apparent load
- current
- voltage
- poles
- balanced vs unbalanced behavior
- power-factor-related behavior

Revit aggregates that into the circuit and then the panel schedule.

### From spaces

This is more user-facing than API-facing, but it matters.

A common user complaint is that "location" or room-ish text is missing from the panel schedule. Online discussion around panel schedules often points back to `Spaces`, not just panel configuration.

Inference:

- when users expect location-like schedule text, the missing upstream data is often absent or incorrect `Space` assignment on the connected elements

### From project/configuration elements

Panel schedules also pick up from:

- `ElectricalLoadClassification`
- `ElectricalDemandFactorDefinition`
- `Project Information` fields, if the template includes them

### Concise modeled-element map

Modeled/project elements that matter:

- `FamilyInstance` panelboards, switchboards, transformers in `Electrical Equipment`
- `ElectricalSystem` circuits
- connected devices, fixtures, and equipment with electrical connectors
- sometimes downstream subpanels
- `Space` elements when location-like schedule output depends on them
- `Project Information`
- load classification and demand-factor elements

## 3. What opportunities are there to "wire" the panel with your own parameters?

This is where panel schedules matter most.

### Strong opportunities

#### Bind custom parameters to the right categories and add them in the template

Autodesk says panel schedule templates can add parameters from:

- `Electrical Equipment`
- `Electrical Circuits`
- `Project Information`

And section usage is restricted:

- header/footer -> electrical equipment and project information
- circuit table -> electrical circuits only
- load summary -> electrical equipment only

This is the cleanest extension path.

Practical rule:

- if the value belongs to the panel, bind it to `Electrical Equipment`
- if the value belongs to a row in the circuit table, bind it to `Electrical Circuits`
- if the value is project-wide metadata, bind or place it in `Project Information`

#### Drive connector load classification from a family parameter

Autodesk explicitly supports associating a connector's load classification with a family parameter.

This is a strong extension point because that value flows into:

- the circuit
- the load summary
- demand-factor application
- panel totals

#### Combine parameters in panel schedule templates

Autodesk also explicitly supports combined parameters in panel schedule templates.

That is useful when you want custom-looking display cells without inventing a brand-new physical parameter.

#### Use panel schedule notes and labels

Useful low-friction extension points:

- schedule header notes
- schedule footer notes
- template labels
- project information fields in header/footer

### Medium opportunities

#### Control schedule structure with the panel-schedule API

Using `PanelScheduleView`, `PanelScheduleTemplate`, and `PanelScheduleData`, you can automate:

- creating schedules from specific templates
- adding/removing load classifications from the summary
- moving slots
- adding/removing spaces and spares
- changing section visibility
- changing phase display
- changing number-of-slot behavior

#### Control upstream circuit naming and panel behavior

Some things users think of as "schedule customization" are actually:

- circuit naming settings
- electrical settings
- panel settings
- template settings

### Weak or likely unsupported opportunity

#### Replacing Revit's load-summary math with arbitrary custom formulas

I did not find Autodesk documentation or API support for "replace Revit's panel-schedule load-summary calculation engine with my own arbitrary formula system."

Inference:

- you can customize displayed fields
- you can customize the template and layout
- you can customize upstream data and parameter bindings
- but the core connected-load and demand-load calculation engine is fundamentally Revit's

## 4. What calculations do panels provide?

### Panel-level calculations

Autodesk's panel-property and load-calculation docs describe panel-side values such as:

- total connected load
- total estimated demand load
- total demand factor
- current/load by phase
- per-load-classification connected load
- per-load-classification demand load
- grouped totals such as HVAC, Lighting, Power, Other

The API reinforces this:

- `PanelScheduleView` can report connected load, demand load, connected current, demand current, and demand factor by load classification
- panel parameters expose connected/demand totals and current totals

### Circuit-level calculations

Autodesk documents these on circuits:

- apparent load
- apparent current
- true load
- true current
- power factor
- voltage drop
- wire sizing
- circuit length
- conductor counts and runs

### Demand-factor calculation modes

Autodesk says demand factors can be based on:

- a constant
- quantity of connected objects
- connected load

The API object `ElectricalDemandFactorDefinition` supports:

- `RuleType`
- value tables
- `AdditionalLoad`
- `IncludeAdditionalLoad`
- `GetApplicableDemandFactor()`

## 5. How do loads, demand profiles, and demand factors relate?

The key chain is:

1. a connector has electrical load data
2. that connector is assigned a `Load Classification`
3. the `Load Classification` points to a `DemandFactorId`
4. Revit aggregates the loads by classification through the circuit/panel hierarchy
5. Revit applies the demand-factor definition
6. the panel schedule shows connected and demand results in the load summary

This is why many apparent "panel schedule" issues are really upstream issues in:

- family connector authoring
- primary connector selection
- load classification assignment
- demand-factor setup
- spaces/location context

### What users often mean by "demand profile"

In user language, "demand profile" usually means one of:

- the demand-factor definition itself
- the range table inside the demand-factor definition
- the combination of load classification plus assigned demand factor

In API terms that mostly maps to:

- `ElectricalDemandFactorDefinition`
- `ElectricalLoadClassification.DemandFactorId`

### Panel hierarchy matters

Autodesk's load-calculation help is explicit that panel calculations include loads connected:

- directly to the panel
- to child panels
- to grandchild panels

So the totals are hierarchy-aware, not just local row sums.

## 6. What do panel templates allow?

Yes, panel schedule templates absolutely exist, both in the UI and API.

Autodesk documents three template types:

- branch panel
- data panel
- switchboard

### In the UI, templates allow you to control

- which sections show: header, circuit table, load summary, footer
- width
- borders
- number of slots
- whether slot count is fixed or driven from equipment
- whether phase columns show loads or currents
- how multiphase circuits display
- load-summary ordering and grouping
- whether only connected loads display in the summary
- which parameters are displayed
- combined display fields
- labels and notes
- default template selection

### In the API, templates allow you to

- create templates
- copy templates
- inspect template type
- inspect and write table/section data
- validate panel-configuration compatibility
- create schedules from specific templates

### What templates are not

Inference:

- templates are mainly presentation, structure, and selected-field control
- they are not a separate calculation engine

## Direct answers

### 1. What built-in params are on panels?

The main ones are the `RBS_ELEC_PANEL_*` family plus related panel-schedule fields:

- identity and setup: panel name, configuration, location, feed, supply from, mains type
- hardware/config: bussing, neutral/ground bus, neutral rating, phases, wires, subfeed/feed-through lugs
- totals: connected load/current, demand load/current, demand factor
- per-group totals: HVAC, Lighting, Power, Other
- phase totals and panel aggregate values
- schedule-related: header/footer notes, panel schedule name, appearance on sheet

### 2. What do panel schedules pick up, and from what modeled elements?

They pick up:

- from the panel/equipment: panel and distribution-system data
- from the circuit: circuit number, load name, rating, poles, slot data, wire data, loads/currents, notes
- from connected families through connectors: upstream load values and load classification
- from spaces: often the location-like text users expect
- from project/configuration elements: project information, load classifications, demand factors

### 3. What opportunities are there to wire with your own parameters?

Best options:

- bind shared/project parameters to `Electrical Equipment`, `Electrical Circuits`, or `Project Information`, then place them in the template
- associate connector load classification to a family parameter
- use combined parameters in templates
- use template labels plus schedule notes
- automate schedule/template structure through the API

### 4. What calculations do panels provide?

Panels provide:

- connected load
- demand load
- demand factor
- current/load by phase
- grouped totals
- hierarchy-aware totals from downstream panels

Circuits provide:

- apparent/true load
- apparent/true current
- power factor
- voltage drop
- wire sizing and length

### 5. How do loads with demand profiles relate?

The relation is:

- connector load data is the raw input
- load classification groups the load
- demand factor definition determines the reduction rule
- the panel aggregates through the hierarchy
- the schedule shows connected and demand results

### 6. What do panel templates allow?

They allow:

- layout and section control
- slot behavior control
- phase display control
- selected-parameter display
- combined fields
- labels and notes
- load-summary display behavior
- default/specific template assignment

## Practical guidance

If you automate this area, the safest separation is:

- `ElectricalSystem` -> circuit truth
- panel instance + `ElectricalEquipment` -> panel truth
- `ElectricalLoadClassification` and `ElectricalDemandFactorDefinition` -> electrical configuration truth
- `PanelScheduleTemplate` and `PanelScheduleData` -> presentation and structure
- family connector setup -> upstream authoring dependency

## Common pitfalls

- wrong or missing load classification on the connector
- wrong primary connector in the family
- missing `Space` data when users expect location text
- wrong distribution system on the panel
- confusing a template/display problem with a calculation/setup problem
- trying to fix load-summary behavior only in the schedule instead of in connector/load-classification/demand-factor setup

## Sources

- Autodesk Help, Workflow: Panel schedules
  https://help.autodesk.com/cloudhelp/2015/ENU/Revit-DocumentPresent/files/GUID-B667474A-F89F-439E-AB84-12A964E385CD.htm
- Autodesk Help, Panel Schedules
  https://help.autodesk.com/cloudhelp/2025/ENU/Revit-DocumentPresent/files/GUID-3D2D0E77-ED17-4FBF-AAE4-CB9185A3F779.htm
- Autodesk Help, Create a panel schedule
  https://help.autodesk.com/cloudhelp/2015/ENU/Revit-DocumentPresent/files/GUID-63A50132-34B5-483E-BDC6-41A133E6C685.htm
- Autodesk Help, About Panel Schedule Templates
  https://help.autodesk.com/cloudhelp/2023/ENU/Revit-DocumentPresent/files/GUID-6A8EC243-9414-4530-96B9-A413594A8B54.htm
- Autodesk Help, Set options for a panel schedule template
  https://help.autodesk.com/cloudhelp/2021/ENU/Revit-DocumentPresent/files/GUID-9522EA21-AC96-409A-86E8-4B99826E191B.htm
- Autodesk Help, Add panel schedule parameters
  https://help.autodesk.com/cloudhelp/2026/ENU/Revit-DocumentPresent/files/GUID-3136A502-5E67-4A51-AC05-80F8C761B26D.htm
- Autodesk Help, Combine parameters in a panel schedule template
  https://help.autodesk.com/cloudhelp/2026/ENU/Revit-DocumentPresent/files/GUID-6ACFE14A-A6B6-4C85-AE99-8F2184CD9488.htm
- Autodesk Help, About Panel Properties
  https://help.autodesk.com/cloudhelp/2015/ENU/Revit-Model/files/GUID-62144CB0-8C7F-461B-82E3-BF242CBC5D92.htm
- Autodesk Help, About Circuit Properties
  https://help.autodesk.com/cloudhelp/2022/ENU/Revit-MEPEng/files/GUID-BDD3D7A7-0558-42E2-8B32-D87520891969.htm
- Autodesk Help, Specify a Load Classification for an Electrical Connector
  https://help.autodesk.com/cloudhelp/2019/ENU/Revit-Model/files/GUID-4AC73CA6-2631-4AFB-A024-E2F7E13C4B9B.htm
- Autodesk Help, Create Connector Load Classification Parameters
  https://help.autodesk.com/cloudhelp/2015/ENU/Revit-Model/files/GUID-29CDE382-2F50-48EB-9225-35079734D382.htm
- Autodesk Help, Connector Properties
  https://help.autodesk.com/cloudhelp/2022/ENU/Revit-Model/files/GUID-3DE410FC-7BB7-44FD-B75E-A02C4F42C1AD.htm
- Autodesk Help, Create a Load Classification
  https://help.autodesk.com/cloudhelp/2026/ENU/Revit-MEPEng/files/GUID-380EBF48-ACE6-474B-9E86-E49D7B3CFDA0.htm
- Autodesk Help, About Demand Factors
  https://help.autodesk.com/cloudhelp/2016/ENU/Revit-Model/files/GUID-554537D9-842A-46A0-9905-AD41C221EA10.htm
- Autodesk Help, Load Calculations
  https://help.autodesk.com/cloudhelp/2023/ENU/Revit-MEPEng/files/GUID-95FE6841-91B1-401A-817C-7095618EC27E.htm
- Autodesk Help, Revit API Developer Guide: PanelScheduleView
  https://help.autodesk.com/cloudhelp/2018/ENU/Revit-API/Revit_API_Developers_Guide/Basic_Interaction_with_Revit_Elements/Views/View_Types/TableView/PanelScheduleView.html
- The Building Coder, MEP 2011 API notes
  https://jeremytammik.github.io/tbc/a/0362_mep_2011_api.htm
- Reddit, Panel Schedule-Circuit Location
  https://www.reddit.com/r/Revit/comments/1c1hkat/panel_schedulecircuit_location/
- Reddit, Question about MEP electrical panel schedules
  https://www.reddit.com/r/Revit/comments/10dtsta/question_about_mep_electrical_panel_schedules/
- Local reference, Revit 2026 API XML docs
  `C:\Users\kaitp\.nuget\packages\nice3point.revit.api.revitapi\2026.4.0\ref\net8.0-windows7.0\RevitAPI.xml`
