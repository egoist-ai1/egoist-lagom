# Hosted atomic-file ACL regression: exact failure captured

[Actual Windows run](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36821978104/job/110239329657) used exact source `173804fe1e0071a1d50aa48a7e136fb8a4d73744`, pinned SDK 10.0.401, and a real elevated administrator token. Locked restore, self-contained Core publish and production-path Core configure returned 0. The four configuration ACL readbacks selected Administrators as owner and the network fingerprint was preserved. Setup was not executed.

The separate owner regression returned **7 passed groups and 1 failed group**. Only `nonproduction-atomic-files` failed, at its literal before/after owner+access SDDL equality assertion after 256 atomic writes. Descriptor policy, tampered ACL refusal, real administrator owner selection, actual NTFS creation ACL before content, live-log reader sharing and nonproduction log ACL checks passed. The atomic generation and read-count assertions preceding the failed assertion also completed.

This test did not record the two SDDL values. A real change in access rights, Windows metadata normalization or another cause cannot yet be distinguished. Do not relax the assertion or infer a production defect without the raw descriptors and a native baseline comparison. The next narrow capture change must preserve this failing assertion and production source.

Raw diagnostics and logs are preserved unchanged; the receipt records their SHA256, the complete 208-entry artifact ZIP hash and exact source/run identity. This failed diagnostic is not release acceptance, installer acceptance or evidence of long-term uptime.
