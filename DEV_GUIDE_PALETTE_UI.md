# Palette UI Guide

For the most basic of palettes, the palette factory can be used to display a
palette with only a few lines of code:

```csharp
public class CmdPltAllViews : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        try {
            var uiapp = commandData.Application;
            var doc = uiapp.ActiveUIDocument.Document;

            var items = new FilteredElementCollector(doc)
                .OfClass(typeof(View))
                .Cast<View>()
                .OrderBy(v => v.Name)
                .Select(v => new AllViewPaletteItem(v));

            var actions = new List<PaletteAction<AllViewPaletteItem>> {
                new() { Name = "Open View", Execute = async item => uiapp.OpenAndActivateView(item.View) }
            };

            var window = PaletteFactory.Create("All Views Palette", items, actions,
                new PaletteOptions<AllViewPaletteItem> {
                    Storage = new Storage(nameof(CmdPltAllViews)),
                    PersistenceKey = item => item.View.Id.ToString(),
                    SearchConfig = SearchConfig.Default(),
                    FilterKeySelector = item => item.View.ViewType.ToString()
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }
}
```

It doesn't get much simplet than that.
