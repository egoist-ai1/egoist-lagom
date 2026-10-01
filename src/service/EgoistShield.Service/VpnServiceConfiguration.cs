using System;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace EgoistShield.Service;

internal sealed record VpnConnection(int SchemaVersion, string Owner, string NodeId, string NodeName,
    string RuntimeKind, int ProxyPort, string ConfigSha256, string Config);

internal sealed class VpnServiceConfiguration : IDisposable
{
    private readonly FileStream _connection;
    internal VpnConnection Value { get; }
    private VpnServiceConfiguration(FileStream connection, VpnConnection value)
    { _connection = connection; Value = value; }

    internal static VpnServiceConfiguration Open(string productRoot)
    {
        string file = Path.Combine(productRoot, "Service", "Vpn", "connection.json");
        AssertPrivatePath(file, productRoot);
        var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
        try
        {
            if (stream.Length is <= 0 or > 524288) throw new InvalidDataException("VPN connection exceeds its size bound.");
            using var reader = new StreamReader(stream, new UTF8Encoding(false, true), false, 4096, leaveOpen: true);
            var connection = Parse(reader.ReadToEnd());
            AssertPrivatePath(file, productRoot);
            stream.Position = 0;
            return new(stream, connection);
        }
        catch { stream.Dispose(); throw; }
    }

    internal static VpnConnection Parse(string text)
    {
        var value = JsonSerializer.Deserialize<VpnConnection>(text, JsonDefaults.Options)
            ?? throw new InvalidDataException("VPN connection is empty.");
        if (value.SchemaVersion != 1 || value.Owner != "EgoistShield" || value.RuntimeKind != "sing-box" ||
            value.ProxyPort != ServiceContract.VpnProxyPort || string.IsNullOrWhiteSpace(value.NodeId) || value.NodeId.Length > 256 ||
            value.NodeName == null || value.NodeName.Length > 512 || value.Config == null || Encoding.UTF8.GetByteCount(value.Config) > 262144 ||
            value.ConfigSha256 == null || value.ConfigSha256.Length != 64 || value.ConfigSha256.Any(c => !Uri.IsHexDigit(c)))
            throw new InvalidDataException("VPN connection identity is invalid.");
        if (!Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value.Config))).Equals(value.ConfigSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("VPN connection config checksum does not match.");
        using var document = JsonDocument.Parse(value.Config, new JsonDocumentOptions { MaxDepth = 32 });
        var config = document.RootElement;
        if (config.ValueKind != JsonValueKind.Object || !config.TryGetProperty("inbounds", out var inbounds) || inbounds.ValueKind != JsonValueKind.Array || inbounds.GetArrayLength() != 2)
            throw new InvalidDataException("VPN requires exactly the fixed local proxy and TUN endpoints.");
        var proxy = inbounds[0]; var tun = inbounds[1];
        if (proxy.GetProperty("type").GetString() != "mixed" || proxy.GetProperty("listen").GetString() != "127.0.0.1" ||
            proxy.GetProperty("listen_port").GetInt32() != ServiceContract.VpnProxyPort || tun.GetProperty("type").GetString() != "tun" ||
            tun.GetProperty("interface_name").GetString() != "egoist-vpn" || !tun.GetProperty("auto_route").GetBoolean() || !tun.GetProperty("strict_route").GetBoolean())
            throw new InvalidDataException("VPN local proxy or TUN contract is invalid.");
        if (!config.TryGetProperty("log", out var log) || log.GetProperty("level").GetString() != "error" || log.TryGetProperty("output", out _))
            throw new InvalidDataException("VPN runtime log destination is invalid.");
        string[] topLevel = { "log", "dns", "inbounds", "outbounds", "route", "endpoints" };
        if (config.EnumerateObject().Any(property => !topLevel.Contains(property.Name, StringComparer.Ordinal)))
            throw new InvalidDataException("VPN config includes an unsupported extension.");
        return value;
    }

    // Vpn contains credentials: unlike ordinary product files, Users cannot
    // inherit read access here. Check every dedicated directory and the leaf.
    internal static void AssertPrivatePath(string file, string productRoot)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        TrustedPath.AssertPathUnderRoot(file, productRoot, requireLeaf: true);
        string current = Path.GetFullPath(file), root = Path.GetFullPath(productRoot);
        var mutable = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles |
            FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
        while (!current.Equals(root, StringComparison.OrdinalIgnoreCase))
        {
            bool privateDirectory = Path.GetFileName(current).Equals("Vpn", StringComparison.OrdinalIgnoreCase);
            bool privateLeaf = current.Equals(Path.GetFullPath(file), StringComparison.OrdinalIgnoreCase);
            FileSystemSecurity security = Directory.Exists(current)
                ? new DirectoryInfo(current).GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access)
                : new FileInfo(current).GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access);
            if (security.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner || !Trusted(owner))
                throw new UnauthorizedAccessException("VPN state owner is untrusted.");
            foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
                if (rule.AccessControlType == AccessControlType.Allow && (rule.PropagationFlags & PropagationFlags.InheritOnly) == 0 &&
                    !Trusted((SecurityIdentifier)rule.IdentityReference) && ((rule.FileSystemRights & mutable) != 0 ||
                        (privateDirectory || privateLeaf) && (rule.FileSystemRights & FileSystemRights.ReadData) != 0))
                    throw new UnauthorizedAccessException("VPN state exposes access to an interactive user.");
            current = Path.GetDirectoryName(current) ?? throw new UnauthorizedAccessException("VPN state parent chain is incomplete.");
        }
        FileSystemSecurity rootSecurity = new DirectoryInfo(root).GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access);
        if (rootSecurity.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier rootOwner || !Trusted(rootOwner))
            throw new UnauthorizedAccessException("VPN product root owner is untrusted.");
        foreach (FileSystemAccessRule rule in rootSecurity.GetAccessRules(true, true, typeof(SecurityIdentifier)))
            if (rule.AccessControlType == AccessControlType.Allow && (rule.PropagationFlags & PropagationFlags.InheritOnly) == 0 &&
                !Trusted((SecurityIdentifier)rule.IdentityReference) && (rule.FileSystemRights & mutable) != 0)
                throw new UnauthorizedAccessException("VPN product root is writable by an interactive user.");
    }

    private static bool Trusted(SecurityIdentifier sid) => sid.IsWellKnown(WellKnownSidType.LocalSystemSid) || sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid);
    public void Dispose() => _connection.Dispose();
}
