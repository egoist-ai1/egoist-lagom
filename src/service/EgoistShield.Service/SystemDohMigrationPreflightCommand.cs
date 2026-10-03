using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Xml;
using Microsoft.Win32.SafeHandles;
using Microsoft.Win32;

namespace EgoistShield.Service;

internal sealed record SystemDohMigrationPreflightResult(int SchemaVersion, string Purpose, bool Ready,
    string DigestAlgorithm, string? CandidateSha256 = null, string? OriginalConfigSha256 = null,
    int? ProductionPid = null, string? ProductionStartTicks = null, int? WrapperPid = null, string? WrapperStartTicks = null);

// Fixed, read-only installer boundary. No stdin request or caller-selected path,
// provider, image, argument, or trust exception is supported.
internal static class SystemDohMigrationPreflightCommand
{
    internal const string Flag = "--probe-owned-system-doh-migration";
    internal static bool ExactArguments(string[] args) => args.Length == 1 && args[0] == Flag;
    internal static SystemDohMigrationPreflightResult Unready() => new(1, "private-dns-migration-preflight", false, "leaf-v1");
    internal static void AssertAdministrator(bool windows, bool system, bool administrator)
    {
        if (!windows || !system && !administrator) throw new UnauthorizedAccessException("Migration preflight requires an elevated Windows token.");
    }
    internal static async Task<int> RunAsync(string[] args)
    {
        SystemDohMigrationPreflightResult result = Unready();
        try
        {
            if (!ExactArguments(args)) throw new ArgumentException("Only the fixed migration preflight flag is supported.");
            if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
            using var identity = WindowsIdentity.GetCurrent();
            AssertAdministrator(true, identity.IsSystem, new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator));
            string installedRoot = VpnRuntimeHost.ResolveInstalledRoot();
            using var trustedHost = ProtectedExecutable.OpenHost(installedRoot, "cli");
            string productRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "EgoistShield");
            result = await SystemDohRecoveryPreflight.ProbeMigrationAsync(productRoot, CancellationToken.None);
        }
        catch (Exception)
        {
            // Never print a path, provider URI, configuration or child output.
            result = Unready();
        }
        Console.Out.WriteLine(JsonSerializer.Serialize(result, JsonDefaults.Options));
        return result.Ready ? 0 : 2;
    }
}

internal static partial class SystemDohRecoveryPreflight
{
    internal static bool TryBuildMigrationConfiguration(JsonElement state, JsonElement source,
        out JsonElement migrated, out bool ipv6)
    {
        migrated = default; ipv6 = false;
        try
        {
            if (state.ValueKind != JsonValueKind.Object || state.TryGetProperty("enabled", out var enabled) &&
                enabled.ValueKind != JsonValueKind.True || source.ValueKind != JsonValueKind.Object ||
                HasDuplicateProperties(source) || HasDuplicateProperties(state) || HasInsecureTls(source)) return false;
            var value = JsonNode.Parse(source.GetRawText()) as JsonObject;
            if (value?["dns"] is not JsonObject dns || value["log"] is not JsonObject log) return false;
            if (dns["hosts"] == null) dns["hosts"] = new JsonObject();
            if (dns["hosts"] is not JsonObject hosts) return false;
            if (hosts.TryGetPropertyValue("health.egoist.invalid", out var marker))
            {
                bool valid = marker is JsonValue text && text.TryGetValue<string>(out string? address) && address == "127.0.0.1" ||
                    marker is JsonArray list && list.Count == 1 && list[0] is JsonValue item && item.TryGetValue<string>(out string? ip) && ip == "127.0.0.1";
                if (!valid) return false;
            }
            else hosts["health.egoist.invalid"] = "127.0.0.1";
            dns["serveStale"] = true; dns["serveExpiredTTL"] = 120;
            if (log.ContainsKey("error")) log["error"] = "";
            migrated = JsonSerializer.SerializeToElement(value);
            if (!SystemDohServiceHealthProbe.TryReadConfiguration(state, migrated, out var config) ||
                config!.LocalPort != 53 || !TryBuildConfiguration(state, migrated, 49152, out _, out ipv6)) return false;
            _ = MigrationDigest(migrated); // Reject ambiguous/out-of-range numeric policy.
            return Encoding.UTF8.GetByteCount(migrated.GetRawText()) <= SystemDohServiceHealthProbe.MaxConfigurationBytes;
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or ArgumentException or FormatException or OverflowException)
        { migrated = default; return false; }
    }

