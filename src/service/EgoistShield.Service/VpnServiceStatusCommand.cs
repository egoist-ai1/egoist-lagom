using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class VpnServiceStatusCommand
{
    internal static async Task<int> RunAsync()
    {
        try
        {
            string installRoot = VpnRuntimeHost.ResolveInstalledRoot();
            using var lease = ProtectedExecutable.OpenHost(installRoot, "cli");
            string productRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "EgoistShield");
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(12));
            var services = new OwnedServiceController(installRoot, productRoot);
            var status = await services.StatusAsync(ServiceContract.VpnServiceName, deadline.Token);
            VpnConnection? connection = null;
            bool intentRunning = false;
            LocalServiceHealth health = LocalServiceHealth.Unknown;
            int? pid = null; DateTimeOffset? startedAt = null; string? instanceId = null;
            if (status.Installed)
            {
                await services.AssertOwnedImagePathAsync(ServiceContract.VpnServiceName, deadline.Token);
                using var config = VpnServiceConfiguration.Open(productRoot);
                connection = config.Value;
                var intent = await new OwnedServiceIntentStore(Path.Combine(productRoot, "Service")).ReadAsync(deadline.Token);
                intentRunning = intent.Services.TryGetValue(ServiceContract.VpnServiceName, out var desired) && desired.Running;
                health = await VpnServiceHealthProbe.ProbeAsync(productRoot, services, deadline.Token);
                if (status.State == "running")
                {
                    var observed = await VpnServiceHealthProbe.ReadSnapshotAsync(deadline.Token);
                    var root = observed == null ? null : Array.Find(observed.Processes, item => item.ProcessId == observed.ServiceProcessId);
                    if (observed is { Stable: true, ServiceState: "Running" } && root?.CreatedAt != null)
                    { pid = observed.ServiceProcessId; startedAt = root.CreatedAt; instanceId = pid + ":" + startedAt.Value.ToString("O"); }
                    else health = LocalServiceHealth.Unknown;
                }
            }
            Console.Out.WriteLine(JsonSerializer.Serialize(new
            {
                serviceName = ServiceContract.VpnServiceName,
                serviceInstalled = status.Installed, serviceState = status.State, startType = status.StartType,
                serviceRunning = status.State == "running", backgroundEnabled = status.Installed && status.StartType == "auto" && intentRunning,
                running = !status.Installed || status.State == "stopped" ? (bool?)false : health == LocalServiceHealth.Unknown ? null : health == LocalServiceHealth.Responsive,
                activeNodeId = connection?.NodeId, activeNodeName = connection?.NodeName,
                pid, startedAt, instanceId,
                proxyPort = ServiceContract.VpnProxyPort, socksPort = ServiceContract.VpnProxyPort,
                useTunMode = true, runtimeKind = "sing-box", routeProtection = "inconclusive",
                localHealth = health.ToString().ToLowerInvariant(),
                observation = new { state = "observed", at = DateTimeOffset.UtcNow },
                message = status.Installed && health != LocalServiceHealth.Responsive && status.State == "running" ? "Готовность локального VPN не подтверждена." : null
            }, JsonDefaults.Options));
            return 0;
        }
        catch (Exception)
        {
            Console.Out.WriteLine(JsonSerializer.Serialize(new
            {
                serviceName = ServiceContract.VpnServiceName, serviceInstalled = (bool?)null, serviceState = "unknown",
                backgroundEnabled = (bool?)null, running = (bool?)null, activeNodeId = (string?)null,
                proxyPort = ServiceContract.VpnProxyPort, socksPort = ServiceContract.VpnProxyPort,
                useTunMode = true, routeProtection = "inconclusive", localHealth = "unknown",
                observation = new { state = "unknown", at = DateTimeOffset.UtcNow },
                message = "Не удалось проверить фоновую службу VPN. Действующее подключение сохранено."
            }, JsonDefaults.Options));
            return 1;
        }
    }
}
