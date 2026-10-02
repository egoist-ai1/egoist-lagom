using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace EgoistShield.Service;

// A healthy .NET HTTP/2 connection does not prove that a fresh Xray Chrome/uTLS
// connection can use the saved operator. Prove the replacement before losing the
// current resolver's cache. This has no SCM, adapter, provider or file mutation.
internal static partial class SystemDohRecoveryPreflight
{
    internal static readonly TimeSpan Deadline = TimeSpan.FromSeconds(8);
    internal sealed record EndpointRow(string Address, int Port, int ProcessId, bool Tcp);

    internal static async Task<bool> ProbeOwnedAsync(string productRoot, CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsWindows()) return false;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(Deadline);
        string root = Path.Combine(productRoot, "Runtime", "SystemDoH");
        string statePath = Path.Combine(root, "state.json"), configPath = Path.Combine(root, "config.json");
        string image = Path.Combine(root, "runtime", "xray-system-doh.exe");
        try
        {
            foreach (string path in new[] { statePath, configPath, image })
            {
                TrustedPath.AssertExistingFileUnderRoots(path, productRoot);
                AssertPrivateAcl(new FileInfo(path).GetAccessControl());
            }
            var state = await ReadAsync(statePath, deadline.Token);
            var config = await ReadAsync(configPath, deadline.Token);
            if (!SystemDohServiceHealthProbe.TryReadConfiguration(state, config, out var productionConfig) ||
                !TryBuildConfiguration(state, config, 49152, out _, out bool ipv6)) return false;
            // No writer/delete sharing: the trusted image cannot be substituted
            // while CreateProcess and the held child identity are checked.
            using var imageLease = new FileStream(image, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var wrapper = new OwnedSystemDohProcess.SystemDohWrapperLease(
                Path.Combine(root, "service-wrapper", "egoistshield-system-doh-service.exe"), deadline.Token);
            await wrapper.AssertOriginalOrStoppedAsync(deadline.Token);
            using var production = new ProductionResolverLease(image, productionConfig!.LocalPort, ipv6, deadline.Token);
            int port = ReservePort(ipv6);
            if (!TryBuildConfiguration(state, config, port, out string? candidate, out _)) return false;
            bool ready = await ProbeCandidateAsync(image, candidate!, port, ipv6, deadline.Token);
            if (!ready) return false;
            production.AssertOriginal(deadline.Token);
            // The old pool may recover while the candidate connects. One local
            // fresh query inside this same deadline preserves that production
            // cache; there is no second direct HTTPS comparison.
            if (await SystemDohServiceHealthProbe.LocalQueryAsync(productionConfig.LocalAddress,
                productionConfig.LocalPort, SystemDohServiceHealthProbe.BuildQuery(),
                SystemDohServiceHealthProbe.ProbeTimeout, deadline.Token)) return false;
            production.AssertOriginal(deadline.Token);
            await wrapper.AssertOriginalOrStoppedAsync(deadline.Token);
            foreach (string path in new[] { statePath, configPath, image })
                TrustedPath.AssertExistingFileUnderRoots(path, productRoot);
            return state.GetRawText() == (await ReadAsync(statePath, deadline.Token)).GetRawText() &&
                config.GetRawText() == (await ReadAsync(configPath, deadline.Token)).GetRawText();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        // Never include the private URI, configuration or Xray output in an error.
        catch (Exception error) when (error is IOException or JsonException or InvalidOperationException or
            UnauthorizedAccessException or SecurityException or Win32Exception or SocketException or OperationCanceledException or ArgumentException)
        { return false; }
    }

    private sealed class ProductionResolverLease : IDisposable
    {
        private readonly Process _process;
        private readonly string _image;
        private readonly DateTimeOffset _birth;
        private readonly int _port, _pid;
        private readonly bool _ipv6;
        internal ProductionResolverLease(string image, int port, bool ipv6, CancellationToken token)
        {
            _image = Path.GetFullPath(image); _port = port; _ipv6 = ipv6;
            var rows = ReadRows(port, token);
            if (rows.Length == 0 || rows.Select(row => row.ProcessId).Distinct().Count() != 1)
                throw new IOException("The production resolver generation is unknown.");
            _pid = rows[0].ProcessId;
            _process = Process.GetProcessById(_pid);
            try
            {
                var identity = OwnedSystemDohProcess.ReadRuntimeIdentity(_process.SafeHandle, token);
                _birth = identity.Born;
                if (!string.Equals(identity.Path, _image, StringComparison.OrdinalIgnoreCase))
                    throw new UnauthorizedAccessException("The production resolver has a foreign image.");
                AssertOriginal(token);
            }
            catch { _process.Dispose(); throw; }
        }
        internal void AssertOriginal(CancellationToken token)
        {
            OwnedSystemDohProcess.VerifyRuntimeIdentity(_process.SafeHandle, _image, _birth, token);
            if (!OwnsEndpoints(ReadRows(_port, token), _port, _pid, _ipv6))
                throw new IOException("The production resolver generation changed.");
        }
        public void Dispose() => _process.Dispose();
    }

    // Self-contained bounded reader also works in the shipped 3.7.9 Core. The
    // exact state/config is read again after probing; no JSON API migration is needed.
    private static async Task<JsonElement> ReadAsync(string path, CancellationToken token)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read,
            4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
        const int limit = SystemDohServiceHealthProbe.MaxConfigurationBytes;
        if (stream.Length is <= 0 or > limit) throw new IOException("Preflight configuration size is invalid.");
        byte[] bytes = new byte[limit + 1]; int count = 0;
        while (count <= limit)
        {
            int read = await stream.ReadAsync(bytes.AsMemory(count, bytes.Length - count), token);
            if (read == 0) break;
            count += read;
        }
        if (count > limit) throw new IOException("Preflight configuration exceeds its bound.");
        using var json = JsonDocument.Parse(bytes.AsMemory(0, count));
        return json.RootElement.Clone();
    }

