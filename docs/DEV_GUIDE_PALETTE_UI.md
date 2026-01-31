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
                .Select(v => new AllViewPaletteItem(v))
                .ToList();

            var window = PaletteFactory.Create("All Views Palette",
                new PaletteOptions<AllViewPaletteItem> {
                    Persistence = (new Storage(nameof(CmdPltAllViews)), item => item.View.Id.ToString()),
                    SearchConfig = SearchConfig.Default(),
                    Tabs = [new TabDefinition<AllViewPaletteItem> {
                        Name = "All",
                        ItemProvider = () => items,
                        FilterKeySelector = item => item.View.ViewType.ToString(),
                        Actions = [
                            new() { Name = "Open View", Execute = async item => uiapp.OpenAndActivateView(item.View) }
                        ]
                    }]
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

It doesn't get much simpler than that. Note that items and actions are now
defined directly in the TabDefinition, making the palette configuration more
cohesive and enabling per-tab lazy loading and per-tab actions.
