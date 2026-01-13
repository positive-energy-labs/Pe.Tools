using Pe.Extensions.FamDocument;
using Pe.Extensions.FamParameter;
using Pe.Extensions.FamParameter.Formula;
using Pe.Global.PolyFill;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using WpfColor = System.Windows.Media.Color;
using WpfGrid = System.Windows.Controls.Grid;

namespace Pe.App.Commands.Palette.CommandPalette;

/// <summary>
///     Dialog that displays recursive parameter relationships including
///     dimensions, arrays, and formula-dependent parameters up to 3 levels deep.
/// </summary>
public static class ParamRelationshipDialog {
    private const int MaxDepth = 3;

    public static void Show(FamilyParameter param, FamilyDocument familyDoc) {
        var window = new Window {
            Title = $"Parameter Relationships: {param.Definition.Name}",
            Width = 500,
            Height = 600,
            WindowStartupLocation = WindowStartupLocation.CenterScreen,
            Background = new SolidColorBrush(WpfColor.FromRgb(30, 30, 30))
        };

        var mainGrid = new WpfGrid();
        mainGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        mainGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        // Header
        var header = CreateHeader(param);
        WpfGrid.SetRow(header, 0);
        _ = mainGrid.Children.Add(header);

        // TreeView for relationships
        var treeView = new TreeView {
            Background = new SolidColorBrush(WpfColor.FromRgb(30, 30, 30)),
            Foreground = Brushes.White,
            BorderThickness = new Thickness(0),
            Margin = new Thickness(10)
        };

        var visited = new HashSet<long>();
        var rootItem = BuildTreeItem(param, familyDoc, 0, visited);
        _ = treeView.Items.Add(rootItem);

        var scrollViewer = new ScrollViewer {
            Content = treeView,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto
        };
        WpfGrid.SetRow(scrollViewer, 1);
        _ = mainGrid.Children.Add(scrollViewer);

        window.Content = mainGrid;
        window.Show();
    }

    private static Border CreateHeader(FamilyParameter param) {
        var headerPanel = new StackPanel { Margin = new Thickness(10) };

        _ = headerPanel.Children.Add(new TextBlock {
            Text = param.Definition.Name,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            Foreground = new SolidColorBrush(WpfColor.FromRgb(86, 156, 214))
        });

        _ = headerPanel.Children.Add(new TextBlock {
            Text = $"{param.GetTypeInstanceDesignation()} • {param.Definition.GetDataType().ToLabel()}",
            FontSize = 12,
            Foreground = new SolidColorBrush(WpfColor.FromRgb(180, 180, 180)),
            Margin = new Thickness(0, 4, 0, 0)
        });

        if (!string.IsNullOrEmpty(param.Formula)) {
            _ = headerPanel.Children.Add(new TextBlock {
                Text = $"Formula: {param.Formula}",
                FontSize = 11,
                Foreground = new SolidColorBrush(WpfColor.FromRgb(206, 145, 120)),
                Margin = new Thickness(0, 4, 0, 0),
                TextWrapping = TextWrapping.Wrap
            });
        }

        return new Border {
            Child = headerPanel,
            BorderBrush = new SolidColorBrush(WpfColor.FromRgb(60, 60, 60)),
            BorderThickness = new Thickness(0, 0, 0, 1),
            Background = new SolidColorBrush(WpfColor.FromRgb(37, 37, 38))
        };
    }

