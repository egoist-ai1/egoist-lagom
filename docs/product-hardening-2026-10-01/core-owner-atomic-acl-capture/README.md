# Actual before/after atomic-file security descriptors

[Hosted Windows capture](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36823434766/job/110243766727), exact source `26f82c39e580139fabfa9ae22861cfa813c7e4f0`, still failed the unchanged literal SDDL assertion. It now preserves both real descriptors under the actual elevated administrator token.

Initial: `O:BAD:(A;ID;FA;;;BA)(A;ID;FA;;;SY)(A;ID;0x1200a9;;;BU)`.
Final: `O:BAD:AI(A;ID;FA;;;BA)(A;ID;FA;;;SY)(A;ID;0x1200a9;;;BU)`.

The owner SID, all three ordered access rules (SID, rights, access type, inherited/inheritance/propagation flags), DACL protection and canonical status are identical. The only recorded control-flag difference is the added `DiscretionaryAclAutoInherited` bit 0x400: 32772 to 33796. All 256 replacement writes and 256 valid reads completed; false Missing was zero. This explains why literal SDDL equality failed without a changed access rule. The original/native ReplaceFile baseline is a separate pending comparison before final test acceptance.

Actual production-path Core configuration again returned 0 and before/after network fingerprints matched. These harmless test files remain outside the product state path; production ACL enforcement was unchanged. The raw owner and installer diagnostics, full logs and artifact hash are retained. This capture is not signed Setup, SCM/network/legacy installation acceptance or proof of months of uptime.
