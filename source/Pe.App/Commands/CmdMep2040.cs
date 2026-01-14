using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.UI;
using Pe.Global.Revit.Ui;
using Serilog.Events;
using System.Text;

namespace Pe.Tools.Commands;

[Transaction(TransactionMode.Manual)]
public class CmdMep2040 : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        var uiapp = commandData.Application;
        var uidoc = uiapp.ActiveUIDocument;
        var doc = uidoc.Document;

        var balloon = new Ballogger();
        var metalPipeLength = TotalPipeLength(doc);
        var refrigerantVolume = TotalPipeVolume(doc, "RL - Refrigerant Liquid");
        var equipmentCounts = CountMepEquipmentByType(doc);

        _ = balloon.Add(LogEventLevel.Information, null, $"Total Pipe Length: {metalPipeLength:F2} ft");
        _ = balloon.Add(LogEventLevel.Information, null, $"Total RL Volume: {refrigerantVolume:F2} ft³");
        var sb = new StringBuilder();
        foreach (var kvp in equipmentCounts)
            _ = sb.AppendLine($"  {kvp.Key}: {kvp.Value}");
        _ = balloon.Add(LogEventLevel.Information, null, "MEP Equipment Counts:\n" + sb);

        balloon.Show("MEP 2040 Sustainability Stats");

        return Result.Succeeded;
    }

    /// <summary>
    ///     Gets the total length of all Pipe elements in the document, optionally filtered by material name.
    /// </summary>
    private static double TotalPipeLength(Document doc, string materialName = null) {
        var pipes = new FilteredElementCollector(doc).OfClass(typeof(Pipe)).OfType<Pipe>();
        var totalLength = 0.0;
        foreach (var pipe in pipes) {
            // If materialName is specified, filter by materia
            if (!string.IsNullOrEmpty(materialName)) {
                var matIds = pipe.GetMaterialIds(false);
                var hasMaterial = matIds
                    .Select(id => doc.GetElement(id) as Material)
                    .Any(mat =>
                        mat != null
                        && mat.Name.Equals(materialName, StringComparison.OrdinalIgnoreCase)
                    );
                if (!hasMaterial)
                    continue;
            }

            var lengthParam = pipe.FindParameter(BuiltInParameter.CURVE_ELEM_LENGTH);
            if (lengthParam is { StorageType: StorageType.Double })
                totalLength += lengthParam.AsDouble();
        }

        // Convert from internal units (feet) to linear feet
        return totalLength;
    }

    /// <summary>
    ///     Gets the total volume of all Pipe elements in the document, optionally filtered by system type name.
    /// </summary>
    private static double TotalPipeVolume(Document doc, string pst = "") {
        var pipes = new FilteredElementCollector(doc).OfClass(typeof(Pipe)).OfType<Pipe>().Where(pipe =>
            pipe.FindParameter(BuiltInParameter.RBS_PIPING_SYSTEM_TYPE_PARAM) // EXTRACT THIS LATER
                .AsValueString() == pst
        );

        return pipes.Select(pipe => pipe.FindParameter(BuiltInParameter.HOST_VOLUME_COMPUTED))
            .Where(volParam => volParam != null && volParam.StorageType == StorageType.Double)
            .Sum(volParam => volParam.AsDouble());
    }

    /// <summary>
    ///     Gets a dictionary of MEP equipment counts by family and type name.
    /// </summary>
    private static Dictionary<string, int> CountMepEquipmentByType(Document doc) {
        var equipmentCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var collector = new FilteredElementCollector(doc)
            .OfCategory(BuiltInCategory.OST_MechanicalEquipment)
            .OfClass(typeof(FamilyInstance));
        foreach (var element in collector) {
            var fi = (FamilyInstance)element;
            var familyName = fi.Symbol?.Family?.Name ?? "<No Family>";
            var typeName = fi.Symbol?.Name ?? "<No Type>";
            var key = $"{familyName} : {typeName}";
            if (!equipmentCounts.ContainsKey(key))
                equipmentCounts[key] = 0;
            equipmentCounts[key]++;
        }

        return equipmentCounts;
    }
}