    private static TreeViewItem BuildTreeItem(FamilyParameter param,
        FamilyDocument familyDoc,
        int depth,
        HashSet<long> visited) {
        // Prevent infinite recursion from circular formula references
        if (!visited.Add(param.Id.Value())) {
            return new TreeViewItem {
                Header = CreateItemHeader(param.Definition.Name, "Parameter", "(circular reference)"),
                Foreground = new SolidColorBrush(WpfColor.FromRgb(255, 100, 100))
            };
        }

        var item = new TreeViewItem {
            Header = CreateItemHeader(param.Definition.Name, "Parameter",
                $"{param.GetTypeInstanceDesignation()} • {param.Definition.GetDataType().ToLabel()}"),
            IsExpanded = depth < 2,
            Foreground = Brushes.White
        };

        // Add dimensions
        var dimensions = param.AssociatedDimensions(familyDoc).ToList();
        if (dimensions.Count > 0) {
            var dimsFolder = new TreeViewItem {
                Header = CreateFolderHeader($"Dimensions ({dimensions.Count})"),
                IsExpanded = true,
                Foreground = new SolidColorBrush(WpfColor.FromRgb(78, 201, 176))
            };
            foreach (var dim in dimensions) {
                _ = dimsFolder.Items.Add(new TreeViewItem {
                    Header = CreateItemHeader($"{dim.DimensionType?.Name ?? "Dimension"} ({dim.Id})", "Dimension",
                        dim.Value.HasValue ? $"Value: {dim.Value.Value:F4}" : "Multi-segment"),
                    Foreground = new SolidColorBrush(WpfColor.FromRgb(220, 220, 220))
                });
            }

            _ = item.Items.Add(dimsFolder);
        }

        // Add arrays
        var arrays = param.AssociatedArrays(familyDoc).ToList();
        if (arrays.Count > 0) {
            var arraysFolder = new TreeViewItem {
                Header = CreateFolderHeader($"Arrays ({arrays.Count})"),
                IsExpanded = true,
                Foreground = new SolidColorBrush(WpfColor.FromRgb(78, 201, 176))
            };
            foreach (var array in arrays) {
                _ = arraysFolder.Items.Add(new TreeViewItem {
                    Header = CreateItemHeader($"Array ({array.Id})", "Array", $"Members: {array.NumMembers}"),
                    Foreground = new SolidColorBrush(WpfColor.FromRgb(220, 220, 220))
                });
            }

            _ = item.Items.Add(arraysFolder);
        }

        // Add connectors
        var connectors = param.AssociatedConnectors(familyDoc).ToList();
        if (connectors.Count > 0) {
            var connectorsFolder = new TreeViewItem {
                Header = CreateFolderHeader($"Connectors ({connectors.Count})"),
                IsExpanded = true,
                Foreground = new SolidColorBrush(WpfColor.FromRgb(78, 201, 176))
            };
            foreach (var connector in connectors) {
                _ = connectorsFolder.Items.Add(new TreeViewItem {
                    Header = CreateItemHeader($"{connector.Domain} Connector ({connector.Id})", "Connector",
                        $"Domain: {connector.Domain}"),
                    Foreground = new SolidColorBrush(WpfColor.FromRgb(220, 220, 220))
                });
            }

            _ = item.Items.Add(connectorsFolder);
        }

        // Add formula-dependent parameters (recursive)
        var formulaParams = param.GetDependents(familyDoc.FamilyManager.Parameters).ToList();
        if (formulaParams.Count > 0) {
            var paramsFolder = new TreeViewItem {
                Header = CreateFolderHeader($"Formula Dependencies ({formulaParams.Count})"),
                IsExpanded = depth < 1,
                Foreground = new SolidColorBrush(WpfColor.FromRgb(78, 201, 176))
            };

            foreach (var fp in formulaParams) {
                _ = depth < MaxDepth - 1
                    ? paramsFolder.Items.Add(BuildTreeItem(fp, familyDoc, depth + 1, visited))
                    : paramsFolder.Items.Add(new TreeViewItem {
                        Header = CreateItemHeader(fp.Definition.Name, "Parameter",
                            $"{fp.GetTypeInstanceDesignation()} • (max depth)"),
                        Foreground = new SolidColorBrush(WpfColor.FromRgb(180, 180, 180))
                    });
            }

            _ = item.Items.Add(paramsFolder);
        }

        // Remove from visited when leaving this branch to allow the same param in different branches
        _ = visited.Remove(param.Id.Value());

        return item;
    }

    private static StackPanel CreateItemHeader(string name, string type, string details) {
        var panel = new StackPanel { Orientation = Orientation.Horizontal };

        _ = panel.Children.Add(new TextBlock {
            Text = name, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 8, 0)
        });

        _ = panel.Children.Add(new Border {
            Child = new TextBlock {
                Text = type,
                FontSize = 10,
                Foreground = new SolidColorBrush(WpfColor.FromRgb(30, 30, 30)),
                Margin = new Thickness(4, 1, 4, 1)
            },
            Background = new SolidColorBrush(WpfColor.FromRgb(86, 156, 214)),
            CornerRadius = new CornerRadius(3),
            Margin = new Thickness(0, 0, 8, 0),
            VerticalAlignment = VerticalAlignment.Center
        });

        _ = panel.Children.Add(new TextBlock {
            Text = details,
            FontSize = 11,
            Foreground = new SolidColorBrush(WpfColor.FromRgb(150, 150, 150)),
            VerticalAlignment = VerticalAlignment.Center
        });

        return panel;
    }

    private static StackPanel CreateFolderHeader(string text) {
        var panel = new StackPanel { Orientation = Orientation.Horizontal };
        _ = panel.Children.Add(new TextBlock { Text = "📁 ", FontSize = 12 });
        _ = panel.Children.Add(new TextBlock { Text = text, FontWeight = FontWeights.SemiBold });
        return panel;
    }
}