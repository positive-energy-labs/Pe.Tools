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
    [Op("revit.detail.space-scene", Does = "Export native meshes and sized straight physical runs in host internal feet. focusOnly captures host elementIds without context. Context defaults to native boxes and sized runs without tessellating context; contextRepresentation meshes explicitly acquires Coarse context within contextPaddingFt of focus bounds, or explicit bounds. none suppresses context. Primitive rows own zero vertices; representation distinguishes mesh, box and run. Metadata phase distinguishes focus/context, unavailableElements identifies requested ids without meshes, omittedElements counts context excluded by the output budget, and completeness reports deferred context and acquisition resource limits. Successful artifacts preserve focus membership; unsupported parametric focus retains Medium/Fine meshes. Native triangle counts stop further acquisition after each tessellated face, so one already allocated face can exceed the acquisition budget. Completeness discloses omitted or deferred context. No document mutation. Browser orbit, visibility and cuts need no further native calls.", Title = "Export Space Scene", Finds = ["space", "3d", "mesh", "viewer", "context", "section"], Cost = OpCost.Expensive, Example = "{ \"elementIds\": [123], \"focusOnly\": true, \"maxTriangles\": 1500000 }")]
    private static SceneArtifact Export(SceneRequest request, ProjectDocument document, CancellationToken cancellationToken) {
        var root = ProductRuntimeLayout.ForCurrentUser().Cache.ResolveModuleCachePath("space-scenes");
        Directory.CreateDirectory(root);
        var temp = Path.Combine(root, Guid.NewGuid().ToString("N") + ".tmp");
        var vertexTemp = temp + ".vertices";
        try {
            SceneMetadata metadata;
            using (var vertices = File.Create(vertexTemp)) metadata = Scene.Write(document.Value, request, vertices, cancellationToken);
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
                using var input = File.OpenRead(vertexTemp);
                input.CopyTo(output);
            }
            string id;
            using (var input = File.OpenRead(temp))
            using (var sha = SHA256.Create()) id = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
            var path = Path.Combine(root, id + ".bin");
            if (!File.Exists(path)) File.Move(temp, path);
            return new SceneArtifact(metadata, id, $"/pe/space/scenes/{id}/artifact", new FileInfo(path).Length);
        } finally {
            if (File.Exists(temp)) File.Delete(temp);
            if (File.Exists(vertexTemp)) File.Delete(vertexTemp);
        }
    }
}
