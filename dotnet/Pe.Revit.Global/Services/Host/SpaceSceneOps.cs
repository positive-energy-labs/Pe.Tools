using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Revit.Space;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.Product;
using System.Security.Cryptography;
using System.Text;
using ProjectDocument = Pe.Revit.Operations.ProjectDocument;

namespace Pe.Revit.Global.Services.Host;

internal static class SpaceSceneOps {
    [Op("revit.detail.space-scene", Does = "Export native meshes, full 3D family frames and sized physical runs in host internal feet, including host insulation. Curved round runs carry their tessellated LocationCurve path. focusOnly captures host elementIds without context. Context is read per focus element: each element's own box (a run's location line and size) grown by contextPaddingFt, in every host and link placement, as one quick filter per source before any element loads; explicit bounds replace that reach. Centre-line helpers, insulation, view-owned elements, CAD and link noise classes are excluded before iteration, and every source placement (loaded, unloaded or unavailable) reports what reach counted, kept, excluded by class and cut by a bound; detachedElementIds names focus members far from the rest. Context defaults to oriented family boxes and sized runs; elements without a proven frame, including IFC DirectShapes and sketch-based building elements, retain native meshes. The triangle-boxes option replaces context DirectShapes with envelopes fitted to their own triangles: frame candidates come from the 24 largest triangles, all vertices set extents, and frame=triangles discloses the approximation. contextRepresentation meshes acquires native context in the same reach. none suppresses context. Primitive rows own zero vertices; representation distinguishes mesh, oriented-box and run. Oriented boxes carry center, three unit axes and half sizes. Symbol meshes are tessellated once per native geometry identity and detail during the operation, then placed through the instance and link transforms. Metadata phase distinguishes focus/context, unavailableElements identifies requested ids without meshes, omittedElements counts context excluded by the output budget, and completeness reports deferred context and acquisition resource limits. Successful artifacts preserve focus membership; unsupported parametric focus retains Medium/Fine meshes. Native triangle counts stop further acquisition after each tessellated face, so one already allocated face can exceed the acquisition budget. Completeness discloses omitted or deferred context. RPC returns bounded counts and the artifact id; full typed membership and source transforms remain in PSC1. No document mutation. Browser orbit, visibility and cuts need no further native calls.", Title = "Export Space Scene", ArtifactMetadata = typeof(SceneMetadata), Finds = ["space", "3d", "mesh", "viewer", "context", "section"], Cost = OpCost.Expensive, Example = "{ \"elementIds\": [123], \"focusOnly\": true, \"maxTriangles\": 1500000 }")]
    private static SceneArtifact Export(SceneRequest request, ProjectDocument document, CancellationToken cancellationToken) {
        var root = ProductRuntimeLayout.ForCurrentUser().Cache.ResolveModuleCachePath("space-scenes");
        Directory.CreateDirectory(root);
        var vertexTemp = Path.Combine(root, Guid.NewGuid().ToString("N") + ".vertices");
        try {
            SceneMetadata metadata;
            using (var vertices = File.Create(vertexTemp)) metadata = Scene.Write(document.Value, request, vertices, cancellationToken);
            using var input = File.OpenRead(vertexTemp);
            return Publish(metadata, input, root);
        } finally {
            if (File.Exists(vertexTemp)) File.Delete(vertexTemp);
        }
    }

    internal static SceneArtifact Publish(SceneMetadata metadata, Stream vertices, string root) {
        Directory.CreateDirectory(root);
        var temp = Path.Combine(root, Guid.NewGuid().ToString("N") + ".tmp");
        try {
            var json = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(metadata, new JsonSerializerSettings {
                ContractResolver = new CamelCasePropertyNamesContractResolver(),
                Converters = [new StringEnumConverter()]
            }));
            using (var output = File.Create(temp)) {
                using var writer = new BinaryWriter(output, Encoding.UTF8, true);
                writer.Write(0x31435350); // PSC1, little endian.
                writer.Write(json.Length);
                writer.Write(json);
                while (output.Position % 4 != 0) writer.Write((byte)0);
                vertices.CopyTo(output);
            }
            string id;
            using (var input = File.OpenRead(temp))
            using (var sha = SHA256.Create()) id = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
            var path = Path.Combine(root, id + ".bin");
            if (!File.Exists(path)) File.Move(temp, path);
            return new SceneArtifact(SceneReceipt.From(metadata), id, $"/pe/space/scenes/{id}/artifact", new FileInfo(path).Length);
        } finally {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }
}