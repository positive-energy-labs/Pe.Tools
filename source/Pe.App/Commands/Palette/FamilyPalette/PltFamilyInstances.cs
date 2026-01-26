using Autodesk.Revit.UI;
using Pe.App.Services;
using Pe.Global.PolyFill;
using Pe.Global.Revit.Ui;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Secondary palette for displaying and selecting family instances to zoom to.
///     Opened from the family palette when user wants to select specific instances.
/// </summary>
public static class PltFamilyInstances {
    /// <summary>
    ///     Creates a palette window for displaying family instances.
    /// </summary>
    public static Window CreatePalette(UIApplication uiapp, Family family) {
        var doc = uiapp.ActiveUIDocument.Document;
        var uidoc = uiapp.ActiveUIDocument;

        var items = new FilteredElementCollector(doc)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .Where(fi => fi.Symbol.Family.Id == family.Id)
            .OrderBy(fi => fi.Symbol.Name)
            .ThenBy(fi => fi.Id.Value())
            .Select(fi => new FamilyInstanceItem(fi))
            .ToList();

        var actions = new List<PaletteAction<FamilyInstanceItem>> {
            new() {
                Name = "Zoom to Instance",
                Execute = async item => {
                    if (item?.Instance == null) return;
                    uidoc.ShowElements(item.Instance.Id);
                    uidoc.Selection.SetElementIds([item.Instance.Id]);
                },
                CanExecute = item => item != null
            },
            // Snoop the FamilyInstance
            new() {
                Name = "Snoop Instance",
                Modifiers = ModifierKeys.Alt,
                Execute = async item => {
                    _ = RevitDbExplorerService.TrySnoopObject(
                        uiapp,
                        doc,
                        item.Instance,
                        $"Instance: {item.Instance.Symbol.Family.Name}: {item.Instance.Symbol.Name}");
                },
                CanExecute = item => item != null
            }
        };

        var window = PaletteFactory.Create($"{family.Name} Instances", items, actions,
            new PaletteOptions<FamilyInstanceItem> {
                SearchConfig = SearchConfig.PrimaryAndSecondary(),
                FilterKeySelector = item => item.TextPill
            });

        return window;
    }
}

public class FamilyInstanceItem : IPaletteListItem {
    public FamilyInstanceItem(FamilyInstance instance) {
        this.Instance = instance;
    }

    public FamilyInstance Instance { get; }

    public string TextPrimary => this.Instance.Symbol.Name;

    public string TextSecondary {
        get {
            // Get location info
            var location = this.Instance.Location;
            if (location is LocationPoint locPoint) {
                var pt = locPoint.Point;
                return $"Location: ({pt.X:F2}, {pt.Y:F2}, {pt.Z:F2})";
            }

            if (location is LocationCurve locCurve) {
                var midpoint = locCurve.Curve.Evaluate(0.5, true);
                return $"Location: ({midpoint.X:F2}, {midpoint.Y:F2}, {midpoint.Z:F2})";
            }

            return $"ID: {this.Instance.Id}";
        }
    }

    public string TextPill {
        get {
            // Get level or host info
            var level = this.Instance.get_Parameter(BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM)?.AsValueString();
            if (!string.IsNullOrEmpty(level))
                return level;

            var scheduleLevel = this.Instance.get_Parameter(BuiltInParameter.INSTANCE_SCHEDULE_ONLY_LEVEL_PARAM)
                ?.AsValueString();
            if (!string.IsNullOrEmpty(scheduleLevel))
                return scheduleLevel;

            return "No Level";
        }
    }

    public Func<string> GetTextInfo => () => {
        var lines = new List<string> {
            $"Family: {this.Instance.Symbol.Family.Name}",
            $"Type: {this.Instance.Symbol.Name}",
            $"ID: {this.Instance.Id}"
        };

        // Location
        var location = this.Instance.Location;
        if (location is LocationPoint locPoint) {
            var pt = locPoint.Point;
            lines.Add($"Point: ({pt.X:F4}, {pt.Y:F4}, {pt.Z:F4})");
        } else if (location is LocationCurve locCurve) {
            var start = locCurve.Curve.GetEndPoint(0);
            var end = locCurve.Curve.GetEndPoint(1);
            lines.Add($"Start: ({start.X:F4}, {start.Y:F4}, {start.Z:F4})");
            lines.Add($"End: ({end.X:F4}, {end.Y:F4}, {end.Z:F4})");
        }

        // Host
        var hostId = this.Instance.Host?.Id;
        if (hostId != null && hostId != ElementId.InvalidElementId) {
            var host = this.Instance.Document.GetElement(hostId);
            if (host != null)
                lines.Add($"Host: {host.Name} (ID: {hostId})");
        }

        // Level
        var level = this.Instance.get_Parameter(BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM)?.AsValueString();
        if (!string.IsNullOrEmpty(level))
            lines.Add($"Level: {level}");

        return string.Join(Environment.NewLine, lines);
    };

    public BitmapImage? Icon => null;
    public Color? ItemColor => null;
}
