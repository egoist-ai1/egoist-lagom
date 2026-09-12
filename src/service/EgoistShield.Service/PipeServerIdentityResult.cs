namespace EgoistShield.Service;

internal sealed record PipeServerIdentityResult(bool Ok, string Code, int? ServerProcessId = null, int? ServiceProcessId = null, string? Message = null);
