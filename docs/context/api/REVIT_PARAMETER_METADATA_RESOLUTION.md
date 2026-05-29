# Revit Parameter Model

This document captures the mental model, decision trees, and technical details
for creating and managing parameters in Revit, derived from the "Revit Parameter
Model" infographic.

## 1. Scoping: Project vs. Family

Parameters are divided into two primary scopes:

- **Project-Scoped**: Exist at the Project document (`.rvt`) level.
  - **Project Parameter (PP)**
  - **Project Shared Parameter (PSP)**
- **Family-Scoped**: Exist at the Family document (`.rfa`) level.
  - **Shared Parameter (SP)**
  - **Family Parameter (FP)**

This model is specifically about **authored parameters** (PP / PSP / SP / FP).
Built-in Revit parameters are adjacent to this model but are not one of these
four authored types.

## 2. Decision Tree: What Parameter Type to Create?

When deciding what type of parameter to create, ask:

- **Is it Schedulable?**
  - **No** ➔ `Family Parameter`
  - **Yes** ➔ **Is it Tag-able?** (and the parameter will exist in other
    families/tags)
    - **No** ➔ `Project Parameter`
    - **Yes** ➔ **Do you need to (1) set a default for the param, OR (2) ensure
      it stays on the family when saving?**
      - **No** ➔ `Project Shared Parameter`
      - **Yes** ➔ `Shared Parameter`

You may also ask yourself these broader questions:

- **Is it project-specific only?** (e.g., design conditions, architectural name)
  - **Yes** ➔ `Project-Scoped Parameter` (PP or PSP)
- **Does it need to be associable?** (e.g., used in dims, formulas, arrays,
  labels, connectors)
  - **Yes** ➔ `Family-Scoped Parameter` (SP or FP)

## 3. How to Create Each Parameter Type

_(Note: Steps marked as "Optional" can be skipped if the shared parameter
definition already exists)._

- **Project Parameter (PP)**
  - **Step 1 (Mandatory)**: Create in the Project document (`.rvt`) via the
    `Project Parameters` command.
- **Project Shared Parameter (PSP)**
  - **Step 1 (Optional)**: Create a Shared Parameter Definition (in SP `.txt` or
    Parameters Service).
  - **Step 2 (Mandatory)**: Add to the Project document (`.rvt`) via the
    `Project Parameters` command.
- **Shared Parameter (SP)**
  - **Step 1 (Optional)**: Create a Shared Parameter Definition (in SP `.txt` or
    Parameters Service).
  - **Step 2 (Mandatory)**: Add to the Family document (`.rfa`) via the
    `Family Types` command.
- **Family Parameter (FP)**
  - **Step 1 (Mandatory)**: Create in the Family document (`.rfa`) via the
    `Family Types` command.

## 4. Comparison & Behavior

Shared parameters are special because they can exist in the project and/or
family. This is a conceptual thrid region in the venn diagram enclosing SPs and
PSPs.

### Project-Scoped (PP & PSP)

- **Use For**: Project-wide organization/metadata (PP) or parameters applying to
  many families like design conditions (PSP).
- **Behavior**: Exist in `.rvt`. Will not exist on the family when saving it
  out. No default instance values; type values apply globally to family types.
- **Pros**: Low performance overhead, cleaner family editing (fewer parameters),
  cleanly separates project vs. equipment concerns, easy cross-family
  coordination, controls model group behavior.
- **Cons**: Doesn't travel with the family, cannot associate to
  geometry/formulas, always starts empty (but type parameters in the project
  will apply per type once set).

### Family-Scoped (SP & FP)

- **Use For**: Equipment-specific data needed in both `.rvt` and `.rfa` (SP) or
  driving internal family geometry/behavior (FP).
- **Behavior**: Exist in `.rfa`. Saves and transfers with the family. Supports
  default values for both instance and type parameters.
- **Pros**: Can associate to dimensions/arrays/connectors, can be used in
  formulas, preserves default values, travels with the family file.
