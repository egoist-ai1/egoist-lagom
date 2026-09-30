using System;
using System.IO;

namespace EgoistShield.Service;

internal sealed class InstallerServiceMaintenance
{
    private readonly string[] _markers;

    internal InstallerServiceMaintenance(string stateRoot)
    {
        string productRoot = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(Path.GetFullPath(stateRoot)))
            ?? throw new ArgumentException("Core state root has no parent.", nameof(stateRoot));
        _markers = new[]
        {
            Path.Combine(productRoot, "installer", "service-maintenance.json"),
            Path.Combine(productRoot, "installer", "service-backup", "manifest.json")
        };
    }

    internal bool IsActive()
    {
        foreach (string marker in _markers)
        {
            try
            {
                using var stream = File.Open(marker, FileMode.Open, FileAccess.Read,
                    FileShare.ReadWrite | FileShare.Delete);
                return true;
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
            catch (IOException) { return true; }
            catch (UnauthorizedAccessException) { return true; }
        }
        return false;
    }
}
