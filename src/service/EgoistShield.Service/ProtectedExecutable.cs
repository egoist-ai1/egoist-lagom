using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace EgoistShield.Service;

// Installation inventory is part of the authenticated installer payload. Its
// machine ACL is the trust anchor after installation, never a user manifest.
internal sealed class ProtectedExecutable : IDisposable
{
    private const string TrustedInstallerSid = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    private const FileSystemRights MutableRights = FileSystemRights.Write | FileSystemRights.Delete |
        FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
    private readonly List<FileStream> _held = new();
    private readonly Action<string, string> _assertProtected;
    private readonly bool _nativeHandleChecks;
    private readonly string _root;

    private ProtectedExecutable(string root, Action<string, string> assertProtected, bool nativeHandleChecks)
    {
        _root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        _assertProtected = assertProtected;
        _nativeHandleChecks = nativeHandleChecks;
    }

    internal static ProtectedExecutable OpenHost(string installRoot, string role)
    {
        ClientAuthorizer.EnsureProgramFilesRoot(installRoot);
        return OpenHost(installRoot, role, AssertProtectedPath, nativeHandleChecks: true);
    }

    // Only a compile-time test seam; no production command or pipe can supply it.
    internal static ProtectedExecutable OpenHost(string installRoot, string role, Action<string, string> assertProtected, bool nativeHandleChecks)
    {
        if (role is not ("gui" or "worker" or "cli")) throw new ArgumentException("Unknown executable role.");
        var lease = new ProtectedExecutable(installRoot, assertProtected, nativeHandleChecks);
        try
        {
            var inventory = lease.OpenFile("resources/worker-host-integrity.json", maximumBytes: 1024 * 1024);
            using JsonDocument document = JsonDocument.Parse(inventory, new JsonDocumentOptions { MaxDepth = 16 });
            JsonElement root = document.RootElement;
            if (root.GetProperty("schemaVersion").GetInt32() != 1 || root.GetProperty("owner").GetString() != "EgoistShield")
                throw new InvalidDataException("Installed executable inventory has an unsupported identity.");
            JsonElement files = root.GetProperty("files");
            if (files.ValueKind != JsonValueKind.Array || files.GetArrayLength() is < 1 or > 1024)
                throw new InvalidDataException("Installed executable inventory has an invalid size.");
            var allPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var selected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (JsonElement entry in files.EnumerateArray())
            {
                string relative = ValidateRelative(entry.GetProperty("path").GetString());
                if (!allPaths.Add(relative)) throw new InvalidDataException("Duplicate executable inventory path.");
                JsonElement roles = entry.GetProperty("roles");
                if (roles.ValueKind != JsonValueKind.Array || roles.GetArrayLength() is < 1 or > 3 ||
                    roles.EnumerateArray().Any(value => value.GetString() is not ("gui" or "worker" or "cli")))
                    throw new InvalidDataException("Malformed executable inventory role.");
                if (!roles.EnumerateArray().Any(value => value.GetString() == role)) continue;
                FileStream file = lease.OpenAndVerify(relative, entry.GetProperty("bytes").GetInt64(), entry.GetProperty("sha256").GetString());
                selected.Add(relative);
                if (relative is "EgoistShield.exe" or "EgoistShield.Worker.exe")
                {
                    string expected = relative == "EgoistShield.exe" ? "000011011" : "100011011";
                    if (ReadFuseWire(file) != expected) throw new UnauthorizedAccessException("Installed executable does not match its GUI/worker fuse policy.");
                }
            }
            string[] required = role switch
            {
                "gui" => new[] { "EgoistShield.exe", "resources/app.asar" },
                "worker" => new[] { "EgoistShield.Worker.exe", "resources/component-worker.cjs", "resources/runtime/manifest.json" },
                _ => new[] { "resources/core-service/win-x64/EgoistShield.Service.exe", "resources/runtime/manifest.json" }
            };
            if (required.Any(relative => !selected.Contains(relative))) throw new InvalidDataException("Installed executable inventory is incomplete for its role.");
            // All DLLs in the executable search directory must have a pin. A
            // replaced or additional side-loaded DLL is never accepted by name.
            if (role is "gui" or "worker") lease.AssertPinnedDllSet(lease._root, selected, prefix: "");
            if (role is "cli" or "worker") lease.AssertPinnedDllSet(Path.Combine(lease._root, "resources", "core-service", "win-x64"), selected, "resources/core-service/win-x64/");
            return lease;
        }
        catch { lease.Dispose(); throw; }
    }

