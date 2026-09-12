using System;

namespace EgoistShield.Service;

internal sealed class ServiceOperationException(string code, string message, bool retryable = false, Exception? innerException = null) : Exception(message, innerException)
{
	public string Code { get; } = code;

	public bool Retryable { get; } = retryable;
}
