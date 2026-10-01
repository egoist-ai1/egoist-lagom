using System;
using System.IO;

namespace EgoistShield.Service;

internal enum AtomicJsonReadKind { Missing, Valid, Unavailable, Corrupt }

internal sealed record AtomicJsonReadResult<T>(AtomicJsonReadKind Kind, T? Value = default,
    string? ErrorCode = null, long? Bytes = null, string? Sha256 = null)
{
    internal T? ValueOrThrow(string fileName) => Kind switch
    {
        AtomicJsonReadKind.Valid => Value,
        AtomicJsonReadKind.Missing => default,
        _ => throw new StateReadException(Kind, fileName, ErrorCode ?? "STATE_READ_FAILED", Bytes, Sha256)
    };

    internal object Describe() => new { kind = Kind.ToString().ToLowerInvariant(), errorCode = ErrorCode, bytes = Bytes, sha256 = Sha256 };
}

internal sealed class StateReadException : IOException
{
    internal AtomicJsonReadKind Kind { get; }
    internal string FileName { get; }
    internal string ErrorCode { get; }
    internal long? Bytes { get; }
    internal string? Sha256 { get; }

    internal StateReadException(AtomicJsonReadKind kind, string fileName, string errorCode, long? bytes = null, string? sha256 = null)
        : base($"Protected state {fileName} is {kind.ToString().ToLowerInvariant()} ({errorCode}); it was preserved and cannot authorize mutation.")
    {
        Kind = kind; FileName = Path.GetFileName(fileName); ErrorCode = errorCode; Bytes = bytes; Sha256 = sha256;
    }
}
