using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using EgoistShield.Service;

internal static class Program
{
    private static string _work = "";
    private static int _passed;
    private static readonly string[] RelativePaths =
    {
        Path.Combine("Runtime", "SystemDoH", "service-logs", "egoistshield-system-doh-service.wrapper.log"),
        Path.Combine("Runtime", "TelegramProxy", "service-logs", "egoistshield-telegram-proxy-service.wrapper.log"),
        Path.Combine("Runtime", "Zapret", "logs", "zapret-service", "egoistshield-zapret-service.wrapper.log")
    };

    private static async Task<int> Main(string[] args)
    {
        int workIndex = Array.IndexOf(args, "--work");
        if (workIndex < 0 || workIndex + 1 >= args.Length || !Path.IsPathFullyQualified(args[workIndex + 1]))
            throw new ArgumentException("Use --work <absolute task work path>.");
        _work = Path.Combine(Path.GetFullPath(args[workIndex + 1]), "wrapper-log-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_work);
        var elapsed = Stopwatch.StartNew();
        try
        {
            if (args.Contains("--before"))
            {
                // Baseline control: the released Core has no wrapper-log guard.
                // Actual WinSW append behavior is verified by the trust audit;
                // this reproduces its retained native file without the new guard.
                string root = NewRoot("baseline");
                string file = Seed(root, RelativePaths[0], OwnedWrapperLogMaintenance.RotationThresholdBytes);
                AppendEvents(file, 20);
                Console.WriteLine($"BASELINE: retained={new FileInfo(file).Length}; appendBytes=1280; rotationThreshold={OwnedWrapperLogMaintenance.RotationThresholdBytes}");
                Assert(!File.Exists(file), "Before fix, oversized wrapper log remains unrotated.");
            }
            await Check("three exact paths rotate at 5 MiB and resume native appends", RotationAsync);
            await Check("one previous backup is replaced across 48 rotation cycles", RetentionAsync);
            await Check("missing and small files are untouched; lookalikes are excluded", SmallAndMissingAsync);
            await Check("five-minute monotonic deadline and cancellation", ScheduleAsync);
            await Check("busy source is deferred without truncation or blocking another wrapper", SharingAsync);
            await Check("busy previous backup is preserved and retried", PreviousSharingAsync);
            await Check("native ACL denial preserves the log and resumes after permission repair", PermissionDeniedAsync);
            await Check("foreign product root and production state root are rejected", ForeignRootAsync);
            await Check("native junction ancestors and backup leaves are rejected", JunctionAsync);
            int coreIndex = Array.IndexOf(args, "--core");
            if (coreIndex >= 0)
                await Check("actual Core warning is hourly and maintenance failures permit continuation", () => DispatcherIntegrationAsync(args[coreIndex + 1]));
            Console.WriteLine($"Wrapper log regression passed: {_passed} groups; elapsed={elapsed.Elapsed.TotalSeconds:0.00}s; work={_work}");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            Console.Error.WriteLine("Regression evidence preserved: " + _work);
            return 1;
        }
    }

    private static async Task Check(string name, Func<Task> run)
    { await run(); _passed++; Console.WriteLine("PASS: " + name); }
    private static void Assert(bool condition, string message)
    { if (!condition) throw new InvalidOperationException(message); }
    private static string NewRoot(string name)
    { string root = Path.Combine(_work, name); Directory.CreateDirectory(root); return root; }
    private static OwnedWrapperLogMaintenance Guard(string root, string? anchor = null)
    { return (OwnedWrapperLogMaintenance)Activator.CreateInstance(typeof(OwnedWrapperLogMaintenance), BindingFlags.Instance | BindingFlags.NonPublic, null, new object[] { root, anchor ?? _work }, null)!; }
    private static string Seed(string root, string relative, long size)
    {
        string file = Path.Combine(root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        using var stream = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.Read);
        stream.SetLength(size);
        return file;
    }
    private static void AppendEvents(string file, int count)
    {
        byte[] entry = Encoding.ASCII.GetBytes(new string('W', 62) + "\r\n");
        for (int i = 0; i < count; i++)
        {
            using var stream = new FileStream(file, FileMode.Append, FileAccess.Write, FileShare.Read);
            stream.Write(entry);
        }
    }

    private static Task RotationAsync()
    {
        string root = NewRoot("rotate");
        var files = RelativePaths.Select(relative => Seed(root, relative, OwnedWrapperLogMaintenance.RotationThresholdBytes)).ToArray();
        AppendEvents(files[0], 20);
        var result = Guard(root).RunIfDue(TimeSpan.Zero, CancellationToken.None);
        Assert(result.Rotated == 3 && result.Deferred == 0 && result.Rejected == 0, "All three owned logs must rotate.");
        foreach (string file in files)
        {
            Assert(!File.Exists(file) && new FileInfo(file + ".previous").Length >= OwnedWrapperLogMaintenance.RotationThresholdBytes, "Rename must preserve full content.");
            AppendEvents(file, 1);
            Assert(new FileInfo(file).Length == 64, "Next MinimalLock-style append must recreate the current log.");
        }
        Assert(new FileInfo(files[0] + ".previous").Length == OwnedWrapperLogMaintenance.RotationThresholdBytes + 1280, "No appended event can be truncated by rotation.");
        return Task.CompletedTask;
    }

    private static async Task RetentionAsync()
    {
        string root = NewRoot("retention");
        var guard = Guard(root);
        int checks = 0, deferred = 0;
        for (int cycle = 0; cycle < 48; cycle++)
        {
            foreach (string relative in RelativePaths) AppendEvents(Seed(root, relative, OwnedWrapperLogMaintenance.RotationThresholdBytes), cycle + 1);
            int rotated = 0;
            var deadline = Stopwatch.StartNew();
            do
            {
                var result = guard.RunIfDue(TimeSpan.FromMinutes(checks++ * 5), CancellationToken.None);
                rotated += result.Rotated;
                deferred += result.Deferred;
                Assert(result.Rejected == 0, "Ordinary fixture paths must stay trusted.");
                if (rotated == 3) break;
                Assert(result.Deferred > 0 && deadline.Elapsed < TimeSpan.FromSeconds(3), "An ordinary file must rotate after transient filesystem sharing releases.");
                await Task.Delay(25); // Fixture only: AV may briefly inspect newly written files.
            } while (true);
            foreach (string relative in RelativePaths)
            {
                string file = Path.Combine(root, relative);
                Assert(new FileInfo(file + ".previous").Length == OwnedWrapperLogMaintenance.RotationThresholdBytes + (cycle + 1) * 64, "The retained backup must be the latest cycle.");
                Assert(Directory.GetFiles(Path.GetDirectoryName(file)!).Length == 1, "Only one backup per exact wrapper may remain.");
            }
        }
        Console.WriteLine($"RETENTION: rotations=144; deferredNativeAttempts={deferred}; scheduledChecks={checks}");
    }

    private static Task SmallAndMissingAsync()
    {
        string root = NewRoot("small");
        string small = Seed(root, RelativePaths[0], OwnedWrapperLogMaintenance.RotationThresholdBytes - 1);
        string foreign = Seed(root, Path.Combine("Runtime", "SystemDoH", "service-logs", "foreign.wrapper.log"), OwnedWrapperLogMaintenance.RotationThresholdBytes + 1);
        var result = Guard(root).RunIfDue(TimeSpan.Zero, CancellationToken.None);
        Assert(result.Rotated == 0 && result.Deferred == 0 && result.Rejected == 0, "Missing wrappers must not create directories or failures.");
        Assert(new FileInfo(small).Length == OwnedWrapperLogMaintenance.RotationThresholdBytes - 1 && File.Exists(foreign), "Small and nonallowlisted logs must stay untouched.");
        Assert(!Directory.Exists(Path.Combine(root, "Runtime", "TelegramProxy")), "A missing wrapper directory must not be created.");
        return Task.CompletedTask;
    }

    private static Task ScheduleAsync()
    {
        string root = NewRoot("schedule");
        var guard = Guard(root);
        guard.RunIfDue(TimeSpan.FromSeconds(15), CancellationToken.None);
        string file = Seed(root, RelativePaths[0], OwnedWrapperLogMaintenance.RotationThresholdBytes);
        Assert(!guard.RunIfDue(TimeSpan.FromSeconds(314), CancellationToken.None).Checked && File.Exists(file), "A check must not repeat before five monotonic minutes.");
        Assert(guard.RunIfDue(TimeSpan.FromSeconds(315), CancellationToken.None).Rotated == 1, "A due check must run even with no DNS maintenance request.");
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        try { guard.RunIfDue(TimeSpan.FromSeconds(316), cancelled.Token); throw new InvalidOperationException("Cancellation was swallowed."); }
        catch (OperationCanceledException) { }
        return Task.CompletedTask;
    }

    private static Task SharingAsync()
    {
        string root = NewRoot("busy-source");
        string file = Seed(root, RelativePaths[0], OwnedWrapperLogMaintenance.RotationThresholdBytes);
        Seed(root, RelativePaths[1], OwnedWrapperLogMaintenance.RotationThresholdBytes);
        var guard = Guard(root);
        var watch = Stopwatch.StartNew();
        using (var held = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            var result = guard.RunIfDue(TimeSpan.Zero, CancellationToken.None);
            Assert(result.Deferred == 1 && result.Rotated == 1, "Busy wrapper must not block the independently rotatable one.");
            Assert(held.Length == OwnedWrapperLogMaintenance.RotationThresholdBytes && File.Exists(file), "A held wrapper log must never be truncated.");
        }
        Assert(watch.Elapsed < TimeSpan.FromSeconds(2), "Busy files must defer without lock retry sleeps.");
        Assert(guard.RunIfDue(TimeSpan.FromMinutes(5), CancellationToken.None).Rotated == 1, "Release must permit the next scheduled rotation.");
        return Task.CompletedTask;
    }

    private static Task PreviousSharingAsync()
    {
        string root = NewRoot("busy-previous");
        string file = Seed(root, RelativePaths[0], OwnedWrapperLogMaintenance.RotationThresholdBytes);
        File.WriteAllText(file + ".previous", "old backup");
        var guard = Guard(root);
        using (var held = new FileStream(file + ".previous", FileMode.Open, FileAccess.Read, FileShare.Read))
            Assert(guard.RunIfDue(TimeSpan.Zero, CancellationToken.None).Deferred == 1 && File.Exists(file) && held.Length == 10, "Busy backup must not cause deletion of either log.");
        Assert(guard.RunIfDue(TimeSpan.FromMinutes(5), CancellationToken.None).Rotated == 1, "Unlocked backup must be replaced on the next check.");
        return Task.CompletedTask;
    }

    private static Task ForeignRootAsync()
    {
        string root = NewRoot("foreign");
        string anchor = NewRoot("allowed-anchor");
        string file = Seed(root, RelativePaths[0], OwnedWrapperLogMaintenance.RotationThresholdBytes);
        var result = Guard(root, anchor).RunIfDue(TimeSpan.Zero, CancellationToken.None);
        Assert(result.Rejected == 3 && File.Exists(file), "A product root outside the trusted anchor must be rejected.");
        try { OwnedWrapperLogMaintenance.ForVerifiedProductionRoot(root); throw new InvalidOperationException("Foreign production state root was accepted."); }
        catch (UnauthorizedAccessException) { }
        return Task.CompletedTask;
    }

    private static Task PermissionDeniedAsync()
    {
        string root = NewRoot("permission-denial");
        string file = Seed(root, RelativePaths[0], OwnedWrapperLogMaintenance.RotationThresholdBytes);
        var fileInfo = new FileInfo(file);
        var directoryInfo = new DirectoryInfo(fileInfo.DirectoryName!);
        string originalFile = fileInfo.GetAccessControl().GetSecurityDescriptorSddlForm(AccessControlSections.Access);
        string originalDirectory = directoryInfo.GetAccessControl().GetSecurityDescriptorSddlForm(AccessControlSections.Access);
        var guard = Guard(root);
        using var identity = WindowsIdentity.GetCurrent();
        var sid = identity.User ?? throw new InvalidOperationException("Fixture identity is unavailable.");
        try
        {
            FileSecurity deniedFile = fileInfo.GetAccessControl();
            deniedFile.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.Delete, AccessControlType.Deny));
            fileInfo.SetAccessControl(deniedFile);
            DirectorySecurity deniedDirectory = directoryInfo.GetAccessControl();
            deniedDirectory.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.DeleteSubdirectoriesAndFiles, AccessControlType.Deny));
            directoryInfo.SetAccessControl(deniedDirectory);
            var result = guard.RunIfDue(TimeSpan.Zero, CancellationToken.None);
            Assert(result.Deferred == 1 && result.Rotated == 0 && result.Rejected == 0 && File.Exists(file), "Native rename permission denial must defer without deleting or truncating the file.");
            Assert(fileInfo.Length == OwnedWrapperLogMaintenance.RotationThresholdBytes, "Permission denial must preserve all log bytes.");
        }
        finally
        {
            var restoreDirectory = new DirectorySecurity();
            restoreDirectory.SetSecurityDescriptorSddlForm(originalDirectory, AccessControlSections.Access);
            var restoreFile = new FileSecurity();
            restoreFile.SetSecurityDescriptorSddlForm(originalFile, AccessControlSections.Access);
            try { directoryInfo.SetAccessControl(restoreDirectory); }
            finally { fileInfo.SetAccessControl(restoreFile); }
        }
        Assert(guard.RunIfDue(TimeSpan.FromMinutes(5), CancellationToken.None).Rotated == 1, "The next check must recover after fixture ACLs are restored.");
        return Task.CompletedTask;
    }

    private static async Task JunctionAsync()
    {
        string root = NewRoot("junction");
        string target = NewRoot("junction-target");
        Directory.CreateDirectory(Path.Combine(root, "Runtime"));
        string outsideFile = Seed(target, Path.Combine("service-logs", "egoistshield-system-doh-service.wrapper.log"), OwnedWrapperLogMaintenance.RotationThresholdBytes);
        await CreateJunctionAsync(Path.Combine(root, "Runtime", "SystemDoH"), target);
        string good = Seed(root, RelativePaths[1], OwnedWrapperLogMaintenance.RotationThresholdBytes);
        string zapret = Seed(root, RelativePaths[2], OwnedWrapperLogMaintenance.RotationThresholdBytes);
        string backupTarget = NewRoot("backup-junction-target");
        File.WriteAllText(Path.Combine(backupTarget, "preserve"), "untouched");
        await CreateJunctionAsync(zapret + ".previous", backupTarget);
        var result = Guard(root).RunIfDue(TimeSpan.Zero, CancellationToken.None);
        Assert(result.Rejected == 2 && result.Rotated == 1, "Untrusted wrapper/backup paths must not block the trusted wrapper.");
        Assert(File.Exists(outsideFile) && File.Exists(zapret) && File.ReadAllText(Path.Combine(backupTarget, "preserve")) == "untouched", "Junction targets must stay unchanged.");
        Assert(File.Exists(good + ".previous"), "The independently trusted wrapper must rotate.");
    }

    private static async Task CreateJunctionAsync(string link, string target)
    {
        string Quote(string value) => "'" + value.Replace("'", "''") + "'";
        using var process = new Process { StartInfo = new ProcessStartInfo(ResolvePowerShell7()) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (string argument in new[] { "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path " + Quote(link) + " -Target " + Quote(target) + " | Out-Null" }) process.StartInfo.ArgumentList.Add(argument);
        process.StartInfo.Environment["POWERSHELL_TELEMETRY_OPTOUT"] = "1";
        Assert(process.Start(), "Native junction fixture process did not start.");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        Task<string> stdout = ReadBoundedAsync(process.StandardOutput, timeout.Token);
        Task<string> stderr = ReadBoundedAsync(process.StandardError, timeout.Token);
        Task exited = process.WaitForExitAsync(timeout.Token);
        try { await Task.WhenAll(stdout, stderr, exited).WaitAsync(timeout.Token); }
        catch
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            try { process.StandardOutput.Close(); } catch (IOException) { }
            try { process.StandardError.Close(); } catch (IOException) { }
            Observe(stdout); Observe(stderr); Observe(exited);
            throw;
        }
        string error = await stderr;
        Assert(process.ExitCode == 0 && (File.GetAttributes(link) & FileAttributes.ReparsePoint) != 0, "Native junction fixture failed: " + error);
        Console.WriteLine($"JUNCTION: linkCharacters={link.Length}; targetCharacters={target.Length}; nativeReparsePoint=true");
    }

    private static string ResolvePowerShell7()
    {
        string? configured = Environment.GetEnvironmentVariable("LAGOM_TEST_POWERSHELL");
        if (!string.IsNullOrWhiteSpace(configured))
        {
            Assert(Path.IsPathFullyQualified(configured), "LAGOM_TEST_POWERSHELL must be an absolute PowerShell 7 executable path.");
            return ValidatePowerShell7(configured);
        }
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            string candidateDirectory = directory.Trim().Trim('"');
            if (!Path.IsPathFullyQualified(candidateDirectory)) continue;
            string candidate = Path.Combine(candidateDirectory, "pwsh.exe");
            if (File.Exists(candidate)) return ValidatePowerShell7(candidate);
        }
        throw new FileNotFoundException("PowerShell 7 is required for native junction fixtures; set LAGOM_TEST_POWERSHELL or expose pwsh.exe in PATH.");
    }

    private static string ValidatePowerShell7(string executable)
    {
        string fullPath = Path.GetFullPath(executable);
        Assert(File.Exists(fullPath) && Path.GetFileName(fullPath).Equals("pwsh.exe", StringComparison.OrdinalIgnoreCase), "Native junction fixtures require an existing pwsh.exe.");
        Assert(FileVersionInfo.GetVersionInfo(fullPath).FileMajorPart >= 7, "Native junction fixtures require PowerShell 7 or later.");
        return fullPath;
    }

    private static async Task<string> ReadBoundedAsync(StreamReader reader, CancellationToken cancellationToken)
    {
        var output = new StringBuilder();
        var buffer = new char[1024];
        while (true)
        {
            int count = await reader.ReadAsync(buffer.AsMemory(), cancellationToken);
            if (count == 0) return output.ToString();
            Assert(output.Length + count <= 8192, "Native junction fixture output exceeded 8 KiB.");
            output.Append(buffer, 0, count);
        }
    }

    private static void Observe(Task task)
    {
        _ = task.ContinueWith(failed => { _ = failed.Exception; }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously | TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
    }

    private static async Task DispatcherIntegrationAsync(string corePath)
    {
        var assembly = Assembly.LoadFrom(Path.GetFullPath(corePath));
        Type dispatcherType = assembly.GetType("EgoistShield.Service.OperationDispatcher", throwOnError: true)!;
        Type guardType = assembly.GetType("EgoistShield.Service.OwnedWrapperLogMaintenance", throwOnError: true)!;
        Type logType = assembly.GetType("EgoistShield.Service.ServiceLog", throwOnError: true)!;
        object dispatcher = RuntimeHelpers.GetUninitializedObject(dispatcherType);
        string root = NewRoot("dispatcher-foreign");
        string anchor = NewRoot("dispatcher-anchor");
        string logRoot = NewRoot("dispatcher-log");
        object guard = Activator.CreateInstance(guardType, BindingFlags.Instance | BindingFlags.NonPublic, null, new object[] { root, anchor }, null)!;
        object log = Activator.CreateInstance(logType, new object[] { logRoot })!;
        dispatcherType.GetField("_wrapperLogMaintenance", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(dispatcher, guard);
        dispatcherType.GetField("_log", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(dispatcher, log);
        MethodInfo maintain = dispatcherType.GetMethod("MaintainOwnedWrapperLogsAsync", BindingFlags.Instance | BindingFlags.NonPublic)!;
        for (int minute = 0; minute <= 60; minute += 5)
        {
            await (Task)maintain.Invoke(dispatcher, new object[] { TimeSpan.FromMinutes(minute), CancellationToken.None })!;
            // No exception escapes the actual dispatcher method; independent
            // DNS checks can continue without touching the machine in this fixture.
        }
        string[] warnings = File.ReadAllLines(Path.Combine(logRoot, "service.log"));
        Assert(warnings.Length == 2 && warnings.All(line => line.Contains("untrusted=3", StringComparison.Ordinal)), "Repeated path denial must produce only the first and hourly warning.");
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        try { await (Task)maintain.Invoke(dispatcher, new object[] { TimeSpan.FromMinutes(65), cancelled.Token })!; throw new InvalidOperationException("Dispatcher swallowed shutdown cancellation."); }
        catch (OperationCanceledException) { }
        guardType.GetField("_trustedAnchor", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(guard, string.Empty);
        await (Task)maintain.Invoke(dispatcher, new object[] { TimeSpan.FromMinutes(65), CancellationToken.None })!;
        await (Task)maintain.Invoke(dispatcher, new object[] { TimeSpan.FromMinutes(120), CancellationToken.None })!;
        warnings = File.ReadAllLines(Path.Combine(logRoot, "service.log"));
        Assert(warnings.Length == 3 && warnings[^1].Contains("service/DNS checks continue", StringComparison.Ordinal), "An unexpected guard exception must not escape or bypass the hourly warning limit.");
        using (var held = new FileStream(Path.Combine(logRoot, "service.log"), FileMode.Open, FileAccess.Read, FileShare.Read))
            await (Task)maintain.Invoke(dispatcher, new object[] { TimeSpan.FromMinutes(180), CancellationToken.None })!;
        await (Task)maintain.Invoke(dispatcher, new object[] { TimeSpan.FromMinutes(185), CancellationToken.None })!;
        Assert(File.ReadAllLines(Path.Combine(logRoot, "service.log")).Length == 3, "A busy diagnostic log must neither interrupt continuation nor flood retry warnings.");
    }
}
