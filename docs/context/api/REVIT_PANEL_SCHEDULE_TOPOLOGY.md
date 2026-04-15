# Revit Panel Schedule Topology

## 0. User-Facing vs Internal

```mermaid
---
config:
  markdownAutoWrap: true
  flowchart:
    wrappingWidth: 140
---
flowchart LR
    subgraph UI["`User-facing`"]
        U1["`Panel schedule`"]
        U2["`Circuit row`"]
        U3["`Load summary`"]
        U4["`Panel`"]
        U5["`Wire / homerun graphic`"]
    end

    subgraph API["`Internal / API-facing`"]
        A1["`PanelScheduleView`"]
        A2["`ElectricalSystem`"]
        A3["`ElectricalLoadClassification`"] 
        A4["`ElectricalEquipment`"]
        A5["`Wire`"]
        A6["`WireType`"]
    end

    U1 --> A1
    U2 --> A2
    U3 --> A3
    U4 --> A4
    U5 --> A5
    A5 --> A6
```

Rule:

- use user-facing terms for UX/workflow discussion
- use internal terms for ownership, APIs, and debugging

## 1. Whole System

```mermaid
---
config:
  markdownAutoWrap: true
  flowchart:
    wrappingWidth: 140
---
flowchart LR
    subgraph FAM["`Family Doc (.rfa)`"]
        FP["`Family Params
PE_E___Voltage
PE_E___ApparentPower
PE_E___NumberOfPoles
PE_E___LoadClassification?`"]
        CONN["`Electrical Connector
RBS_ELEC_VOLTAGE
RBS_ELEC_APPARENT_LOAD
RBS_ELEC_NUMBER_OF_POLES
RBS_ELEC_LOAD_CLASSIFICATION`"]
        ASSOC["`AssociateElementParameterToFamilyParameter`"]
        FP --> ASSOC --> CONN
    end

    subgraph PROJ["`Project Doc (.rvt)`"]
        INST["`Placed Family Instances`"]
        CIRC["`ElectricalSystem
(Electrical Circuits)`"]
        PANEL["`Electrical Equipment
(panel family instance)`"]
        TEMP["`PanelScheduleTemplate`"]
        VIEW["`PanelScheduleView`"]
        DATA["`PanelScheduleData`"]
        ESET["`ElectricalSetting
DistributionSysType
Naming settings`"]
        LC["`ElectricalLoadClassification`"]
        DF["`ElectricalDemandFactorDefinition`"]
    end

    CONN --> INST
    INST --> CIRC
    CIRC --> WIRE["`Wire`"]
    CIRC --> PANEL
    TEMP --> VIEW
    PANEL --> VIEW
    VIEW --> DATA
    ESET --> CIRC
    ESET --> PANEL
    LC --> CIRC
    LC --> VIEW
    DF --> LC
```

Rule:

- `ElectricalSystem` owns circuit identity
- `Wire` is attached to that circuit as routing/graphics
- `WireType` owns conductor/material defaults, not panel-row identity

## 2. What Each Schedule Section Can Read

```mermaid
---
config:
  markdownAutoWrap: true
  flowchart:
    wrappingWidth: 150
---
flowchart LR
    EE["`Electrical Equipment`"] --> HF["`Header / Footer`"]
    PI["`Project Information`"] --> HF

    EC["`Electrical Circuits`"] --> BODY["`Circuit Table Body`"]

    EE --> LS["`Load Summary`"]
    LC["`ElectricalLoadClassification`"] --> LS
    DF["`ElectricalDemandFactorDefinition`"] --> LS
```

## 3. Parameter Home Decision

```mermaid
---
config:
  markdownAutoWrap: true
  flowchart:
    wrappingWidth: 150
---
flowchart TD
    START["`Need a value in or around a panel schedule`"] --> Q1{"`True electrical behavior?`"}
    Q1 -- Yes --> CONN["`Family params
associated to connector params`"]
    Q1 -- No --> Q2{"`Panel metadata?`"}
    Q2 -- Yes --> EE["`Bind to Electrical Equipment`"]
    Q2 -- No --> Q3{"`Must appear in body row?`"}
    Q3 -- Yes --> EC["`Must exist on Electrical Circuits`"]
    Q3 -- No --> Q4{"`Needed only for load summary / demand?`"}
    Q4 -- Yes --> LC["`Use ElectricalLoadClassification
+ DemandFactorDefinition`"]
    Q4 -- No --> META["`Family metadata only
No native panel-body path`"]
```

## 4. Native Flow vs Dead Ends