- **Cons**: Large counts of parameters (of any kind) can increase family
  authoring friction and UI clutter; excessive parameter-driven constraints can
  increase regen cost; difficult to coordinate Type/Instance or Properties Group
  across multiple families (which may be unimportant).

## 5. Parameter Property Merge & Resolution Priority

To schedule/tag in a given project, the parameter must exist on the element
instances in that project—either because it’s in the family or because it’s
project-bound. It does not have to be both.If a shared parameter only exists on
a family, the version on the family controls how it behaves in the project. If a
shared parameter only exists bound to a category in a project, this version
controls behavior. The intended usage of these two shared parameters types is
probably not having them in both places and thus this should try to be avoided.
Property merging described below is just a safeguard to add consistency in the
situation a shared parameter is both an SP on a family and a PSP.

When a parameter is bound in the project (PSP) AND exists in the family (SP),
their properties merge upon reopening the family.

**Absolute Precedents (P0):**

- **Shared Parameter Definition** provides: `Name` and `Datatype`.
- **Project Shared Parameter (PSP)** provides: `Category Binding` and
  `Group Behavior` (align per group type vs. vary by instance)
- **Family-Scoped Shared Parameter (SP)** provides: `Type/Instance` designation

**Override Priorities** (P1 overrides P2) **PSP (P1) overrides SP (P2)** for:

- `Properties Group`
- `Tooltip`

_(In other words: The Definition provides Name/Datatype. The Family controls
Type/Instance. The Project controls Properties Group and Tooltip.)_

Practical note: the priorities above describe the observed working model and
should be treated as a tested rule of thumb, not as an Autodesk-guaranteed
contract.

## 6. Parameter Options & Metadata Notes

- **Type/Instance on PSPs**: A PSP's Type/Instance designation _only_ applies if
  the family does not already have that shared parameter scoped to it. If the
  family already has the parameter, the PSP's Type/Instance setting is ignored.
