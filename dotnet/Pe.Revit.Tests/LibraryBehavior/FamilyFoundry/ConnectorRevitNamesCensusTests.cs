using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>
///     `ConnectorRevitNames` against the Revit enums themselves: every contract value names a member apply can parse,
///     and every member capture can read maps back. A Revit year that renames a member fails here, not in an apply.
/// </summary>
[TestFixture]
public sealed class ConnectorRevitNamesCensusTests {
    [Test]
    public void Every_contract_value_names_a_revit_member_and_back() {
        foreach (var t in Enum.GetValues<ConnectorSystemType>()) {
            var name = ConnectorRevitNames.RevitName(t);
            Assert.That(Enum.IsDefined(typeof(DuctSystemType), name) || Enum.IsDefined(typeof(PipeSystemType), name) ||
                        Enum.IsDefined(typeof(ElectricalSystemType), name), Is.True, $"{t} → {name}");
            Assert.That(Enum.IsDefined(typeof(MEPSystemClassification), name) || name == nameof(ConnectorSystemType.Data), Is.True, $"{t} → {name}");
        }
        foreach (var name in Enum.GetNames<PipeSystemType>().Concat(Enum.GetNames<DuctSystemType>()).Concat(Enum.GetNames<ElectricalSystemType>())
                     .Where(n => n != "UndefinedSystemType"))
            Assert.That(ConnectorRevitNames.FromRevitName<ConnectorSystemType>(name), Is.Not.Null, name);
        foreach (var v in Enum.GetValues<FlowDirection>()) Assert.That(Enum.IsDefined(typeof(FlowDirectionType), ConnectorRevitNames.RevitName(v)), v.ToString());
        foreach (var v in Enum.GetValues<FlowConfiguration>()) Assert.That(Enum.IsDefined(typeof(PipeFlowConfigurationType), ConnectorRevitNames.RevitName(v)), v.ToString());
        foreach (var v in Enum.GetValues<LossMethod>()) Assert.That(Enum.IsDefined(typeof(PipeLossMethodType), ConnectorRevitNames.RevitName(v)), v.ToString());
    }
}
