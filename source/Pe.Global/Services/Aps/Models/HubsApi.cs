namespace Pe.Global.Services.Aps.Models;

public class HubsApi {
    public class Hubs {
        [UsedImplicitly] public HubsJsonApi JsonApi { get; init; }
        [UsedImplicitly] public List<HubsData> Data { get; init; }

        public class HubsJsonApi {
            [UsedImplicitly] public string Version { get; init; }
        }

        public class HubsData {
            [UsedImplicitly] public string Type { get; init; }
            [UsedImplicitly] public string Id { get; init; } // the important one
            [UsedImplicitly] public HubsDataAttributes Attributes { get; init; }

            public class HubsDataAttributes {
                [UsedImplicitly] public string Name { get; init; }
                [UsedImplicitly] public HubsDataAttributesExtension Extension { get; init; }
                [UsedImplicitly] public string Region { get; init; }

                public class HubsDataAttributesExtension {
                    [UsedImplicitly] public string Type { get; init; }
                    [UsedImplicitly] public string Version { get; init; }
                    [UsedImplicitly] public HubsDataAttributesExtensionSchema Schema { get; init; }
                    [UsedImplicitly] public object Data { get; init; }
                }

                public class HubsDataAttributesExtensionSchema {
                    [UsedImplicitly] public string Href { get; init; }
                }
            }
        }
    }
}