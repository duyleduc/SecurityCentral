 Still Missing (market gaps)

  ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────┬───────────┐
  │                                                      Gap                                                       │                        Impact                        │  Effort   │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────┼───────────┤
  │ Binary version CVE matching — agent collects OpenSSL/curl/nginx versions but they're never queried against OSV │ High — misses the most commonly exploited components │ 1-2 days  │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────┼───────────┤
  │ Alpine package collection — osvEcosystem maps Alpine but agent has no apk info code path                       │ Medium — Docker hosts get 0 coverage                 │ 2-3 hours │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────┼───────────┤
  │ Server-side score persistence + trend — score computed client-side only, no history                            │ Medium — can't answer "are we improving?"            │ 2-3 days  │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────┼───────────┤
  │ Org-wide CVE dashboard — each server viewed individually, no cross-server view                                 │ Medium — ops teams need single-pane                  │ 2-3 days  │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────┼───────────┤
  │ PDF report export — only window.print()                                                                        │ Medium — needed for compliance                       │ 2-3 days  │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────┼───────────┤
  │ CIS Benchmark mapping — audit checks exist but aren't mapped to CIS control IDs                                │ Low-medium — helps with compliance questionnaires    │ 1-2 days  │
  └────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────┴───────────┘


  Verdict: Market-Ready for MVP

  For a lightweight security platform targeting small companies, the current CVE scanning is solid for an MVP launch. You have:
  - Proper severity classification (CVSS v3)
  - Exploit likelihood prioritization (EPSS)
  - Actionable fix commands (remediation)
  - Actively-exploited flagging (CISA KEV)
  - Auto-resolution when packages are patched
  - Multi-distro support (Debian, Ubuntu, RHEL family)

  The binary version matching is the highest-value remaining gap — OpenSSL and curl CVEs are headline vulnerabilities that customers expect to see. That would be the next thing I'd tackle before launch.

  Want me to implement binary version CVE matching?