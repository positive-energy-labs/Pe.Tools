using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Pe.Shared.StorageRuntime;
using Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;
using Pe.App.Commands.Palette.CommandPalette;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.App.Commands.Palette.ViewPalette;
using Pe.Revit.Tasks;
using Pe.Revit.Ui.Core;
using Pe.Revit.Ui.Core.Services;
using Pe.Revit.Ui.ViewModels;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using Palette = Pe.Revit.Ui.Components.Palette;

namespace Pe.App.Benchmarks;

internal static class PalettePerformanceProbe {
    // Invoke from a Revit callback and await after returning control to Revit.
    public static Task RunAsync(UIApplication uiapp, string outputDirectory, string fixturesDirectory,
        string expectedSessionId, int iterations = 6, bool verify = true) {
        var previous = SynchronizationContext.Current;
        SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));
        try { return MeasureAll(uiapp, outputDirectory, fixturesDirectory, expectedSessionId, iterations, verify); }
        finally { SynchronizationContext.SetSynchronizationContext(previous); }
    }

    // This measures actual WPF layout readiness in Revit, not GPU presentation or OS key delivery.
    private static async Task MeasureAll(UIApplication uiapp, string testDirectory, string fixturesDirectory,
        string expectedSessionId, int iterations, bool verify) {
        Require(iterations > 0, "At least one iteration is required");
        Directory.CreateDirectory(testDirectory);
        var output = Path.Combine(testDirectory, "palette-perf.csv");
        using var process = Process.GetCurrentProcess();
        File.WriteAllText(Path.Combine(testDirectory, "palette-perf-runtime.txt"),
            $"pid={process.Id}\nprocess={process.MainModule!.FileName}\n" +
            $"ui={typeof(Palette).Assembly.Location}\nuiMvid={typeof(Palette).Module.ModuleVersionId}\n" +
            $"tests={typeof(PalettePerformanceProbe).Assembly.Location}\n");
        Require(!string.IsNullOrWhiteSpace(expectedSessionId), "Expected session ID is required");
        Require(process.ProcessName == "Revit", "Not Revit");
        var descriptor = Environment.GetEnvironmentVariable("PE_REVIT_SESSION_DESCRIPTOR") ?? string.Empty;
        File.AppendAllText(Path.Combine(testDirectory, "palette-perf-runtime.txt"), $"descriptor={descriptor}\n");
        Require(descriptor.Replace('\\', '/').Contains($"/{expectedSessionId}/"), "Wrong SDK session");
        File.WriteAllText(output, "surface,iteration,phase,items,milliseconds\n");
        var doc = uiapp.Application.NewProjectDocument(UnitSystem.Imperial);
        try {
            using (var transaction = new Transaction(doc, "Palette performance inputs")) {
                transaction.Start();
                var viewType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(v => v.ViewFamily == ViewFamily.Drafting);
                for (var i = 0; i < 120; i++)
                    ViewDrafting.Create(doc, viewType.Id).Name = $"Palette {(i % 2 == 0 ? "Alpha" : "Beta")} {i:000}";
                Require(doc.LoadFamily(Path.Combine(fixturesDirectory,
                    "Families", "pe-grd-supply.rfa"), out var family), "Family load failed");
                var symbol = (FamilySymbol)doc.GetElement(family.GetFamilySymbolIds().First());
                for (var i = 0; i < 80; i++) symbol.Duplicate($"Palette {(i % 2 == 0 ? "Alpha" : "Beta")} {i:000}");
                transaction.Commit();
            }
            for (var iteration = 0; iteration < iterations; iteration++) {
                await Measure("views", iteration, () => {
                    var cache = new SheetLookupCache(doc);
                    return new FilteredElementCollector(doc).OfClass(typeof(ViewDrafting)).Cast<View>()
                        .Select(v => new UnifiedViewItem(v, ViewItemType.View, cache)).ToList();
                }, "Alpha", output, verify);
                await Measure("families", iteration, () => new FilteredElementCollector(doc)
                    .OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().Select(s => new UnifiedFamilyItem(s)).ToList(),
                    "Alpha", output, verify);
                await Measure("commands", iteration, () => new PostableCommandHelper(
                    StorageClient.Default.Module("CmdPltCommands")).GetAllCommands(), "view", output, verify);
                await Measure("json-profiles", iteration, () => Directory.GetFiles(
                    Path.Combine(fixturesDirectory, "Profiles"), "*.json",
                    SearchOption.AllDirectories).Select(p => new ProfileListItem(p,
                        Path.GetFileName(p), FoundryFileKind.FamilyModel)).ToList(), "family", output, verify);
            }
        } finally {
            await PaletteThreading.RunRevitAsync(() => doc.Close(false), CancellationToken.None);
        }
    }

    private static async Task Measure<T>(string surface, int iteration, Func<IEnumerable<T>> provider,
        string query, string output, bool verify) where T : class, IPaletteListItem {
        var timer = Stopwatch.StartNew();
        var loaded = false;
        var acquisitions = 0;
        var emptySource = false;
        var window = PaletteFactory.Create(surface, new PaletteOptions<T> {
            SearchConfig = SearchConfig.PrimaryAndSecondary(),
            Tabs = [new TabDefinition<T>("All", () => {
                acquisitions++;
                return emptySource ? [] : provider();
            }, new PaletteAction<T> {
                Name = "Inspect", Execute = _ => { }
            })],
            ViewModelMutator = _ => loaded = true
        });
        window.IsEphemeral = false;
        try {
            window.Show();
            var palette = (Palette)window.ContentControl;
            var vm = (PaletteViewModel<T>)palette.DataContext;
            await PumpUntil(() => loaded);
            await Layout(window);
            Record("open", vm.FilteredItems.Count);
            Require(vm.FilteredItems.Count > 0, surface + " has no items");
            var changed = 0;
            vm.FilteredItemsChanged += (_, _) => changed++;
            foreach (var search in new[] { query, query + "zzzz", "", query, "" }) {
                var before = changed;
                timer.Restart();
                vm.SearchText = search;
                await PumpUntil(() => changed > before);
                await Layout(window);
                Record("search", vm.FilteredItems.Count);
                Require(ReferenceEquals(vm.SelectedItem, vm.FilteredItems.FirstOrDefault()), "Wrong filtered selection");
            }
            for (var key = 0; key < Math.Min(40, vm.FilteredItems.Count + 2); key++) {
                timer.Restart();
                vm.MoveSelectionDownCommand.Execute(null);
                await Layout(window);
                await SettleScroll(window);
                Record("nav", vm.FilteredItems.Count);
                Require(ReferenceEquals(vm.SelectedItem, vm.FilteredItems[vm.SelectedIndex]), "Wrong navigation selection");
            }
            if (verify && iteration == 0) {
                var count = vm.FilteredItems.Count;
                Require(acquisitions == 1, "Search reacquired document data");
                await Search("ΩΩΩΩΩΩΩΩΩΩ");
                Require(vm.FilteredItems.Count == 0 && vm.SelectedItem == null && vm.SelectedIndex == -1,
                    "Empty results retained a selection");
                await Search("");
                Require(vm.FilteredItems.Count == count, "Clearing search lost rows");
                var before = changed;
                vm.SearchText = query;
                vm.SearchText = "ΩΩΩΩΩΩΩΩΩΩ";
                vm.SearchText = "";
                await PumpUntil(() => changed > before);
                await Layout(window);
                Require(vm.FilteredItems.Count == count, "Stale search committed after newer input");
                vm.MoveSelectionUpCommand.Execute(null);
                await Layout(window);
                Require(ReferenceEquals(vm.SelectedItem, vm.FilteredItems[vm.SelectedIndex]), "Wrong reverse selection");
                Require(acquisitions == 1, "Query cancellation invalidated the snapshot");
                emptySource = true;
                before = changed;
                vm.RefreshItems();
                await PumpUntil(() => changed > before);
                await Search(query);
                await Search("");
                Require(acquisitions == 2 && vm.FilteredItems.Count == 0, "Empty snapshot was not cached");
                emptySource = false;
                before = changed;
                vm.RefreshItems();
                await PumpUntil(() => changed > before);
                await Layout(window);
                Require(acquisitions == 3 && vm.FilteredItems.Count == count, "Refresh did not reacquire items");
                var bitmap = new System.Windows.Media.Imaging.RenderTargetBitmap(
                    (int)Math.Ceiling(window.ActualWidth), (int)Math.Ceiling(window.ActualHeight), 96, 96,
                    System.Windows.Media.PixelFormats.Pbgra32);
                bitmap.Render(window);
                var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
                encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bitmap));
                using var stream = File.Create(Path.Combine(Path.GetDirectoryName(output)!, surface + ".png"));
                encoder.Save(stream);
            }
            // Drain the selection timer before closing so iterations do not overlap.
            var settled = Stopwatch.StartNew();
            await PumpUntil(() => settled.ElapsedMilliseconds >= 350);

            async Task Search(string text) {
                var before = changed;
                vm.SearchText = text;
                await PumpUntil(() => changed > before);
                await Layout(window);
                Require(ReferenceEquals(vm.SelectedItem, vm.FilteredItems.FirstOrDefault()), "Wrong search selection");
            }
        } finally {
            window.CloseWindow(false);
        }
        void Record(string phase, int count) {
            var ms = timer.Elapsed.TotalMilliseconds;
            File.AppendAllText(output, FormattableString.Invariant($"{surface},{iteration},{phase},{count},{ms:F3}\n"));
        }
    }

    private static async Task Layout(Window window) {
        await window.Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle);
        window.UpdateLayout();
    }

    private static async Task SettleScroll(Window window) {
        var viewer = FindAnimatedViewer(window);
        if (viewer == null) return;
        await PumpUntil(() => Math.Abs(viewer.VerticalOffset - viewer.TargetVerticalOffset) < 1);
        await Layout(window);
    }

    private static Pe.Revit.Ui.Controls.AnimatedScrollViewer? FindAnimatedViewer(DependencyObject parent) {
        if (parent is Pe.Revit.Ui.Controls.AnimatedScrollViewer viewer) return viewer;
        for (var i = 0; i < System.Windows.Media.VisualTreeHelper.GetChildrenCount(parent); i++) {
            var match = FindAnimatedViewer(System.Windows.Media.VisualTreeHelper.GetChild(parent, i));
            if (match != null) return match;
        }
        return null;
    }

    private static async Task PumpUntil(Func<bool> predicate) {
        var timeout = Stopwatch.StartNew();
        while (!predicate() && timeout.Elapsed.TotalSeconds < 15) await Task.Delay(1);
        Require(predicate(), "Palette did not settle within 15 seconds");
    }

    private static void Require(bool condition, string message) {
        if (!condition) throw new InvalidOperationException(message);
    }
}