    internal void VerifyBundledRuntime(string candidate, string component)
    {
        if (component is not ("xray" or "sing-box")) throw new ArgumentException("Unknown native runtime.");
        string relative = $"resources/runtime/{component}/{component}.exe";
        string expected = Path.GetFullPath(Path.Combine(_root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!Path.GetFullPath(candidate).Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("Privileged execution requires the pinned bundled runtime; custom and user-profile runtimes run only without elevation.");
        // The manifest itself was pinned and is already held by the host lease.
        var manifest = _held.Single(file => file.Name.Equals(Path.Combine(_root, "resources", "runtime", "manifest.json"), StringComparison.OrdinalIgnoreCase));
        manifest.Position = 0;
        using JsonDocument document = JsonDocument.Parse(manifest, new JsonDocumentOptions { MaxDepth = 32 });
        if (document.RootElement.GetProperty("schemaVersion").GetInt32() != 1) throw new InvalidDataException("Unsupported native runtime manifest.");
        JsonElement[] components = document.RootElement.GetProperty("components").EnumerateArray()
            .Where(value => value.GetProperty("name").GetString() == component).ToArray();
        if (components.Length != 1 || components[0].GetProperty("present").GetBoolean() != true)
            throw new InvalidDataException("Native runtime component is missing or ambiguous.");
        JsonElement entries = components[0].GetProperty("files");
        if (entries.ValueKind != JsonValueKind.Array || entries.GetArrayLength() is < 1 or > 256) throw new InvalidDataException("Invalid native runtime file inventory.");
        var pinned = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (JsonElement entry in entries.EnumerateArray())
        {
            string item = ValidateRelative(entry.GetProperty("path").GetString());
            if (!item.StartsWith(component + "/", StringComparison.Ordinal) || !pinned.Add("resources/runtime/" + item))
                throw new InvalidDataException("Native runtime inventory escaped its component or contains a duplicate.");
            OpenAndVerify("resources/runtime/" + item, entry.GetProperty("size").GetInt64(), entry.GetProperty("sha256").GetString());
        }
        if (!pinned.Contains(relative)) throw new InvalidDataException("Native runtime executable is not pinned.");
        AssertPinnedDllSet(Path.GetDirectoryName(expected)!, pinned, "resources/runtime/" + component + "/");
    }

    private void AssertPinnedDllSet(string directory, HashSet<string> pinned, string prefix)
    {
        _assertProtected(directory, _root);
        foreach (string dll in Directory.EnumerateFiles(directory, "*", SearchOption.TopDirectoryOnly))
            if (Path.GetExtension(dll).Equals(".dll", StringComparison.OrdinalIgnoreCase) && !pinned.Contains(prefix + Path.GetFileName(dll)))
                throw new UnauthorizedAccessException("An unpinned DLL is present in the executable directory.");
    }

    private FileStream OpenAndVerify(string relative, long bytes, string? sha256)
    {
        if (bytes < 0 || bytes > 1024L * 1024 * 1024 || sha256 == null || sha256.Length != 64 || sha256.Any(value => !Uri.IsHexDigit(value)))
            throw new InvalidDataException("Invalid executable inventory checksum or size.");
        FileStream file = OpenFile(relative, bytes);
        if (file.Length != bytes || !Convert.ToHexString(SHA256.HashData(file)).Equals(sha256, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("Installed executable bytes do not match the authenticated inventory.");
        file.Position = 0;
        return file;
    }

    private FileStream OpenFile(string relative, long maximumBytes)
    {
        string candidate = Path.Combine(_root, ValidateRelative(relative).Replace('/', Path.DirectorySeparatorChar));
        TrustedPath.AssertPathUnderRoot(candidate, _root, requireLeaf: true);
        _assertProtected(candidate, _root);
        var file = new FileStream(candidate, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);
        _held.Add(file);
        if (file.Length > maximumBytes) throw new InvalidDataException("Protected executable input exceeded its size limit.");
        if (_nativeHandleChecks)
        {
            if (!GetFileInformationByHandle(file.SafeFileHandle, out var information)) throw new IOException("Cannot resolve protected file identity.");
            if (information.NumberOfLinks != 1 || (information.Attributes & (uint)FileAttributes.ReparsePoint) != 0)
                throw new UnauthorizedAccessException("Protected executable input is linked or has ambiguous file identity.");
        }
        return file;
    }

    private static string ValidateRelative(string? relative)
    {
        if (string.IsNullOrWhiteSpace(relative) || relative.Length > 512 || relative.Any(char.IsControl) || relative.Contains('\\') || relative.Contains(':') ||
            relative.StartsWith('/') || relative.Split('/').Any(value => value.Length == 0 || value is "." or ".." || value.EndsWith(' ') || value.EndsWith('.')))
            throw new InvalidDataException("Invalid protected executable inventory path.");
        return relative;
    }

    internal static void AssertProtectedPath(string candidate, string installRoot)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Protected executable ACL verification requires Windows.");
        ClientAuthorizer.EnsureProgramFilesRoot(installRoot);
        string programFiles = new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) }
            .Where(value => !string.IsNullOrWhiteSpace(value)).Select(Path.GetFullPath)
            .OrderByDescending(value => value.Length)
            .First(value => Path.GetFullPath(installRoot).Equals(Path.TrimEndingDirectorySeparator(value), StringComparison.OrdinalIgnoreCase) ||
                Path.GetFullPath(installRoot).StartsWith(Path.TrimEndingDirectorySeparator(value) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase));
        TrustedPath.AssertPathUnderRoot(candidate, programFiles, requireLeaf: true);
        string current = Path.GetFullPath(candidate);
        while (true)
        {
            bool directory = Directory.Exists(current);
            FileSystemSecurity security = directory
                ? new DirectoryInfo(current).GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access)
                : new FileInfo(current).GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access);
            AssertProtectedSecurity(security);
            if (current.Equals(Path.TrimEndingDirectorySeparator(programFiles), StringComparison.OrdinalIgnoreCase)) break;
            current = Path.GetDirectoryName(current) ?? throw new UnauthorizedAccessException("Executable parent chain is incomplete.");
        }
    }

    internal static void AssertProtectedSecurity(FileSystemSecurity security)
    {
        if (security.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner || !TrustedSid(owner))
            throw new UnauthorizedAccessException("Executable path is not owned by a trusted machine principal.");
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
            if (rule.AccessControlType == AccessControlType.Allow && (rule.PropagationFlags & PropagationFlags.InheritOnly) == 0 &&
                (rule.FileSystemRights & MutableRights) != 0 && !TrustedSid((SecurityIdentifier)rule.IdentityReference))
                throw new UnauthorizedAccessException("A non-administrator can modify the executable path or its parent.");
    }

    private static bool TrustedSid(SecurityIdentifier sid) => sid.IsWellKnown(WellKnownSidType.LocalSystemSid) ||
        sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid) || sid.Value == TrustedInstallerSid;

    private static string ReadFuseWire(FileStream file)
    {
        byte[] sentinel = Encoding.ASCII.GetBytes("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
        byte[] buffer = new byte[64 * 1024 + sentinel.Length + 11];
        file.Position = 0;
        int retained = 0, found = 0;
        string? wire = null;
        int count;
        while ((count = file.Read(buffer, retained, buffer.Length - retained)) > 0)
        {
            int length = retained + count;
            for (int offset = 0; offset + sentinel.Length + 11 <= length; offset++)
                if (buffer.AsSpan(offset, sentinel.Length).SequenceEqual(sentinel))
                {
                    if (++found != 1 || buffer[offset + sentinel.Length] != 1 || buffer[offset + sentinel.Length + 1] != 9)
                        throw new InvalidDataException("Unsupported installed Electron fuse schema.");
                    wire = Encoding.ASCII.GetString(buffer, offset + sentinel.Length + 2, 9);
                }
            retained = Math.Min(sentinel.Length + 10, length);
            Buffer.BlockCopy(buffer, length - retained, buffer, 0, retained);
        }
        file.Position = 0;
        return found == 1 ? wire! : throw new InvalidDataException("Installed Electron fuse wire is missing.");
    }

    public void Dispose()
    {
        foreach (FileStream file in _held) file.Dispose();
        _held.Clear();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        internal uint Attributes;
        internal System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
        internal uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
}