```mermaid
---
config:
  markdownAutoWrap: true
  flowchart:
    wrappingWidth: 135
---
flowchart LR
    V["`PE_E___Voltage`"] --> CV["`Connector Voltage`"] --> EV["`Circuit Voltage`"]
    AP["`PE_E___ApparentPower`"] --> CAP["`Connector Load`"] --> EAP["`Circuit Apparent Load / Current`"]
    NP["`PE_E___NumberOfPoles`"] --> CNP["`Connector Poles`"] --> ENP["`Circuit Poles / Slot Behavior`"]
    LCX["`PE_E___LoadClassification`"] --> CL["`Connector Load Classification`"] --> LSUM["`Load Summary / Demand`"]

    TAG["`PE_G___TagInstance`"] -. "`no native flow`" .-> DEAD1["`Not readable by panel body`"]
    ROOM["`PE_M___ServesRoom`"] -. "`no native flow`" .-> DEAD1
    MCA["`PE_E___MCA`"] -. "`no native flow`" .-> DEAD2["`Not circuit-owned`"]
    MOCP["`PE_E___MOCP`"] -. "`no native flow`" .-> DEAD2
```

## 5. Wire Parentage

```mermaid
---
config:
  markdownAutoWrap: true
  flowchart:
    wrappingWidth: 135
---
flowchart LR
    LOAD["`Load / proxy element
ex: DH-1 receptacle`"] --> CIRC["`ElectricalSystem
ex: L-1`"]
    CIRC --> WIRE["`Wire instance
drawn run / homerun graphic`"]
    WIRE --> WTYPE["`WireType
THWN / Copper / neutral-sharing defaults`"]
    CIRC --> PS["`Panel schedule row`"]
```

Observed example:

- proxy receptacle `DH-1` -> circuit `L-1`
- selected wire `6714280` -> `MEPSystem = ElectricalSystem 6714279`
- wire type `THWN (Copper w/ Neutral)` controls conductor/material defaults
- panel schedule reads the circuit, not the wire

## 6. `Load Name` Reality

```mermaid
---
config:
  markdownAutoWrap: true
  flowchart:
    wrappingWidth: 120
---
flowchart LR
    MARK["`Element Mark
ex: HOOD-1`"] --> CNAME["`Circuit Load Name
RBS_ELEC_CIRCUIT_NAME`"]
    ROOMX["`Room / location context
source may vary`"] --> CNAME
    CNAME --> ROW["`Panel row cell
Load Name`"]
```

Observed live examples:

- `HOOD-1 - Kitchen 100`
- `EVSE-1 - Carport`
- `Panel 'L'`

## 7. Load Classification Identity Problem

```mermaid
---
config:
  markdownAutoWrap: true
  flowchart:
    wrappingWidth: 150
---
flowchart TD
    LCParam["`Family/shared parameter
datatype = SpecTypeId.Reference.LoadClassification`"] --> Assoc["`Associated to connector
RBS_ELEC_LOAD_CLASSIFICATION`"]

    subgraph FD["`Standalone Family Doc`"]
        NoElems["`No durable project-side
ElectricalLoadClassification set`"]
    end

    subgraph PD["`Project Doc`"]
        ProjElems["`ElectricalLoadClassification elements
(document-local ElementIds)`"]
        Demand["`ElectricalDemandFactorDefinition`"]
        ProjElems --> Demand
    end

    Assoc --> NoElems
    ProjElems --> SetVal["`FamilyManager.Set(fp, ElementId)
only valid with ids from same doc`"]
    SetVal --> Assoc
```

Rule:

- association is portable
- referenced value identity is document-local

## 8. Breaker / MOCP Limitation

```mermaid
---
config:
  markdownAutoWrap: true
  flowchart:
    wrappingWidth: 145
---
flowchart TD
    DEV["`Child load families
MOCP / MCA / office metadata`"] --> Q{"`Can panel body compute
custom aggregate natively?`"}
    Q -- No --> CIRC["`User / workflow sets circuit
Rating or Rating Override Value`"]
    CIRC --> ROW["`Breaker-size style column`"]
```

## 9. Repo Touchpoints

```mermaid
---
config:
  markdownAutoWrap: true
  flowchart:
    wrappingWidth: 130
---
flowchart LR
    MEC["`MakeElecConnector.cs`"] --> CONN["`Connector param association`"]
    CMD["`CmdScriptingWorkspace.cs`"] --> SCR["`Live Revit probe lane`"]
    EXEC["`RevitScriptExecutionService.cs`"] --> SCR
    SCR --> API["`ElectricalSystem
ElectricalEquipment
PanelScheduleView
ElectricalLoadClassification
Wire`"]
```
