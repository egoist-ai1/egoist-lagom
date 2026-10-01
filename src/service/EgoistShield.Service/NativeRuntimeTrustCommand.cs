using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class NativeRuntimeTrustCommand
{
    internal static Task<int> RunAsync()
    {
        try
        {
            string executable = Environment.ProcessPath ?? throw new InvalidOperationException("Native verifier executable identity is unavailable.");
            // No caller-selected installation root, manifest, or trust override.
            string root = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(executable)!, "..", "..", ".."));
            string expectedHelper = Path.Combine(root, "resources", "core-service", "win-x64", "EgoistShield.Service.exe");
            if (!executable.Equals(expectedHelper, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("Native verifier must run from its installed path.");
            using var lease = ProtectedExecutable.OpenHost(root, "cli");
            var input = new StringBuilder();
            int value;
            while ((value = Console.In.Read()) >= 0 && value != '\n')
            {
                if (input.Length >= 16384) throw new InvalidDataException("Runtime trust request exceeds its limit.");
                input.Append((char)value);
            }
            using JsonDocument document = JsonDocument.Parse(input.ToString(), new JsonDocumentOptions { MaxDepth = 8 });
            JsonElement request = document.RootElement;
            if (request.ValueKind != JsonValueKind.Object || request.EnumerateObject().Count() != 2)
                throw new InvalidDataException("Malformed runtime trust request.");
            string runtimePath = request.GetProperty("runtimePath").GetString() ?? "";
            string component = request.GetProperty("runtimeKind").GetString() ?? "";
            lease.VerifyBundledRuntime(runtimePath, component);
            Console.Out.WriteLine(JsonSerializer.Serialize(new { ok = true, runtimePath = Path.GetFullPath(runtimePath), systemDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System) }));
            Console.Out.Flush();
            // Keep hashes tied to immutable, held files through the child lifetime.
            // EOF releases the lease after the owning GUI child exits/crashes.
            while ((value = Console.In.Read()) >= 0)
                if (value is not ('\r' or '\n')) throw new InvalidDataException("Unexpected runtime lease input.");
            return Task.FromResult(0);
        }
        catch (Exception error)
        {
            Console.Out.WriteLine(JsonSerializer.Serialize(new { ok = false, error = error.Message }));
            return Task.FromResult(1);
        }
    }
}
