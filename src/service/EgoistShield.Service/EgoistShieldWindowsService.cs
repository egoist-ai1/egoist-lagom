using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.ServiceProcess;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class EgoistShieldWindowsService : ServiceBase
{
	private readonly ServiceOptions _options;

	private CancellationTokenSource? _stopSource;

	private Task? _runTask;

	public EgoistShieldWindowsService(ServiceOptions options)
	{
		_options = options;
		base.ServiceName = "EgoistShieldCore";
		base.CanStop = true;
		base.CanShutdown = true;
		base.AutoLog = true;
	}

	protected override void OnStart(string[] args)
	{
		if (_runTask is { IsCompleted: false }) throw new InvalidOperationException("Core from the previous service lifetime is still stopping.");
		CancellationTokenSource stopSource = new CancellationTokenSource();
		_stopSource = stopSource;
		_runTask = Task.Run(async delegate
		{
			_ = 1;
			try
			{
				await (await ServiceEngine.CreateAsync(_options, stopSource.Token)).RunAsync(stopSource.Token);
				if (!stopSource.IsCancellationRequested) throw new IOException("Core listener ended unexpectedly.");
			}
			catch (OperationCanceledException) when (stopSource.IsCancellationRequested)
			{
			}
			catch (Exception value)
			{
				try { EventLog.WriteEntry($"EgoistShieldCore failed: {value}", EventLogEntryType.Error); }
				catch (Exception logError) { Trace.TraceError("Core failure could not be written to Event Log: " + logError.Message); }
				base.ExitCode = 1;
				ThreadPool.QueueUserWorkItem(delegate(object? state)
				{
					((ServiceBase)state).Stop();
				}, this);
			}
		});
	}

	protected override void OnStop()
	{
		StopCore();
	}

	protected override void OnShutdown()
	{
		StopCore();
	}

	private void StopCore()
	{
		_stopSource?.Cancel();
		try
		{
			var elapsed = Stopwatch.StartNew();
			while (_runTask != null && !_runTask.Wait(TimeSpan.FromSeconds(10)))
			{
				try { RequestAdditionalTime(20000); } catch (InvalidOperationException) { }
				if (elapsed.Elapsed > ServiceContract.RollbackGracePeriod + TimeSpan.FromSeconds(30))
				{
					// Keep the crash marker and fail the owned Core process rather than
					// report STOPPED while a privileged rollback still mutates the system.
					Trace.TraceError("Core shutdown exceeded the bounded rollback grace period.");
					Environment.Exit(1);
				}
			}
		}
		catch (AggregateException ex) when (ex.InnerExceptions.All((Exception item) => item is OperationCanceledException))
		{
		}
		finally
		{
			_stopSource?.Dispose();
			_stopSource = null;
			_runTask = null;
		}
	}
}
