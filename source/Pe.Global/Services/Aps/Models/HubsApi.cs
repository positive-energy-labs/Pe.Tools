namespace Pe.Global.Services.Aps.Models;

public class HubsApi {
    public class Hubs {
        [UsedImplicitly] public required HubsJsonApi JsonApi { get; init; }
        [UsedImplicitly] public required List<HubsData> Data { get; init; }

        public class HubsJsonApi {
            [UsedImplicitly] public required string Version { get; init; }
        }

        public class HubsData {
            [UsedImplicitly] public required string Type { get; init; }
            [UsedImplicitly] public required string Id { get; init; } // the important one
            [UsedImplicitly] public required HubsDataAttributes Attributes { get; init; }

            public class HubsDataAttributes {
                [UsedImplicitly] public required string Name { get; init; }
                [UsedImplicitly] public required HubsDataAttributesExtension Extension { get; init; }
                [UsedImplicitly] public required string Region { get; init; }

                public class HubsDataAttributesExtension {
                    [UsedImplicitly] public required string Type { get; init; }
                    [UsedImplicitly] public required string Version { get; init; }
                    [UsedImplicitly] public required HubsDataAttributesExtensionSchema Schema { get; init; }
                    [UsedImplicitly] public required object Data { get; init; }
                }

                public class HubsDataAttributesExtensionSchema {
                    [UsedImplicitly] public required string Href { get; init; }
                }
            }
        }
    }
}