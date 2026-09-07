using System.Windows.Media;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Revit.Extensions.RvtUiApplication;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Global.Ui;
using Pe.Revit.Ui.Core;
using Serilog.Events;
using System.Diagnostics;
using System.Windows.Input;
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
        var items = MruViewBuffer.Instance
            .GetMruOrderedViews(uiapp)
            .Select(v => new MruViewPaletteItem(v))
            .ToList();

        var customKeys = new CustomKeyBindings();
        customKeys.Add(Key.OemTilde, NavigationAction.MoveDown, ModifierKeys.Control); // Ctrl+` cycles forward
        customKeys.Add(Key.OemTilde, NavigationAction.MoveUp,
            ModifierKeys.Control | ModifierKeys.Shift); // Ctrl+Shift+` cycles backward

        var window = PaletteFactory.Create("Mru Views Palette",
            new PaletteOptions<MruViewPaletteItem> {
                SearchConfig = null, // Disable search for MRU palette
                CustomKeyBindings = customKeys,
                Tray = new PaletteTray { Content = CreateColoringToggle() },
                ViewModelMutator = vm => {
                    // Select second item (first is current view, second is previous)
                    if (vm.FilteredItems.Count > 1) vm.SelectedIndex = 1;
                },
                Tabs = [
                    new TabDefinition<MruViewPaletteItem>(
                        "All",
                        () => items,
                        new PaletteAction<MruViewPaletteItem> {
                            Name = "Open View",
                            Execute = item => {
                                if (item.View != null)
                                    uiapp.OpenAndActivateView(item.View);
                            }
                        }
                    )
                ],
                OnCtrlReleased = vm => () => {
                    // Read the current SelectedItem when Ctrl is released (not at window creation)
                    var selectedItem = vm.SelectedItem;
                    if (selectedItem?.View != null)
                        uiapp.OpenAndActivateView(selectedItem.View);
                }
            });
        window.Show();
    }

    /// <summary>Tab-coloring controls: on/off, and whole-tab fill vs top bar only.</summary>
    private static System.Windows.Controls.StackPanel CreateColoringToggle() {
        var enabled = new System.Windows.Controls.CheckBox {
            Content = "Color Revit tabs",
            IsChecked = DocumentColorLedger.TabColoringEnabled,
            Margin = new System.Windows.Thickness(8, 4, 8, 2)
        };
        enabled.Checked += (_, _) => {
            DocumentColorLedger.TabColoringEnabled = true;
            RevitTabColorizer.EnsureStarted();
        };
        enabled.Unchecked += (_, _) => {
            DocumentColorLedger.TabColoringEnabled = false;
            RevitTabColorizer.Stop();
        };

        var wholeTab = new System.Windows.Controls.CheckBox {
            Content = "Fill whole tab (vs top bar only)",
            IsChecked = DocumentColorLedger.WholeTabFill,
            Margin = new System.Windows.Thickness(8, 2, 8, 4)
        };
        wholeTab.Checked += (_, _) => {
            DocumentColorLedger.WholeTabFill = true;
            RevitTabColorizer.Refresh();
        };
        wholeTab.Unchecked += (_, _) => {
            DocumentColorLedger.WholeTabFill = false;
            RevitTabColorizer.Refresh();
        };

        var panel = new System.Windows.Controls.StackPanel();
        panel.Children.Add(enabled);
        panel.Children.Add(wholeTab);
        return panel;
    }
}

/// <summary>
///     Adapter that wraps Revit View to implement IPaletteListItem for MRU views
/// </summary>
public class MruViewPaletteItem : IPaletteListItem {
    public MruViewPaletteItem(View view) {
        this.View = view;
        this.ItemColor = DocumentColorLedger.GetColor(view.Document);
    }

    public View View { get; }
    public string TextPrimary => this.View.Name;
    public string TextSecondary => this.View.Document.Title;
    public string TextPill => this.View.ViewType.ToString();

    public Func<string> GetTextInfo => () =>
        $"Document: {this.View.Document.Title}\nView Type: {this.View.ViewType}\nId: {this.View.Id}";

    public ImageSource? Icon => null;
    public WpfColor? ItemColor { get; }
}
