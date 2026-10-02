using System;
using System.Threading;

namespace EgoistShield.Service;

// The mutation semaphore remains the single writer. An authenticated, validated
// foreground mutation only cancels cancellable background work before waiting.
// Pending foreground waiters also close the acquire/start race.
internal sealed class BackgroundSupervisionCancellation
{
    private readonly object _gate = new();
    private CancellationTokenSource? _active;
    private int _foreground;
    private bool _mutation;

    internal IDisposable EnterForeground()
    {
        lock (_gate)
        {
            _foreground++;
            if (!_mutation) _active?.Cancel();
            return new Lease(() => { lock (_gate) _foreground--; });
        }
    }

    internal CancellationTokenSource? TryBegin(CancellationToken shutdown)
    {
        lock (_gate)
        {
            if (_foreground != 0 || _active != null) return null;
            return _active = CancellationTokenSource.CreateLinkedTokenSource(shutdown);
        }
    }

    internal void End(CancellationTokenSource source)
    {
        lock (_gate)
        {
            if (ReferenceEquals(_active, source)) { _active = null; _mutation = false; }
            source.Dispose();
        }
    }

    internal IDisposable PausePreemption(CancellationToken token)
    {
        lock (_gate)
        {
            token.ThrowIfCancellationRequested();
            if (_active == null || _active.Token != token || _mutation)
                throw new InvalidOperationException("Background mutation does not own its supervision generation.");
            _mutation = true;
            return new Lease(() =>
            {
                lock (_gate)
                {
                    _mutation = false;
                    // Finish an already committed stop/start before foreground
                    // gets the semaphore; then cancel any later background probe.
                    if (_foreground != 0) _active?.Cancel();
                }
            });
        }
    }

    private sealed class Lease(Action release) : IDisposable
    {
        private Action? _release = release;
        public void Dispose() => Interlocked.Exchange(ref _release, null)?.Invoke();
    }
}
