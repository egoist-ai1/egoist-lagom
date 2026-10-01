using System.Reflection;
using System.Text.Json;
using EgoistShield.Service;

// Run against the immutable 5d0d58b service sources, never the installed service.
internal static class RouteCacheBefore
{
    private static async Task<int> Main(string[] args)
    {
        if (args.Length != 1 || !Path.IsPathFullyQualified(args[0])) throw new ArgumentException("Use an own absolute work path.");
        int calls = 0; bool reportedRoute = true;
        var controller = new WindowsNativeDohController(args[0], (script, token) => {
            calls++; return Task.FromResult(new ProcessResult(0, reportedRoute ? "true" : "false", ""));
        });
        bool first = await controller.HasIpv6DefaultRouteAsync(default);
        reportedRoute = false;
        var field = typeof(WindowsNativeDohController).GetField("_routeCacheUntil", BindingFlags.NonPublic | BindingFlags.Instance)
            ?? throw new InvalidOperationException("This reproducer requires the pre-fix controller.");
        field.SetValue(controller, DateTimeOffset.UtcNow.AddMinutes(15));
        bool afterFutureTimestamp = await controller.HasIpv6DefaultRouteAsync(default);
        if (!first || !afterFutureTimestamp || calls != 1) throw new InvalidOperationException("The stale route-cache finding did not reproduce.");
        Console.WriteLine(JsonSerializer.Serialize(new { baseline = "5d0d58b44076843e639723ef267e7b8d2605e481", first, afterFutureTimestamp,
            actualAdapterNextRoute = reportedRoute, adapterCalls = calls, staleEvidenceReused = true,
            systemWallClockChanged = false, realNetworkWrites = 0,
            seam = "Actual pre-fix method; controlled read-only adapter; private future TTL simulates the cache state caused by a backwards wall-clock adjustment." }));
        return 0;
    }
}
