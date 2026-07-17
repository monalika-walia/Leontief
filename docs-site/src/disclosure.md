# Security Disclosure

Leontief holds user funds; we treat reports accordingly.

- **Contact:** `security@leontief.app`
- **Policy:** coordinated disclosure, **90 days**. Report privately first; we
  acknowledge within 48 h and agree a timeline with you.
- **Critical fast lane:** a report demonstrating loss-of-funds risk goes
  straight to the pause playbook — deposits can be halted by the admin/multisig
  within the hour. **Exits are never paused**, so users can always leave.
- **Bug bounty:** none pre-revenue — stated honestly rather than promising one
  we cannot fund. Meaningful reports are credited publicly (with your consent)
  and prioritized for any future program.
- **Scope:** the contracts in `contracts/`, the deployed testnet instances in
  the [address registry](addresses.md), the dApp, and the backend API. Testnet
  demo keys are intentionally public; they are out of scope.

What helps us most: a minimal reproduction (a failing test against the repo's
harness in `tests/` is ideal), the invariant you believe is violated (see
[Security & Test Tie-out](security-testing.md)), and impact reasoning.
