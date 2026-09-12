namespace EgoistShield.Service;

internal enum TransactionPhase
{
	Prepared,
	Applying,
	Verified,
	Committed,
	RollingBack,
	RolledBack,
	RecoveryRequired
}
