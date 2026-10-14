public static class Probe
{
    public const int MaxCircuits = 1000;
    public static bool IsCopy(Document d) => new[] { "copy", "sandbox" }.Any(marker => (d.Title ?? "").IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0);
    public static IEnumerable<Autodesk.Revit.DB.Electrical.ElectricalSystem> Circuits(Document d) => new FilteredElementCollector(d).OfClass(typeof(Autodesk.Revit.DB.Electrical.ElectricalSystem)).Cast<Autodesk.Revit.DB.Electrical.ElectricalSystem>();
    public static object Read(Autodesk.Revit.DB.Electrical.ElectricalSystem circuit)
    {
        var missing = new List<string>();
        double? Measure(string name, Func<double> get)
        {
            try { var value = get(); if (!double.IsNaN(value) && !double.IsInfinity(value)) return value; }
            catch (Exception e) { missing.Add(name + ": " + e.Message); return null; }
            missing.Add(name + ": not finite"); return null;
        }
        string wireSize = null, material = null;
        try { wireSize = circuit.WireSizeString; } catch (Exception e) { missing.Add("wireSize: " + e.Message); }
        try { material = circuit.WireType?.WireMaterial?.Name; } catch (Exception e) { missing.Add("material: " + e.Message); }
        var p = circuit.get_Parameter(BuiltInParameter.RBS_ELEC_CIRCUIT_WIRE_SIZE_PARAM);
        string raw = null;
        if (p != null && p.HasValue)
        {
            if (p.StorageType == StorageType.String) raw = p.AsString();
            else if (p.StorageType == StorageType.Integer) raw = p.AsInteger().ToString(System.Globalization.CultureInfo.InvariantCulture);
            else if (p.StorageType == StorageType.Double) raw = p.AsDouble().ToString("G17", System.Globalization.CultureInfo.InvariantCulture);
            else if (p.StorageType == StorageType.ElementId) raw = p.AsElementId().Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        return new {
            circuitId = circuit.Id.Value,
            voltage = Measure("voltage", () => UnitUtils.ConvertFromInternalUnits(circuit.Voltage, UnitTypeId.Volts)),
            amps = Measure("apparentCurrent", () => UnitUtils.ConvertFromInternalUnits(circuit.ApparentCurrent, UnitTypeId.Amperes)),
            length = Measure("length", () => UnitUtils.ConvertFromInternalUnits(circuit.Length, UnitTypeId.Feet)),
            wireSize, material,
            wireParameter = p == null ? null : (object)new { elementId = circuit.Id.Value, parameterId = p.Id.Value, parameterName = p.Definition.Name, storageType = p.StorageType.ToString(), isReadOnly = p.IsReadOnly, hasValue = p.HasValue, rawValue = raw },
            unavailable = missing
        };
    }
}
