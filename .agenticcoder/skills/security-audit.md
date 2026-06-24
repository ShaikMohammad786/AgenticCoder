---
name: Security Audit
description: Scan for security vulnerabilities and hardening opportunities
mode: PLAN
---

Perform a security audit on this project:

1. **Input validation** — SQL injection, XSS, command injection, path traversal
2. **Authentication** — Token handling, session management, CSRF protection
3. **Authorization** — Access control, privilege escalation, IDOR
4. **Data exposure** — Secrets in code, error messages leaking internals, logging PII
5. **Dependencies** — Known CVEs, outdated packages, supply chain risks
6. **Configuration** — CORS, CSP headers, secure defaults

For each vulnerability:
- Severity: Critical / High / Medium / Low
- File and line number
- Proof of concept (how to exploit)
- Recommended fix with code

Prioritize findings by severity.
