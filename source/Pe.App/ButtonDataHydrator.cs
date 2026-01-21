using Autodesk.Revit.UI;
using Pe.App.Commands.Palette;
using Pe.Tools.Commands;
using Pe.Tools.Commands.AutoTag;
using Pe.Tools.Commands.FamilyFoundry;
using System.Diagnostics;

namespace Pe.Tools;

public static class ButtonDataHydrator {
    private static readonly Dictionary<string, ButtonDataRecord> ButtonDataRecords = new() {
        {
            nameof(CmdCacheParametersService),
            new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip = "Cache the parameters service data for use in the Family Foundry command."
            }
        }, {
            nameof(CmdApsAuthPKCE), new ButtonDataRecord {
                SmallImage = "id-card16.png",
                LargeImage = "id-card32.png",
                ToolTip =
                    "Get an access token from Autodesk Platform Services. This is primarily for testing purposes, but running it will not hurt anything."
            }
        }, {
            nameof(CmdApsAuthNormal), new ButtonDataRecord {
                SmallImage = "id-card16.png",
                LargeImage = "id-card32.png",
                ToolTip =
                    "Get an access token from Autodesk Platform Services. This is primarily for testing purposes, but running it will not hurt anything."
            }
        }, {
            nameof(CmdMep2040),
            new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip = "Analyze MEP sustainability metrics (pipe length, refrigerant volume, mech equipment count)."
            }
        }, {
            nameof(CmdPltCommands), new ButtonDataRecord {
                SmallImage = "square-terminal16.png",
                LargeImage = "square-terminal32.png",
                ToolTip =
                    "Search and execute Revit commands quickly without looking through Revit's tabs, ribbons, and panels. Not all commands are guaranteed to run."
            }
        }, {
            nameof(CmdPltViews),
            new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip = "Search and open views in the current document."
            }
        }, {
            nameof(CmdPltMruViews),
            new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip = "Open recently visited views in MRU (Most Recently Used) order."
            }
        }, {
            nameof(CmdPltFamilies),
            new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip = "Search families in the document. Click to edit family, Ctrl+Click to select all instances."
            }
        }, {
            nameof(CmdPltFamilyElements), new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip =
                    "Browse all family elements (parameters, connectors, dimensions, reference planes, nested families). Highlights selected elements. Only works in family documents."
            }
        }, {
            nameof(CmdTapMaker), new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip =
                    "Add a (default) 6\" tap to a clicked point on a duct face. Works in all views and on both round/rectangular ducts.",
                LongDescription =
                    """
                    Add a (default) 6" tap to a clicked point on a duct face. Works in all views and on both round/rectangular ducts.
                    Automatic click-point adjustments will prevent overlaps (with other taps) and overhangs (over face edges).
                    Automatic size adjustments will size down a duct until it fits on a duct face.

                    In the event an easy location or size adjustment is not found, no tap will be placed.
                    """
            }
        }, {
            nameof(CmdSchedulePalette),
            new ButtonDataRecord {
                SmallImage = "Red_16.png", LargeImage = "Red_32.png", ToolTip = "Create or serialize schedules."
            }
        }, {
            nameof(CmdFFMigrator),
            new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip = "Process families in a variety of ways from the Family Foundry."
            }
        }, {
            nameof(CmdFFManager),
            new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip = "Manage families in a variety of ways from the Family Foundry."
            }
        }, {
            nameof(CmdFFManagerSnapshot), new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip =
                    "Running this will output a JSON file with a config the represents the reference planes, dimensions, and family parameters of the currently open family"
            }
        }, {
            nameof(CmdFFMakeATVariants), new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip =
                    "Test command that processes a family 3 times with incrementing TEST_PROCESS_NUMBER parameter."
            }
        }, {
            nameof(CmdFFParamAggregator),
            new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip = "Aggregate parameter metadata across families in a category and output to CSV."
            }
        }, {
            nameof(CmdAutoTag), new ButtonDataRecord {
                SmallImage = "Red_16.png",
                LargeImage = "Red_32.png",
                ToolTip =
                    "Manage AutoTag - automatically tag elements when placed based on configured rules.",
                LongDescription =
                    """
                    AutoTag automatically tags elements when they are placed in the model.

                    Features:
                    - Initialize/configure AutoTag settings for the document
                    - Enable/disable automatic tagging
                    - Catch-up tag all untagged elements
                    - Edit settings via JSON with schema autocomplete
                    - View full configuration details

                    Settings are stored in the document using Extensible Storage.
                    """
            }
        }

        // {
        //     nameof(CmdTestSettingsEditor),
        //     new ButtonDataRecord {
        //         SmallImage = "Red_16.png",
        //         LargeImage = "Red_32.png",
        //         ToolTip = "Test the generic settings editor POC with Family Foundry settings."
        //     }
        // }
    };

    public static void AddButtonData(List<PushButton> buttons) {
        foreach (var button in buttons) {
            Debug.WriteLine("button.ClassName: " + button.ClassName);
            var key = button.ClassName.Split('.').Last();
            if (ButtonDataRecords.TryGetValue(key, out var btnData)) {
                _ = button.SetImage(btnData.SmallImage)
                    .SetLargeImage(btnData.LargeImage)
                    .SetToolTip(btnData.ToolTip);
                if (!string.IsNullOrEmpty(btnData.LongDescription))
                    _ = button.SetLongDescription(btnData.LongDescription);
            } else
                throw new Exception($"{key} was not found in ButtonDataRecords.");
        }
    }

    public record ButtonDataRecord {
        private readonly string _largeImage;
        private readonly string _smallImage;
        public string Shortcuts { get; init; }

        public required string SmallImage {
            get => ValidateUri(this._smallImage);
            init => this._smallImage = value;
        }

        public required string LargeImage {
            get => ValidateUri(this._largeImage);
            init => this._largeImage = value;
        }

        public required string ToolTip { get; init; }
        public string LongDescription { get; init; }
        public string ContextualHelp { get; init; }

        private static string ValidateUri(string fileName) =>
            new Uri($"pack://application:,,,/Pe.App;component/resources/{fileName.ToLowerInvariant()}",
                UriKind.Absolute).ToString();
    }
}