    internal static void AssertPrivateAcl(FileSystemSecurity security)
    {
        static bool Trusted(SecurityIdentifier sid) => sid.IsWellKnown(WellKnownSidType.LocalSystemSid) ||
            sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid);
        if (security.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner || !Trusted(owner))
            throw new UnauthorizedAccessException("Preflight product file has an untrusted owner.");
        var rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().ToArray();
        if (rules.Length != 2 || rules.Select(row => row.IdentityReference.Value).Distinct().Count() != 2 ||
            rules.Any(row => !Trusted((SecurityIdentifier)row.IdentityReference) || row.AccessControlType != AccessControlType.Allow ||
                row.FileSystemRights != FileSystemRights.FullControl || row.InheritanceFlags != InheritanceFlags.None ||
                row.PropagationFlags != PropagationFlags.None))
            throw new UnauthorizedAccessException("Preflight product file ACL does not match its private contract.");
    }

    internal static bool TryBuildConfiguration(JsonElement state, JsonElement runtime, int port, out string? candidate, out bool ipv6)
    {
        candidate = null; ipv6 = false;
        if (port is < 49152 or > 65535 || !SystemDohServiceHealthProbe.TryReadConfiguration(state, runtime, out var config) ||
            !config!.LocalAddress.Equals(IPAddress.Loopback)) return false;
        var value = JsonNode.Parse(runtime.GetRawText()) as JsonObject;
        if (value?["inbounds"] is not JsonArray inbounds || inbounds.Count is < 1 or > 2) return false;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in inbounds)
        {
            if (node is not JsonObject inbound || inbound["listen"]?.GetValue<string>() is not string address ||
                inbound["tag"]?.GetValue<string>() is not string tag ||
                !((address == "127.0.0.1" && tag == "dns-in") || (address == "::1" && tag == "dns-in-v6")) ||
                !seen.Add(address) || inbound["protocol"]?.GetValue<string>() != "dokodemo-door" ||
                inbound["port"]?.GetValue<int>() != config.LocalPort ||
                inbound["settings"]?["network"]?.GetValue<string>() != "tcp,udp") return false;
            ipv6 |= address == "::1";
            inbound["port"] = port;
        }
        if (!seen.Contains("127.0.0.1")) return false;
        value["log"] = new JsonObject { ["loglevel"] = "none" };
        // All DNS, bootstrap, routing, TLS and cache settings remain exact.
        // The randomized fresh name is absent from both production/candidate cache.
        candidate = value.ToJsonString();
        return Encoding.UTF8.GetByteCount(candidate) <= SystemDohServiceHealthProbe.MaxConfigurationBytes;
    }

    private static int ReservePort(bool ipv6)
    {
        var sockets = new List<Socket>();
        try
        {
            Socket Reserve(AddressFamily family, SocketType type, ProtocolType protocol, IPAddress address, int port)
            {
                var socket = new Socket(family, type, protocol) { ExclusiveAddressUse = true };
                sockets.Add(socket);
                if (family == AddressFamily.InterNetworkV6) socket.DualMode = false;
                socket.Bind(new IPEndPoint(address, port));
                if (type == SocketType.Stream) socket.Listen(1);
                return socket;
            }
            // Binding port zero chooses a system high ephemeral port on Windows.
            var tcp = Reserve(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp, IPAddress.Loopback, 0);
            int port = ((IPEndPoint)tcp.LocalEndPoint!).Port;
            if (port < 49152) throw new IOException("No high preflight port is available.");
            Reserve(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp, IPAddress.Loopback, port);
            if (ipv6)
            {
                Reserve(AddressFamily.InterNetworkV6, SocketType.Stream, ProtocolType.Tcp, IPAddress.IPv6Loopback, port);
                Reserve(AddressFamily.InterNetworkV6, SocketType.Dgram, ProtocolType.Udp, IPAddress.IPv6Loopback, port);
            }
            return port;
        }
        finally { foreach (var socket in sockets) socket.Dispose(); }
        // A foreign race after release is rejected by native owner snapshots.
    }

    internal static async Task<bool> ProbeCandidateAsync(string image, string candidate, int port, bool ipv6, CancellationToken token)
    {
        if (!OperatingSystem.IsWindows() || port is < 49152 or > 65535 || Encoding.UTF8.GetByteCount(candidate) > 65536) return false;
        using var child = new Process { StartInfo = new ProcessStartInfo(image)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false), WorkingDirectory = Path.GetDirectoryName(image)!
        } };
        foreach (string argument in new[] { "run", "-config", "stdin:", "-format", "json" }) child.StartInfo.ArgumentList.Add(argument);
        SafeProcessHandle? held = null;
        Task? stdout = null, stderr = null;
        bool ready = false;
        try
        {
            token.ThrowIfCancellationRequested();
            if (!child.Start()) return false;
            held = child.SafeHandle; // original handle remains held through cleanup; never reopen by PID.
            stdout = child.StandardOutput.BaseStream.CopyToAsync(Stream.Null);
            stderr = child.StandardError.BaseStream.CopyToAsync(Stream.Null);
            var identity = OwnedSystemDohProcess.ReadRuntimeIdentity(held, token);
            if (!string.Equals(identity.Path, Path.GetFullPath(image), StringComparison.OrdinalIgnoreCase)) return false;
            await child.StandardInput.WriteAsync(candidate.AsMemory(), token);
            await child.StandardInput.FlushAsync(token);
            child.StandardInput.Close();
            var startup = Stopwatch.StartNew();
            while (true)
            {
                token.ThrowIfCancellationRequested();
                OwnedSystemDohProcess.VerifyRuntimeIdentity(held, image, identity.Born, token);
                var rows = ReadRows(port, token);
                if (HasForeign(rows, child.Id)) return false;
                if (OwnsEndpoints(rows, port, child.Id, ipv6)) break;
                if (startup.Elapsed >= TimeSpan.FromSeconds(2)) return false;
                await Task.Delay(50, token);
            }
            // Connected UDP plus random transaction/question and before/after
            // native ownership ensure a foreign resolver cannot grant readiness.
            ready = await SystemDohServiceHealthProbe.LocalQueryAsync(IPAddress.Loopback, port,
                SystemDohServiceHealthProbe.BuildQuery(), SystemDohServiceHealthProbe.ProbeTimeout, token);
            OwnedSystemDohProcess.VerifyRuntimeIdentity(held, image, identity.Born, token);
            ready &= OwnsEndpoints(ReadRows(port, token), port, child.Id, ipv6);
        }
        finally
        {
            if (held != null && !held.IsInvalid)
            {
                uint wait = Native.WaitForSingleObject(held, 0);
                if (wait == 258 && !Native.TerminateProcess(held, 0)) ready = false;
                if (Native.WaitForSingleObject(held, 1000) != 0) ready = false;
            }
            // Pipes are drained to Stream.Null; no private provider output is retained.
            if (stdout != null && stderr != null)
                try { await Task.WhenAll(stdout, stderr).WaitAsync(TimeSpan.FromMilliseconds(500)); }
                catch (Exception error) when (error is IOException or TimeoutException or ObjectDisposedException) { ready = false; }
        }
        return ready;
    }

    private static bool HasForeign(EndpointRow[] rows, int pid) => rows.Any(row => row.ProcessId != pid);
    internal static bool OwnsEndpoints(EndpointRow[] rows, int port, int pid, bool ipv6) => rows.Length == (ipv6 ? 4 : 2) &&
        rows.All(row => row.Port == port && row.ProcessId == pid && (row.Address == "127.0.0.1" || ipv6 && row.Address == "::1")) &&
        rows.Count(row => row.Address == "127.0.0.1" && row.Tcp) == 1 && rows.Count(row => row.Address == "127.0.0.1" && !row.Tcp) == 1 &&
        (!ipv6 || rows.Count(row => row.Address == "::1" && row.Tcp) == 1 && rows.Count(row => row.Address == "::1" && !row.Tcp) == 1);

    internal static EndpointRow[] ReadRows(int port, CancellationToken token)
    {
        var rows = new List<EndpointRow>();
        foreach (int family in new[] { 2, 23 })
        foreach (bool tcp in new[] { false, true })
        {
            token.ThrowIfCancellationRequested();
            int size = 0;
            uint Read(IntPtr buffer) => tcp ? Native.GetExtendedTcpTable(buffer, ref size, false, family, 3, 0) :
                Native.GetExtendedUdpTable(buffer, ref size, false, family, 1, 0);
            uint error = Read(IntPtr.Zero);
            if (error != 122 || size is < 4 or > 4 * 1024 * 1024) throw new IOException("Native endpoint table is unavailable.");
            IntPtr table = Marshal.AllocHGlobal(size);
            try
            {
                int capacity = size; error = Read(table);
                if (error != 0 || size > capacity) throw new IOException("Native endpoint table changed.");
                int count = Marshal.ReadInt32(table), rowSize = family == 2 ? (tcp ? 24 : 12) : (tcp ? 56 : 28);
                if (count < 0 || count > (size - 4) / rowSize) throw new IOException("Native endpoint table exceeds its bound.");
                for (int index = 0; index < count; index++)
                {
                    IntPtr row = IntPtr.Add(table, 4 + index * rowSize);
                    int addressOffset = family == 2 && tcp ? 4 : 0;
                    int portOffset = family == 2 ? (tcp ? 8 : 4) : 20;
                    int rawPort = Marshal.ReadInt32(row, portOffset);
                    int localPort = (int)(((uint)rawPort & 255) << 8 | ((uint)rawPort >> 8 & 255));
                    if (localPort != port) continue;
                    byte[] address = new byte[family == 2 ? 4 : 16]; Marshal.Copy(IntPtr.Add(row, addressOffset), address, 0, address.Length);
                    int pid = Marshal.ReadInt32(row, rowSize - 4);
                    rows.Add(new(new IPAddress(address).ToString(), localPort, pid, tcp));
                    if (rows.Count > 128) throw new IOException("Preflight endpoint table exceeds its bound.");
                }
            }
            finally { Marshal.FreeHGlobal(table); }
        }
        return rows.ToArray();
    }

    private static class Native
    {
        [DllImport("iphlpapi.dll", SetLastError = true)] internal static extern uint GetExtendedTcpTable(IntPtr table, ref int size, [MarshalAs(UnmanagedType.Bool)] bool order, int family, int kind, uint reserved);
        [DllImport("iphlpapi.dll", SetLastError = true)] internal static extern uint GetExtendedUdpTable(IntPtr table, ref int size, [MarshalAs(UnmanagedType.Bool)] bool order, int family, int kind, uint reserved);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(SafeProcessHandle process, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool TerminateProcess(SafeProcessHandle process, uint exitCode);
    }
}