- **Category & Group Behavior**:
  - Binding to a category is mandatory for PPs and PSPs. The parameter will
    appear on all instances of families created for that category.
  - Allows you to control the model group behavior of the PP or PSP. Plain SPs
    and FPs cannot have their group behavior controlled.

    > [InternalDefinition.SetAllowVaryBetweenGroups](https://rvtdocs.com/2025/6f5af0cc-2ab3-153a-e07d-78fbc12aefc1/)
    >
    > When a parameter is set to not vary between groups Revit will
    > automatically align the parameter values of any elements that actually
    > varied between group instances.

- **Properties Group & Tooltip**:
  - Defaults for these can be set in Parameters Service, but _not_ in the Shared
    Parameters `.txt` file.
  - Because these are purely aesthetic and unrelated to data integrity, they can
    be changed anywhere at any time.
- **Tooltip Syncing Hack**:
  - Tooltips are technically provided by the Shared Parameter Definition (SPD)
    and you can only change a tooltip if the SPD lives in Parameters Service.
  - Setting the tooltip is _not_ something you can change from the Project
    Parameters dialog.
  - **The Hack**: To reliably push updated Parameters Service tooltips to a
    project (applying to all families of a category at once):
    1. Update the tooltip in Parameters Service.
    2. Add the parameter to the project as a project parameter.
    3. Remove the parameter from the project parameters.

## 7. Minimal Revit API Example

This example demonstrates how to

- retrieve/query project parameters and they're properties/metadata
- how InternalDefinition and ExternalDefinition differ when using them as the
  source for insertion
- insert or update project parameter bindings
- get SharedParameterElements

Important API clarification: once a project parameter binding exists in a
project document, iterating `doc.ParameterBindings` yields `InternalDefinition`
keys. Shared-ness on that project-side surface should therefore be resolved via
`SharedParameterElement` / GUID, not by expecting the binding key itself to be
an `ExternalDefinition`.

```output
=== Step 1: BEFORE first bind (expect not found) ===

count total: 108
count PSP: 75
count matched: 0

=== Step 2: INSERT with group=Other, category=Mechanical Equipment ===
BindingMap.Insert ok (using provided type: ExternalDefinition)
Instance | _LP_Project_Example
  guid=ab940104-84ff-4f56-9fbe-47afbff0d785
  group=Other
  datatype=Text
  categories=Mechanical Equipment

count total: 109
count PSP: 76
count matched: 1

=== Step 3: REINSERT with group=Identity Data, category=Plumbing Equipment ===
BindingMap.ReInsert ok (using provided type: ExternalDefinition)
Type | _LP_Project_Example
  guid=ab940104-84ff-4f56-9fbe-47afbff0d785
  group=Identity Data
  datatype=Text
  categories=Plumbing Equipment

count total: 109
count PSP: 76
count matched: 1

=== Step 4A: REINSERT via InternalDefinition from SAME SharedParameterElement ===
BindingMap.ReInsert ok (using provided type: InternalDefinition)
Type | _LP_Project_Example
  guid=ab940104-84ff-4f56-9fbe-47afbff0d785
  group=Insulation
  datatype=Text
  categories=Mechanical Equipment

count total: 109
count PSP: 76
count matched: 1

=== Step 4B: Optional - bind via InternalDefinition from SOME OTHER SharedParameterElement ===
BindingMap.Insert ok (using provided type: InternalDefinition)
Type | TBD
  guid=e0c3bc66-3830-49b7-ac12-095d16a35284
  group=Electrical
  datatype=Yes/No
  categories=Mechanical Control Devices

count total: 110
count PSP: 77
count matched: 1
```

For context, here are some other exmaples of project parameters being logged:

```output
Instance | GFCI Breaker (Yes/No)
  guid=
  group=Identity Data
  datatype=Yes/No
  categories=Electrical Fixtures
Type | NEC Load Filter
  guid=65dd7270-6b59-4f9e-a9ae-8dfea06d4fc9
  group=Text
  datatype=Text
  categories=Plumbing Equipment, Mechanical Equipment, Electrical Fixtures, Electrical Equipment
Instance | _Project_Param_Test
  guid=d6ca4617-8114-4ae9-a4fa-e89ad4e0b8f8
  group=Identity Data
  datatype=Text
  categories=Mechanical Equipment
```

And this is a rudamentary log of SharedParameterElement `.Name` and `.GuidValue`
properties:

```output
Airflow rate(Low-Mid-High) (L/s)
  guid=486ef636-b629-44be-a270-a7a7fbeb4304
Airflow rate(Low-Mid-High) (m3/min)
  guid=09960be5-9175-49e9-8b56-361101522b2e
Alignment Marks Visible
  guid=911e1d17-6b82-4af3-863d-ca60070775f4
Alignment Visible
  guid=e1f81f20-33ff-4c77-9c86-3bb2605b0659
```

```csharp
using Autodesk.Revit.DB;
using System;
using System.IO;
using System.Linq;
using Nice3point.Revit.Extensions; // for ForgeTypeId.ToLabel()

// ...

  static void DemoProjectParameterInsertion(Document doc) {
      // Demonstrating Insert/ReInsert into BindingMap
      // parameters can only be bound within a project document
      if (!doc.IsFamilyDocument) {
          static void LogBindingInfo((bool defExists, bool bindSuccess, string providedDefType) info) =>
              Console.WriteLine($"BindingMap.{(!info.defExists ? "Insert" : "ReInsert")} {(info.bindSuccess ? "ok" : "failed")} (using provided type: {info.providedDefType})");

          var extDef = GetOrCreateExternalDefinition(doc.Application, "_LP_Project_Example");

          Console.WriteLine("\n=== Step 1: BEFORE first bind (expect not found) ===");
          LogProjectParam(doc, extDef);

          var log2 = AddProjectParameter(doc, extDef,
              isInstance: true,
              new(), // puts in Other group
              BuiltInCategory.OST_MechanicalEquipment
          );
          Console.WriteLine("\n=== Step 2: INSERT with group=Other, category=Mechanical Equipment ===");
          LogBindingInfo(log2);
          LogProjectParam(doc, extDef);

          var log3 = AddProjectParameter(doc, extDef,
              isInstance: false,
              GroupTypeId.IdentityData,
              BuiltInCategory.OST_PlumbingEquipment
          );
          Console.WriteLine("\n=== Step 3: REINSERT with group=Identity Data, category=Plumbing Equipment ===");
          LogBindingInfo(log3);
          LogProjectParam(doc, extDef);

          var sharedElement = SharedParameterElement.Lookup(doc, extDef.GUID);
          if (sharedElement == null) {
              Console.WriteLine("\n=== Step 4A SKIPPED: SharedParameterElement not found in document ===");
          } else {
              var log4a = AddProjectParameter(doc, sharedElement.GetDefinition(),
                  isInstance: false,
                  GroupTypeId.Insulation,
                  BuiltInCategory.OST_MechanicalEquipment
              );
              Console.WriteLine("\n=== Step 4A: REINSERT via InternalDefinition from SAME SharedParameterElement ===");
              LogBindingInfo(log4a);
              LogProjectParam(doc, sharedElement.GetDefinition());
          }

          var otherSp = new FilteredElementCollector(doc)
              .OfClass(typeof(SharedParameterElement))
              .Cast<SharedParameterElement>()
              .FirstOrDefault(x => x.GuidValue != extDef.GUID);

          if (otherSp == null) {
              Console.WriteLine("\n=== Step 4B SKIPPED: No other SharedParameterElement found in document ===");
          } else {
              var log4b = AddProjectParameter(doc, otherSp.GetDefinition(),
                  isInstance: false,
                  GroupTypeId.Electrical,
                  BuiltInCategory.OST_MechanicalControlDevices
              );
              Console.WriteLine("\n=== Step 4B: Optional - bind via InternalDefinition from SOME OTHER SharedParameterElement ===");
              LogBindingInfo(log4b);
              LogProjectParam(doc, otherSp.GetDefinition());
          }
      }
  }

  /// <summary>
  /// Add/update a project parameter binding with very linear control flow.
  /// Once an ExternalDefinition has been bound already, 
  ///
  /// Definition behavior:
  /// - ExternalDefinition: valid for creating a new bound definition in project.
  /// - InternalDefinition: valid only when already present in this document.
  /// - SharedParameterElement.GetDefinition() returns InternalDefinition, so it
  ///   behaves like an existing project-side definition.
  ///
  /// BindingMap gotchas:
  /// - Insert(...) returns false if binding already exists.
  /// - ReInsert(...) returns false if binding does not yet exist.
  /// - One definition cannot be both instance-bound and type-bound at once.
  /// </summary>
  /// <param name="definition">Can be either an InternalDefinition or ExternalDefinition. TODO: document the difference
  public static (bool defExisted, bool bindSuccess, string providedDefType) AddProjectParameter(
      Document doc,
      Definition definition,
      bool isInstance,
      ForgeTypeId group,
      params BuiltInCategory[] categories
  ) {
      if (doc.IsFamilyDocument) throw new InvalidOperationException("Requires project document.");

      // Step 2: build category set.
      var catSet = doc.Application.Create.NewCategorySet();
      foreach (var bic in categories) {
          var cat = Category.GetCategory(doc, bic);
          if (cat == null) continue;
          _ = catSet.Insert(cat);
      }

      // Step 3: choose scope.
      ElementBinding binding = isInstance
          ? doc.Application.Create.NewInstanceBinding(catSet)
          : doc.Application.Create.NewTypeBinding(catSet);

      // Step 4: insert or reinsert.
      using var tx = new Transaction(doc, $"Bind parameter: {definition.Name}");
      _ = tx.Start();
      var map = doc.ParameterBindings;
      var exists = map.Contains(definition);
      var ok = !exists
          ? map.Insert(definition, binding, group)
          : map.ReInsert(definition, binding, group);
      _ = tx.Commit();

      return (exists, ok, definition.GetType().Name);
  }

  /// <summary>
  /// Get/create a shared definition in a temporary shared parameters file.
  /// API gotcha: Revit can point to only one shared parameters file at a time
  /// (Application.SharedParametersFilename). Restore the previous value after use.
  /// </summary>
  static ExternalDefinition GetOrCreateExternalDefinition(
      Autodesk.Revit.ApplicationServices.Application app,
      string parameterName
  ) {
      var previousPath = app.SharedParametersFilename;
      var tempPath = Path.Combine(Path.GetTempPath(), "launchpad-temp-shared-params.txt");

      if (!File.Exists(tempPath)) File.WriteAllText(tempPath, string.Empty);

      try {
          app.SharedParametersFilename = tempPath;
          var defFile = app.OpenSharedParameterFile()
              ?? throw new InvalidOperationException("Failed to open shared parameter file.");

          var group = defFile.Groups.get_Item("LaunchpadTemp")
              ?? defFile.Groups.Create("LaunchpadTemp");

          var existing = group.Definitions.get_Item(parameterName) as ExternalDefinition;
          if (existing != null) return existing;

          var options = new ExternalDefinitionCreationOptions(parameterName, SpecTypeId.String.Text) {
              Description = "Launchpad ParametersTest temp definition"
          };
          return (ExternalDefinition)group.Definitions.Create(options);
      } finally {
          app.SharedParametersFilename = previousPath;
      }
  }

  static void LogProjectParam(Document doc, Definition targetDef) {
      var it = doc.ParameterBindings.ForwardIterator();
      var countTouched = 0;
      var countTotal = 0;
      var countPSP = 0;
      var countMatches = 0;

      while (it.MoveNext()) {
          countTouched++;
          if (it.Key is not InternalDefinition idef || it.Current is not ElementBinding binding) continue;
          countTotal++;

          static bool IsTargetDefinition(InternalDefinition currentInternal, string sharedGuid, Definition targetDef) => targetDef switch {
              InternalDefinition idef => currentInternal.Id == idef.Id,
              ExternalDefinition edef when Guid.TryParse(sharedGuid, out var guid) => guid == edef.GUID,
              _ => false
          };

          var sharedGuid = (doc.GetElement(idef.Id) as SharedParameterElement)?.GuidValue.ToString();
          if (sharedGuid != null) countPSP++;
          var matchesTarget = IsTargetDefinition(idef, sharedGuid, targetDef);
          if (!matchesTarget) continue;
          countMatches++;

          LogProjectParamInfo(doc, idef, binding);
      }

      Console.WriteLine($"\ncount total: {countTotal}\ncount PSP: {countPSP}\ncount matched: {countMatches}");
      if (countMatches > 1)
          Console.WriteLine("WARNING: multiple matches found for target definition, this is unexpected and may indicate a problem with the test setup.");
      if (countTouched != countTotal) Console.WriteLine("UNEXPECTED: not all bindings were `InternalDefinition: ElementBinding`");
  }


  static void LogProjectParamInfo(Document doc, InternalDefinition idef, ElementBinding binding) {
      var dataTypeId = idef.GetDataType().ToLabel();
      var groupTypeId = idef.GetGroupTypeId().ToGroupLabel();
      var sharedGuid = (doc.GetElement(idef.Id) as SharedParameterElement)?.GuidValue.ToString();

      var scope = binding switch {
          InstanceBinding _ => "Instance",
          TypeBinding _ => "Type",
          _ => "(unknown scope, this is concerning)"
      };

      var cats = string.Join(", ", binding.Categories.OfType<Category>().Select(c => c.Name));

      Console.WriteLine($"{scope} | {idef.Name}");
      Console.WriteLine($"  guid={sharedGuid}");
      Console.WriteLine($"  group={groupTypeId}");
      Console.WriteLine($"  datatype={dataTypeId}");
      Console.WriteLine($"  categories={cats}");
  }
```
