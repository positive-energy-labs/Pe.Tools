using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Extensions.UiApplication;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Document;
using Pe.Ui.Core;
using Serilog.Events;
using System.Diagnostics;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using WpfColor = System.Windows.Media.Color;

namespace Pe.App.Commands.Palette;

[Transaction(TransactionMode.Manual)]
public class CmdPltMruViews : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        try {
            var uiapp = commandData.Application;
            Open(uiapp);
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }

    public static void Open(UIApplication uiapp) {
        var items = DocumentManager.Instance
            .GetMruOrderedViews(uiapp)
            .Select(v => new MruViewPaletteItem(v));

        var customKeys = new CustomKeyBindings();
        customKeys.Add(Key.OemTilde, NavigationAction.MoveDown, ModifierKeys.Control); // Ctrl+` cycles forward
        customKeys.Add(Key.OemTilde, NavigationAction.MoveUp,
            ModifierKeys.Control | ModifierKeys.Shift); // Ctrl+Shift+` cycles backward

        var window = PaletteFactory.Create("Mru Views Palette", items, new List<PaletteAction<MruViewPaletteItem>>(),
            new PaletteOptions<MruViewPaletteItem> {
                SearchConfig = null, // Disable search for MRU palette
                CustomKeyBindings = customKeys,
                ViewModelMutator = vm => {
                    // Select second item (first is current view, second is previous)
                    if (vm.FilteredItems.Count > 1) vm.SelectedIndex = 1;
                },
                OnCtrlReleased = vm => () => {
                    // Read the current SelectedItem when Ctrl is released (not at window creation)
                    var selectedItem = vm.SelectedItem;
                    if (selectedItem?.View != null)
                        uiapp.OpenAndActivateView(selectedItem.View);
                }
            });
        window.Show();
    }
}

/// <summary>
///     Adapter that wraps Revit View to implement IPaletteListItem for MRU views
/// </summary>
public class MruViewPaletteItem : IPaletteListItem {
    public MruViewPaletteItem(View view) {
        this.View = view;
        Console.WriteLine($"[MruViewPaletteItem] Creating item for view '{view.Name}' in doc '{view.Document.Title}'");
        var color = DocumentManager.Instance.GetDocumentColor(view.Document);
        this.ItemColor = color;
        Console.WriteLine($"[MruViewPaletteItem] Item created with color #{color.R:X2}{color.G:X2}{color.B:X2}");
    }

    public View View { get; }
    public string TextPrimary => this.View.Name;
    public string TextSecondary => this.View.Document.Title;
    public string TextPill => this.View.ViewType.ToString();

    public Func<string> GetTextInfo => () =>
        $"Document: {this.View.Document.Title}\nView Type: {this.View.ViewType}\nId: {this.View.Id}";

    public BitmapImage Icon => null;
    public WpfColor? ItemColor { get; }
}