    private static bool HasDuplicateProperties(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => value.EnumerateObject().Select(item => item.Name).Distinct(StringComparer.Ordinal).Count() != value.EnumerateObject().Count() ||
            value.EnumerateObject().Any(item => HasDuplicateProperties(item.Value)),
        JsonValueKind.Array => value.EnumerateArray().Any(HasDuplicateProperties), _ => false
    };
    private static bool HasInsecureTls(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => value.EnumerateObject().Any(item => item.Name == "allowInsecure" && item.Value.ValueKind != JsonValueKind.False || HasInsecureTls(item.Value)),
        JsonValueKind.Array => value.EnumerateArray().Any(HasInsecureTls), _ => false
    };

    // Platform-independent semantic digest shared with the installer. Type and
    // UTF-8 byte-length framing prevent key/string ambiguities; arrays retain order.
    internal static string MigrationDigest(JsonElement value)
    {
        var output = new StringBuilder();
        void Text(char kind, string item) => output.Append(kind).Append(Encoding.UTF8.GetByteCount(item).ToString(CultureInfo.InvariantCulture)).Append(':').Append(item);
        void Write(JsonElement item)
        {
            switch (item.ValueKind)
            {
                case JsonValueKind.Object:
                    var properties = item.EnumerateObject().OrderBy(row => row.Name, StringComparer.Ordinal).ToArray();
                    output.Append('o').Append(properties.Length.ToString(CultureInfo.InvariantCulture)).Append(':');
                    foreach (var property in properties) { Text('k', property.Name); Write(property.Value); }
                    break;
                case JsonValueKind.Array:
                    output.Append('a').Append(item.GetArrayLength().ToString(CultureInfo.InvariantCulture)).Append(':');
                    foreach (var element in item.EnumerateArray()) Write(element);
                    break;
                case JsonValueKind.String: Text('s', item.GetString()!); break;
                case JsonValueKind.Number: Text('d', item.GetDecimal().ToString("G29", CultureInfo.InvariantCulture)); break;
                case JsonValueKind.True: output.Append('t'); break;
                case JsonValueKind.False: output.Append('f'); break;
                case JsonValueKind.Null: output.Append('n'); break;
                default: throw new JsonException("Unknown migration policy node.");
            }
        }
        if (HasDuplicateProperties(value)) throw new JsonException("Duplicate migration policy property.");
        Write(value);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(output.ToString()))).ToLowerInvariant();
    }

    internal static async Task<SystemDohMigrationPreflightResult> ProbeMigrationAsync(string productRoot, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(Deadline);
        var leases = new List<MigrationFileLease>();
        try
        {
            if (!OperatingSystem.IsWindows()) return SystemDohMigrationPreflightCommand.Unready();
            string root = Path.Combine(productRoot, "Runtime", "SystemDoH");
            MigrationFileLease Open(string relative, int limit = SystemDohServiceHealthProbe.MaxConfigurationBytes)
            { var lease = new MigrationFileLease(Path.Combine(root, relative), productRoot, limit); leases.Add(lease); return lease; }
            var state = Open("state.json"); var config = Open("config.json");
            var image = Open("runtime/xray-system-doh.exe", 256 * 1024 * 1024);
            var wrapper = Open("service-wrapper/egoistshield-system-doh-service.exe", 256 * 1024 * 1024);
            var xml = Open("service-wrapper/egoistshield-system-doh-service.xml");
            string intentPath = Path.Combine(productRoot, "Service", "service-supervision.json");
            MigrationFileLease? intent = null;
            TrustedPath.AssertPathUnderRoot(intentPath, productRoot, false);
            if (File.Exists(intentPath)) { intent = new MigrationFileLease(intentPath, productRoot, SystemDohServiceHealthProbe.MaxConfigurationBytes); leases.Add(intent); }
            var stateJson = await state.ReadJsonAsync(deadline.Token); var source = await config.ReadJsonAsync(deadline.Token);
            if (!TryBuildMigrationConfiguration(stateJson, source, out var migrated, out bool ipv6)) return SystemDohMigrationPreflightCommand.Unready();
            if (intent != null && !MigrationIntentAllows(await intent.ReadJsonAsync(deadline.Token))) return SystemDohMigrationPreflightCommand.Unready();
            using var activation = await MigrationActivationLease.OpenAsync(productRoot, stateJson.GetProperty("url").GetString()!, deadline.Token);
            AssertMigrationWrapper(await xml.ReadBytesAsync(deadline.Token), image.Path, config.Path);
            using var generation = new MigrationRuntimeLease(wrapper.Path, image.Path, config.Path, ipv6, deadline.Token);
            int port = ReservePort(ipv6);
            if (!TryBuildConfiguration(stateJson, migrated, port, out string? candidate, out _)) return SystemDohMigrationPreflightCommand.Unready();
            string originalHash = await config.HashAsync(deadline.Token);
            string candidateHash = MigrationDigest(migrated);
            // A healthy existing resolver is deliberately permitted: this is an
            // installer migration check, not a request to repair its old pool.
            bool ready = await ProbeMigrationCandidateAsync(image.Path, candidate!, port, ipv6,
                token => { generation.AssertOriginal(token); return Task.CompletedTask; }, deadline.Token);
            if (!ready) return SystemDohMigrationPreflightCommand.Unready();
            foreach (var lease in leases) lease.AssertOriginal();
            await activation.AssertOriginalAsync(deadline.Token);
            if (intent == null && File.Exists(intentPath) || intent != null && !MigrationIntentAllows(await intent.ReadJsonAsync(deadline.Token)) ||
                originalHash != await config.HashAsync(deadline.Token)) return SystemDohMigrationPreflightCommand.Unready();
            generation.AssertOriginal(deadline.Token);
            deadline.Token.ThrowIfCancellationRequested();
            return new(1, "private-dns-migration-preflight", true, "leaf-v1", candidateHash, originalHash,
                generation.EnginePid, generation.EngineBirth.UtcTicks.ToString(CultureInfo.InvariantCulture),
                generation.WrapperPid, generation.WrapperBirth.UtcTicks.ToString(CultureInfo.InvariantCulture));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception) { return SystemDohMigrationPreflightCommand.Unready(); }
        finally { foreach (var lease in leases) lease.Dispose(); }
    }

    internal static bool MigrationIntentAllows(JsonElement intent) => intent.ValueKind == JsonValueKind.Object && !HasDuplicateProperties(intent) &&
        intent.TryGetProperty("schemaVersion", out var version) && version.TryGetInt32(out int number) && number == 1 &&
        intent.TryGetProperty("owner", out var owner) && owner.GetString() == "EgoistShield" &&
        intent.TryGetProperty("services", out var services) && services.ValueKind == JsonValueKind.Object &&
        services.TryGetProperty("EgoistShieldSystemDoH", out var doh) && doh.ValueKind == JsonValueKind.Object &&
        doh.TryGetProperty("running", out var running) && running.ValueKind == JsonValueKind.True;

    // The lifecycle callback observes/validates production, never supplies candidate
    // readiness. Tests use a harmless held fixture process; CLI always uses native proof.
    internal static async Task<bool> ProbeMigrationCandidateAsync(string image, string candidate, int port, bool ipv6,
        Func<CancellationToken, Task> assertProduction, CancellationToken token)
    {
        await assertProduction(token);
        if (!await ProbeContainedMigrationCandidateAsync(image, candidate, port, ipv6, token)) return false;
        await assertProduction(token);
        return true;
    }

    internal sealed class MigrationFileLease : IDisposable
    {
        internal string Path { get; }
        private readonly string _root;
        private readonly int _limit;
        private readonly FileStream _stream;
        private readonly bool _private;
        internal MigrationFileLease(string path, string root, int limit, bool privateFile = true)
        {
            Path = System.IO.Path.GetFullPath(path); _root = root; _limit = limit; _private = privateFile;
            TrustedPath.AssertExistingFileUnderRoots(Path, root);
            if (_private) AssertPrivateAcl(new FileInfo(Path).GetAccessControl());
            _stream = new FileStream(Path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous);
            try { AssertOriginal(); if (_stream.Length is <= 0 || _stream.Length > limit) throw new IOException("Invalid migration input size."); }
            catch { _stream.Dispose(); throw; }
        }
        internal void AssertOriginal()
        {
            TrustedPath.AssertExistingFileUnderRoots(Path, _root);
            if (_private) AssertPrivateAcl(new FileInfo(Path).GetAccessControl());
            var buffer = new StringBuilder(32768);
            uint count = MigrationNative.GetFinalPathNameByHandle(_stream.SafeFileHandle, buffer, (uint)buffer.Capacity, 0);
            if (count == 0 || count >= buffer.Capacity || !buffer.ToString().Equals("\\\\?\\" + Path, StringComparison.OrdinalIgnoreCase))
                throw new IOException("Migration input path generation changed.");
        }
        internal async Task<byte[]> ReadBytesAsync(CancellationToken token)
        {
            if (_stream.Length is <= 0 || _stream.Length > _limit) throw new IOException("Invalid migration input size.");
            _stream.Position = 0; var bytes = new byte[checked((int)_stream.Length)];
            await _stream.ReadExactlyAsync(bytes, token); return bytes;
        }
        internal async Task<JsonElement> ReadJsonAsync(CancellationToken token)
        { using var json = JsonDocument.Parse(await ReadBytesAsync(token), new JsonDocumentOptions { MaxDepth = 64 }); return json.RootElement.Clone(); }
        internal async Task<string> HashAsync(CancellationToken token)
        { _stream.Position = 0; return Convert.ToHexString(await SHA256.HashDataAsync(_stream, token)).ToLowerInvariant(); }
        public void Dispose() => _stream.Dispose();
    }

    // Legacy runtime state records process facts, not enabled intent. Read that
    // intent from the authenticated installer snapshot reached only through the
    // fixed protected maintenance marker, and hold each current primary state.
    private sealed class MigrationActivationLease : IDisposable
    {
        private readonly List<MigrationFileLease> _files = new();
        private readonly List<(MigrationFileLease File, string Hash)> _readback = new();
        private MigrationFileLease Open(string path, string root, int limit, bool privateFile = true)
        { var file = new MigrationFileLease(path, root, limit, privateFile); _files.Add(file); return file; }
        internal static async Task<MigrationActivationLease> OpenAsync(string productRoot, string url, CancellationToken token)
        {
            var result = new MigrationActivationLease();
            try
            {
                var marker = result.Open(System.IO.Path.Combine(productRoot, "installer", "service-maintenance.json"), productRoot, 16384);
                var markerJson = await marker.ReadJsonAsync(token);
                if (!MigrationOwnedDocument(markerJson)) throw new IOException("Unverified installer maintenance marker.");
                string stage = markerJson.GetProperty("stage").GetString() ?? "";
                string common = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                string deferred = System.IO.Path.Combine(common, "EgoistShieldInstaller", "DeferredRuns");
                string fullStage = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(stage));
                if (!string.Equals(fullStage, stage, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(System.IO.Path.GetDirectoryName(fullStage), deferred, StringComparison.OrdinalIgnoreCase) ||
                    System.IO.Path.GetFileName(fullStage).Length != 32 || System.IO.Path.GetFileName(fullStage).Any(character => character is not (>= '0' and <= '9' or >= 'a' and <= 'f')))
                    throw new IOException("Unverified installer stage path.");
                TrustedPath.AssertPathUnderRoot(fullStage, common, true);
                foreach (string directory in new[] { System.IO.Path.GetDirectoryName(deferred)!, deferred, fullStage })
                {
                    var security = new DirectoryInfo(directory).GetAccessControl();
                    var rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().ToArray();
                    if (!security.AreAccessRulesProtected || security.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner ||
                        !MigrationTrustedSid(owner) || rules.Length != 2 || rules.Select(rule => rule.IdentityReference.Value).Distinct().Count() != 2 ||
                        rules.Any(rule => !MigrationTrustedSid((SecurityIdentifier)rule.IdentityReference) || rule.AccessControlType != AccessControlType.Allow || rule.FileSystemRights != FileSystemRights.FullControl))
                        throw new IOException("Installer stage is not private.");
                }
                var snapshot = result.Open(System.IO.Path.Combine(fullStage, "state.json"), fullStage, 1024 * 1024);
                var state = await snapshot.ReadJsonAsync(token);
                if (!MigrationOwnedDocument(state) || !state.TryGetProperty("handoffStarted", out var handoff) || handoff.ValueKind != JsonValueKind.True ||
                    !state.TryGetProperty("userState", out var records) || records.ValueKind != JsonValueKind.Array || records.GetArrayLength() is < 1 or > 16)
                    throw new IOException("Installer private activation snapshot is unavailable.");
                var profiles = new List<string>();
                using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList", writable: false))
                {
                    if (key == null) throw new IOException("Machine profile registrations are unavailable.");
                    string[] names = key.GetSubKeyNames();
                    if (names.Length > 256) throw new IOException("Profile registration inventory exceeds its bound.");
                    foreach (string name in names)
                    {
                        if (!name.StartsWith("S-1-5-21-", StringComparison.Ordinal)) continue;
                        using var profile = key.OpenSubKey(name, writable: false);
                        if (profile?.GetValue("ProfileImagePath") is string value)
                            profiles.Add(System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(Environment.ExpandEnvironmentVariables(value))));
                    }
                }
                int primaries = 0; var sources = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var record in records.EnumerateArray())
                {
                    string source = record.GetProperty("source").GetString() ?? "";
                    if (System.IO.Path.GetFileName(source) != "egoistshield-state.json") continue;
                    if (!sources.Add(source)) throw new IOException("Duplicate primary activation snapshot.");
                    string? profile = profiles.SingleOrDefault(root => new[] { "Egoist Shield", "EgoistShield" }.Any(folder =>
                        source.Equals(System.IO.Path.Combine(root, "AppData", "Roaming", folder, "egoistshield-state.json"), StringComparison.OrdinalIgnoreCase)));
                    if (profile == null) throw new IOException("Activation snapshot escaped registered primary profiles.");
                    string backupName = record.GetProperty("backupName").GetString() ?? "";
                    if (!System.Text.RegularExpressions.Regex.IsMatch(backupName, @"\Astate-[0-9]{1,2}\.json\z")) throw new IOException("Invalid activation snapshot filename.");
                    var backup = result.Open(System.IO.Path.Combine(fullStage, "user-state", backupName), fullStage, 4 * 1024 * 1024);
                    if (!MigrationBackupSha256Matches(await backup.HashAsync(token), record.GetProperty("sha256"))) throw new IOException("Activation snapshot checksum changed.");
                    var current = result.Open(source, profile, 4 * 1024 * 1024, privateFile: false);
                    var savedSettings = MigrationSettings(await backup.ReadJsonAsync(token));
                    var currentSettings = MigrationSettings(await current.ReadJsonAsync(token));
                    if (!MigrationSettingsAllow(savedSettings, url) || !MigrationSettingsAllow(currentSettings, url) ||
                        MigrationActivationDigest(savedSettings) != MigrationActivationDigest(currentSettings)) throw new IOException("Current private DNS intent changed.");
                    primaries++;
                }
                if (primaries == 0) throw new IOException("No authenticated primary private DNS intent.");
                foreach (var file in result._files) result._readback.Add((file, await file.HashAsync(token)));
                return result;
            }
            catch { result.Dispose(); throw; }
        }
        internal async Task AssertOriginalAsync(CancellationToken token)
        {
            foreach (var item in _readback)
            { item.File.AssertOriginal(); if (await item.File.HashAsync(token) != item.Hash) throw new IOException("Private activation generation changed."); }
        }
        public void Dispose() { foreach (var file in _files) file.Dispose(); }
    }
    private static bool MigrationTrustedSid(SecurityIdentifier sid) => sid.IsWellKnown(WellKnownSidType.LocalSystemSid) || sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid);
    // The installer writes hexadecimal SHA256 in upper case; native leases
    // produce lower case. Match only a scalar, exact 64-character ASCII digest.
    internal static bool MigrationBackupSha256Matches(string? actual, JsonElement expected)
    {
        if (actual is null || actual.Length != 64 || expected.ValueKind != JsonValueKind.String) return false;
        string? value = expected.GetString();
        if (value is null || value.Length != 64) return false;
        foreach (char item in actual.Concat(value))
            if (item is not (>= '0' and <= '9' or >= 'A' and <= 'F' or >= 'a' and <= 'f')) return false;
        return string.Equals(actual, value, StringComparison.OrdinalIgnoreCase);
    }
    internal static bool MigrationOwnedDocument(JsonElement value) => value.ValueKind == JsonValueKind.Object && !HasDuplicateProperties(value) &&
        value.TryGetProperty("schemaVersion", out var version) && version.TryGetInt32(out int number) && number == 1 &&
        value.TryGetProperty("owner", out var owner) && owner.ValueKind == JsonValueKind.String && owner.GetString() == "EgoistShield";
    internal static JsonElement MigrationSettings(JsonElement value) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty("settings", out var settings) ? settings : value;
    internal static bool MigrationSettingsAllow(JsonElement settings, string url) => settings.ValueKind == JsonValueKind.Object && !HasDuplicateProperties(settings) &&
        settings.TryGetProperty("systemDohEnabled", out var enabled) && enabled.ValueKind == JsonValueKind.True &&
        settings.TryGetProperty("systemDohUrl", out var selected) && selected.ValueKind == JsonValueKind.String &&
        SystemDohServiceHealthProbe.TryEndpoint(selected.GetString(), out var endpoint) && SystemDohServiceHealthProbe.TryEndpoint(url, out var saved) && endpoint!.AbsoluteUri == saved!.AbsoluteUri;
    internal static string MigrationActivationDigest(JsonElement settings)
    {
        var relevant = new JsonObject();
        foreach (var property in settings.EnumerateObject())
            if (property.Name.StartsWith("systemDoh", StringComparison.Ordinal) || property.Name == "systemDnsServers")
                relevant.Add(property.Name, JsonNode.Parse(property.Value.GetRawText()));
        return MigrationDigest(JsonSerializer.SerializeToElement(relevant));
    }

    internal static void AssertMigrationWrapper(byte[] bytes, string image, string config)
    {
        using var input = new MemoryStream(bytes);
        using var reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 65536 });
        var document = new XmlDocument { XmlResolver = null }; document.Load(reader);
        string Read(string name)
        { var nodes = document.SelectNodes("/service/" + name); if (nodes?.Count != 1) throw new IOException("Ambiguous migration wrapper."); return nodes[0]!.InnerText; }
        if (Read("id") != "EgoistShieldSystemDoH" || !System.IO.Path.GetFullPath(Read("executable")).Equals(image, StringComparison.OrdinalIgnoreCase) ||
            !MigrationArgumentsSelect(Read("arguments"), image, config, requireImage: false)) throw new IOException("Foreign migration wrapper configuration.");
    }

    internal static bool MigrationArgumentsSelect(string commandLine, string image, string config, bool requireImage)
    {
        if (string.IsNullOrWhiteSpace(commandLine) || commandLine.Length > 32768) return false;
        IntPtr argv = MigrationNative.CommandLineToArgvW(commandLine, out int count);
        if (argv == IntPtr.Zero) return false;
        try
        {
            if (count is < 2 or > 5) return false;
            string[] args = Enumerable.Range(0, count).Select(index => Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv, index * IntPtr.Size)) ?? "").ToArray();
            int start = requireImage ? 1 : 0;
            if (requireImage && !System.IO.Path.GetFullPath(args[0]).Equals(image, StringComparison.OrdinalIgnoreCase) || args[start] != "run") return false;
            string flag = args[start + 1], selected;
            int equal = flag.IndexOf('=');
            string name = equal < 0 ? flag : flag[..equal];
            if (name is not ("-c" or "--c" or "-config" or "--config")) return false;
            if (equal >= 0) { if (count != start + 2) return false; selected = flag[(equal + 1)..]; }
            else { if (count != start + 3) return false; selected = args[start + 2]; }
            return System.IO.Path.IsPathFullyQualified(selected) && System.IO.Path.GetFullPath(selected).Equals(config, StringComparison.OrdinalIgnoreCase);
        }
        catch (ArgumentException) { return false; }
        finally { MigrationNative.LocalFree(argv); }
    }

    internal static (string CommandLine, int ParentPid) ReadMigrationProcessFacts(Process process, string image,
        DateTimeOffset birth, CancellationToken token)
    {
        OwnedSystemDohProcess.VerifyRuntimeIdentity(process.SafeHandle, image, birth, token);
        string commandLine = MigrationNative.CommandLine(process.SafeHandle);
        int parentPid = MigrationNative.ParentPid(process.Id);
        OwnedSystemDohProcess.VerifyRuntimeIdentity(process.SafeHandle, image, birth, token);
        return (commandLine, parentPid);
    }

    private sealed class MigrationRuntimeLease : IDisposable
    {
        private readonly MigrationNative.ServiceHandle _service;
        private readonly Process _wrapper, _engine;
        private readonly string _wrapperPath, _image, _config;
        private readonly bool _ipv6;
        internal int WrapperPid => _wrapper.Id;
        internal int EnginePid => _engine.Id;
        internal DateTimeOffset WrapperBirth { get; }
        internal DateTimeOffset EngineBirth { get; }
        internal MigrationRuntimeLease(string wrapper, string image, string config, bool ipv6, CancellationToken token)
        {
            _wrapperPath = wrapper; _image = image; _config = config; _ipv6 = ipv6;
            using var scm = MigrationNative.OpenSCManager(null, null, 1);
            if (scm.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            _service = MigrationNative.OpenService(scm, "EgoistShieldSystemDoH", 1 | 4);
            if (_service.IsInvalid) { _service.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
            Process? heldWrapper = null, heldEngine = null;
            try
            {
                int wrapperPid = ReadService(token); var rows = ReadRows(53, token);
                if (rows.Length == 0 || rows.Select(row => row.ProcessId).Distinct().Count() != 1) throw new IOException("Unknown resolver generation.");
                heldWrapper = Process.GetProcessById(wrapperPid); heldEngine = Process.GetProcessById(rows[0].ProcessId);
                var wrapperIdentity = OwnedSystemDohProcess.ReadRuntimeIdentity(heldWrapper.SafeHandle, token);
                var engineIdentity = OwnedSystemDohProcess.ReadRuntimeIdentity(heldEngine.SafeHandle, token);
                WrapperBirth = wrapperIdentity.Born; EngineBirth = engineIdentity.Born;
                _wrapper = heldWrapper; _engine = heldEngine;
                AssertOriginal(token);
            }
            catch { heldEngine?.Dispose(); heldWrapper?.Dispose(); _service.Dispose(); throw; }
        }
        private int ReadService(CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (!MigrationNative.QueryServiceStatusEx(_service, 0, out var status, Marshal.SizeOf<MigrationNative.Status>(), out _) ||
                status.State != 4 || status.Pid is 0 or > int.MaxValue) throw new IOException("Owned DNS service is not running.");
            int bytes = 0; MigrationNative.QueryServiceConfig(_service, IntPtr.Zero, 0, out bytes);
            if (bytes is < 32 or > 65536) throw new IOException("Invalid DNS service registration size.");
            IntPtr buffer = Marshal.AllocHGlobal(bytes);
            try
            {
                if (!MigrationNative.QueryServiceConfig(_service, buffer, bytes, out _)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var config = Marshal.PtrToStructure<MigrationNative.Config>(buffer);
                string command = (Marshal.PtrToStringUni(config.BinaryPath) ?? "").Trim();
                string account = Marshal.PtrToStringUni(config.Account) ?? "";
                if (config.Type != 16 || config.Start is not (2 or 3) || account is not ("LocalSystem" or "NT AUTHORITY\\SYSTEM") ||
                    !(command.Equals(_wrapperPath, StringComparison.OrdinalIgnoreCase) || command.Equals("\"" + _wrapperPath + "\"", StringComparison.OrdinalIgnoreCase)))
                    throw new IOException("Foreign DNS service registration.");
            }
            finally { Marshal.FreeHGlobal(buffer); }
            token.ThrowIfCancellationRequested(); return (int)status.Pid;
        }
        internal void AssertOriginal(CancellationToken token)
        {
            if (ReadService(token) != WrapperPid || EngineBirth < WrapperBirth ||
                !OwnsEndpoints(ReadRows(53, token), 53, EnginePid, _ipv6)) throw new IOException("DNS generation changed.");
            OwnedSystemDohProcess.VerifyRuntimeIdentity(_wrapper.SafeHandle, _wrapperPath, WrapperBirth, token);
            OwnedSystemDohProcess.VerifyRuntimeIdentity(_engine.SafeHandle, _image, EngineBirth, token);
            var facts = ReadMigrationProcessFacts(_engine, _image, EngineBirth, token);
            if (facts.ParentPid != WrapperPid || !MigrationArgumentsSelect(facts.CommandLine, _image, _config, true)) throw new IOException("Foreign DNS process configuration.");
        }
        public void Dispose() { _engine.Dispose(); _wrapper.Dispose(); _service.Dispose(); }
    }

    private static class MigrationNative
    {
        [StructLayout(LayoutKind.Sequential)] internal struct Status { internal uint Type, State, Controls, Win32Exit, ServiceExit, CheckPoint, WaitHint, Pid, Flags; }
        [StructLayout(LayoutKind.Sequential)] internal struct Config { internal uint Type, Start, Error; internal IntPtr BinaryPath, Group; internal uint Tag; internal IntPtr Dependencies, Account, Name; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Entry { internal uint Size, Usage, Pid; internal UIntPtr Heap; internal uint Module, Threads, Parent; internal int Priority; internal uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] internal string Name; }
        internal sealed class ServiceHandle : SafeHandleZeroOrMinusOneIsInvalid { private ServiceHandle() : base(true) { } protected override bool ReleaseHandle() => CloseServiceHandle(handle); }
        internal static int ParentPid(int pid)
        {
            IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
            if (snapshot == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
            try { var entry = new Entry { Size = (uint)Marshal.SizeOf<Entry>() }; if (!Process32First(snapshot, ref entry)) throw new IOException("Unavailable process snapshot.");
                int rows = 0; do { if (++rows > 65536) throw new IOException("Process snapshot exceeds its bound."); if (entry.Pid == pid) return checked((int)entry.Parent); } while (Process32Next(snapshot, ref entry));
                throw new IOException("Resolver left process snapshot."); }
            finally { CloseHandle(snapshot); }
        }
        internal static string CommandLine(SafeProcessHandle process)
        {
            NtQueryInformationProcess(process, 60, IntPtr.Zero, 0, out int size);
            if (size is < 16 or > 65536) throw new IOException("Invalid process command line size.");
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (NtQueryInformationProcess(process, 60, buffer, size, out int returned) != 0 || returned > size) throw new IOException("Unavailable process command line.");
                int length = (ushort)Marshal.ReadInt16(buffer); IntPtr text = Marshal.ReadIntPtr(buffer, 8);
                long offset = text.ToInt64() - buffer.ToInt64();
                if (length == 0 || (length & 1) != 0 || offset < 16 || offset > size - length) throw new IOException("Invalid process command line range.");
                return Marshal.PtrToStringUni(text, length / 2)!;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint length, uint flags);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CommandLineToArgvW(string command, out int count);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr value);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("advapi32.dll", EntryPoint = "OpenSCManagerW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern ServiceHandle OpenSCManager(string? machine, string? database, uint access);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("advapi32.dll", EntryPoint = "OpenServiceW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern ServiceHandle OpenService(ServiceHandle manager, string name, uint access);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryServiceStatusEx(ServiceHandle service, int kind, out Status status, int bytes, out int needed);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("advapi32.dll", EntryPoint = "QueryServiceConfigW", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryServiceConfig(ServiceHandle service, IntPtr config, int size, out int needed);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseServiceHandle(IntPtr service);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Process32First(IntPtr snapshot, ref Entry entry);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Process32Next(IntPtr snapshot, ref Entry entry);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(SafeProcessHandle process, int kind, IntPtr buffer, int bytes, out int needed);
    }
}
