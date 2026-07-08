using Pe.App.Commands.FamilyFoundry;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.App.Commands.Palette.ViewPalette;
using Pe.App.Commands.Schedules;
using Pe.Revit.Ui.Core;
using Wpf.Ui.Controls;

namespace Pe.App.Commands.Palette;

/// <summary>
///     Single source of truth for the palette switcher. Statically defined; each entry launches
///     through the palette's existing Show()/Run() entry point. The switcher re-enters Revit API
///     context before invoking <see cref="PaletteSwitcherEntry.Launch" />, so these delegates run
///     exactly where the ribbon commands run.
/// </summary>
public static class PaletteRegistry {
    public static IReadOnlyList<PaletteSwitcherEntry> Entries { get; } = [
        new() {
            Name = "Go",
            Description = "Views, sheets, schedules, and family placement",
            Icon = SymbolRegular.Navigation24,
            Family = PaletteFamily.Navigate,
            IsAvailable = uidoc => !uidoc.Document.IsFamilyDocument,
            Launch = _ => ViewPaletteBase.ShowPalette(0)
        },
        new() {
            Name = "Do",
            Description = "Run any Revit command or task",
            Icon = SymbolRegular.Flash24,
            Family = PaletteFamily.Navigate,
            Launch = uiapp => CmdPltCommands.Show(uiapp, 0)
        },
        new() {
            Name = "MRU Views",
            Description = "Jump to recently visited views",
            Icon = SymbolRegular.ClockArrowDownload24,
            Family = PaletteFamily.Navigate,
            Launch = CmdPltMruViews.Open
        },
        new() {
            Name = "Elements",
            Description = "Select and zoom placed instances or family elements",
            Icon = SymbolRegular.CubeMultiple24,
            Family = PaletteFamily.Author,
            Launch = uiapp => ElementsPalette.Show(uiapp)
        },
        new() {
            Name = "Schedule Manager",
            Description = "Create schedules from saved profiles",
            Icon = SymbolRegular.DocumentTable24,
            Family = PaletteFamily.Author,
            IsAvailable = uidoc => !uidoc.Document.IsFamilyDocument,
            Launch = uiapp => new CmdScheduleManager().Run(uiapp)
        },
        new() {
            Name = "Family Foundry Manager",
            Description = "Apply Family Foundry profiles to this family",
            Icon = SymbolRegular.WrenchScrewdriver24,
            Family = PaletteFamily.Author,
            IsAvailable = uidoc => uidoc.Document.IsFamilyDocument,
            Launch = uiapp => new CmdFFManager().Run(uiapp)
        }
    ];
}
