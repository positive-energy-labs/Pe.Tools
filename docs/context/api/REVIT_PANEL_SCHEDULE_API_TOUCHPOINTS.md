# Revit Panel Schedule API Touchpoints

## User-Facing vs Internal

| User-facing term | Internal/API term | Notes |
|---|---|---|
| panel schedule | `PanelScheduleView` | actual schedule instance |
| panel schedule template | `PanelScheduleTemplate` | definition/layout source |
| schedule cells/sections | `PanelScheduleData` | table structure + cell access |
| panel | `FamilyInstance` + `ElectricalEquipment` | usually an electrical equipment family instance |
| circuit row | `ElectricalSystem` | panel body is circuit-owned |
| load summary bucket | `ElectricalLoadClassification` | demand math also depends on `ElectricalDemandFactorDefinition` |
| wire graphic / homerun | `Wire` | attached to a circuit; not the owner of panel-row identity |
| wire type | `WireType` via `Wire.GetTypeId()` | conductor/material defaults |
| proxy device | model convention, not a special API class | old projects may use receptacles/disconnects as stand-ins |

## Main Entities

- `FamilyInstance` + `ElectricalEquipment`: the panel
- `ElectricalSystem`: the circuit / body-row owner
- `Wire`: drawn wire element attached to a circuit
- `WireType`: conductor/material/defaults for wires
- `PanelScheduleTemplate`: the template definition
- `PanelScheduleView`: the actual schedule instance
- `PanelScheduleData`: section/cell layout data
- `ElectricalLoadClassification`: load-summary bucket
- `ElectricalDemandFactorDefinition`: demand math profile
- `ElectricalSetting`: project electrical rules

## Fast Mental Map

```text
connector values -> ElectricalSystem -> panel -> PanelScheduleView
ElectricalSystem -> Wire -> WireType
load classifications + demand defs -> load summary
Electrical Equipment -> header/footer
Electrical Circuits -> body
```

## Snippet: Touch The Core Objects

```csharp
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;

var settings = ElectricalSetting.GetElectricalSettings(doc);

var panel = new FilteredElementCollector(doc)
    .OfClass(typeof(FamilyInstance))
    .Cast<FamilyInstance>()
    .First(fi => fi.MEPModel is ElectricalEquipment);

var equipment = (ElectricalEquipment)panel.MEPModel;
var circuits = equipment.GetAssignedElectricalSystems().ToList();

var template = new FilteredElementCollector(doc)
    .OfClass(typeof(PanelScheduleTemplate))
    .Cast<PanelScheduleTemplate>()
    .First();

var schedule = PanelScheduleView.CreateInstanceView(doc, panel.Id, template.Id);
var body = schedule.GetSectionData(SectionType.Body);
```

## Snippet: Read Circuit `Load Name`

```csharp
var circuit = circuits.First();

var loadName = circuit
    .get_Parameter(BuiltInParameter.RBS_ELEC_CIRCUIT_NAME)?
    .AsString();

var voltage = circuit
    .get_Parameter(BuiltInParameter.RBS_ELEC_VOLTAGE)?
    .AsValueString();
```

Observed live examples:

- `HOOD-1 - Kitchen 100`
- `EVSE-1 - Carport`
- `Panel 'L'`

## Snippet: Walk From Schedule -> Panel -> Template

```csharp
var panelId = schedule.GetPanel();      // R25: ElementId
var templateId = schedule.GetTemplate(); // R25: ElementId

var panelElement = doc.GetElement(panelId) as FamilyInstance;
var templateElement = doc.GetElement(templateId) as PanelScheduleTemplate;

var maybeCircuit = schedule.GetCircuitByCell(body.FirstRowNumber + 1, body.FirstColumnNumber + 1);
```

## Snippet: Load Summary Inputs

```csharp
var classifications = new FilteredElementCollector(doc)
    .OfClass(typeof(ElectricalLoadClassification))
    .Cast<ElectricalLoadClassification>()
    .ToList();

var demandDefs = new FilteredElementCollector(doc)
    .OfClass(typeof(ElectricalDemandFactorDefinition))
    .Cast<ElectricalDemandFactorDefinition>()
    .ToList();
```

## Snippet: Wire -> Circuit

```csharp
var wire = doc.GetElement(selectedId) as Wire;
var wireType = doc.GetElement(wire.GetTypeId()) as ElementType;
var circuit = wire.MEPSystem as ElectricalSystem;

var systems = wire.GetMEPSystems()
    .Cast<ElementId>()
    .Select(id => doc.GetElement(id))
    .OfType<ElectricalSystem>()
    .ToList();
```

Observed live example:

- wire `6714280`
- wire type `THWN (Copper w/ Neutral)`
- `wire.MEPSystem -> ElectricalSystem 6714279`
- circuit `L-1`
- connected endpoint owner was the `DH-1` receptacle proxy

## Repo Notes

- `MakeElecConnector.cs` is the native-friendly upstream lane: map family params into connector electrical values.
- `CmdScriptingWorkspace.cs` + `RevitScriptExecutionService.cs` are the quickest repo-local probe lane for live documents.
