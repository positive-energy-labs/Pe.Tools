# Revit Panel Schedule Decision Trees

## 0. Which Vocabulary Should I Use?

```text
Talking to users about what they see?
  -> panel, circuit row, wire, homerun, load summary, panel schedule

Talking about ownership / data flow / API?
  -> ElectricalEquipment, ElectricalSystem, Wire, WireType,
     PanelScheduleView, PanelScheduleTemplate, PanelScheduleData

Talking about office workarounds?
  -> call them proxies / stand-ins explicitly
```

## 1. Where Should This Parameter Live?

```text
Need to affect true electrical behavior?
  -> family param associated to connector param

Need to show in panel header/footer?
  -> bind to Electrical Equipment

Need to show in panel body row?
  -> must exist on Electrical Circuits

Need to affect load summary / demand?
  -> use real ElectricalLoadClassification + ElectricalDemandFactorDefinition

Need arbitrary family metadata in panel body?
  -> no native path
```

## 2. Can This Family Param Show In The Panel Body?

```text
Is it already a circuit built-in result?
  -> yes: show the built-in field

Can it drive connector electrical values?
  -> yes: maybe indirectly, through circuit built-ins

Is it only family/category metadata?
  -> no: not natively
```

Examples:

- `PE_E___Voltage` -> yes, indirectly
- `PE_E___ApparentPower` -> yes, indirectly
- `PE_E___NumberOfPoles` -> yes, indirectly
- `PE_E___LoadClassification` -> yes, indirectly
- `PE_G___TagInstance` -> no
- `PE_M___ServesRoom` -> no
- `PE_E___MCA` -> no
- `PE_E___MOCP` -> no

## 3. Can Revit Calculate This Natively?

```text
Connector load/current/voltage/poles?
  -> usually yes

Demand by load classification?
  -> yes, with project classifications + demand-factor definitions

Panel metadata like main size / AIC / fed-from text?
  -> yes, if panel-owned

Aggregate arbitrary child params across a circuit?
  -> no

Combine all connected child tags into one circuit row cell?
  -> no

Calculate breaker size from office-specific MCA/MOCP rules?
  -> not fully natively
```

## 4. Best Native Home For `PE_*`

Use on connector:

- `PE_E___Voltage`
- `PE_E___ApparentPower`
- `PE_E___NumberOfPoles`
- `PE_E___LoadClassification`
- `PE_E___Phase` when it is truly electrical behavior

Use on `Electrical Equipment`:

- `PE_E___FedFromOverrideText`
- `PE_E___FedFromOverrideYesNo`
- `PE_E___MainBreakerRating`
- `PE_E___MinAICRating`
- `PE_E___MinBusRating`
- `PE_E___NEMAEnclosureRating`
- `PE_E___SubFeedBreakerRating`
- `PE_E___TypeOfMain`
- `PE_E___NumberOfSpaces`
- `PE_E___NumberOfWires`
- `PE_E___VoltageLtoL`
- `PE_E___VoltageLtoN`

Keep as family metadata unless manually duplicated:

- `PE_G___TagInstance`
- `PE_M___ServesRoom`
- `PE_E___MCA`
- `PE_E___MOCP`
- `PE_E___FLA`
- `PE_E___LRA`
- `PE_E___Frequency`
- `PE_E___EquipmentConnection`
- `PE_E_LoadCalc_*`

## 5. If The Goal Is...

```text
"Better panel row values"
  -> prefer circuit built-ins first

"Better header/footer data"
  -> panel-owned params

"Better demand/load summary"
  -> load classifications + demand definitions

"Better naming"
  -> circuit Load Name, often with Mark as upstream human input

"Show company metadata from the load families"
  -> regular schedules or manual duplicate-to-circuit, not native panel body
```

## 6. If The Question Is About Wires...

```text
Need circuit identity, panel row data, or load name?
  -> inspect ElectricalSystem

Need routing, homerun graphics, or drawn-wire conductor counts?
  -> inspect Wire instance

Need copper / insulation / neutral-sharing defaults?
  -> inspect WireType

Need panel schedule wire columns?
  -> start from the circuit/template, then verify wire settings
```
