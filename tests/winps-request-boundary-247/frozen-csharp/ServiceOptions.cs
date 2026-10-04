namespace EgoistShield.Service;

internal sealed record ServiceOptions(string PipeName, string StateRoot, bool ConsoleMode, bool AllowDevClient, string? InstallRoot);
