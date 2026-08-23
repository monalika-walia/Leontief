# STATUS.md — prototype-spec status ledger

*Updated August 2026.* The spec (`leontief-prototype-spec.md`) is **frozen** and never rewritten;
this ledger is where status lives. Every row maps a spec section to {Done / In progress / Planned}
with a proof link. Tranche/budget truth is `leontief-build-application.md`; thesis truth is
[the litepaper](../leontief-litepaper.md) (§9 roadmap).

All metrics below are **testnet** figures on the **LEOD demo asset** (a purpose-built SEP-8
`auth_required|auth_revocable` asset), dated. Testnet figures are demonstration figures, not AUM —
counting rules in [Traction & Metrics Methodology](https://docs.leontief.tech/metrics-methodology).

| Spec section | Status | Proof |
|---|---|---|
| §0 Ground rules (fail-closed oracle, checked math, exits never pausable) | **Done** | Enforced in code + CI (`clippy -D warnings`, 100 unit tests, ≥90% coverage gate on vault + mini-pool); [SECURITY-TESTING.md](../SECURITY-TESTING.md) tie-out |
| §1 Stack/toolchain/repo | **Done** | Pinned `rust-toolchain.toml` + `Cargo.lock`; [repo](https://github.com/monalika-walia/leontief) |
| §2 Asset model + demo asset (LEOD, SEP-8) | **Done** | LEOD SAC [`CDE5ZR…4AOW`](https://stellar.expert/explorer/testnet/contract/CDE5ZRPD2SJCUZIKEVM546Y25YIER35WYKVWICQFDW3I2ZHL2MLD4AOW); unauthorized transfer reverts (demo beat 1) |
| §3 `vault` (ld-share mint/redeem, virtual-offset defense, balance-diff measurement) | **Done — live on testnet** | [`CB64EH…LHUS`](https://stellar.expert/explorer/testnet/contract/CB64EHOFGTWH2USSZP3PL2B66XJ4KD6A6C3SFXKPNTEO3NCIZFZWLHUS) · 26 unit tests + property suite + fuzz target |
| §4 `vault-factory` | **Done — live on testnet** | [`CBOG77…PMEM`](https://stellar.expert/explorer/testnet/contract/CBOG77VNQTV4OLUC562DPW3H5PE3F5EA3QACFZ3R542XLQGNIVYRPMEM) |
| §5 `oracle-adapter` (fail-closed) + feeds | **Done — live Reflector SEP-40 feed** (mock retained for drills) | [`CC624X…H7NC`](https://stellar.expert/explorer/testnet/contract/CC624XAUEW2MYLGRQ6LMLVJQWF3ER3FQXUW2UQIJ7N2JRIDBZTGBH7NC) · `reflector-feed` shim maps LEOD → Reflector USDC par-NAV proxy (see [Integrations/Reflector](https://docs.leontief.tech/integrations/reflector)) |
| §6 `mini-pool` (borrow + permissioned liquidation) | **Done — live on testnet.** The MiniPool is a **demo / liquidation-drill vehicle; the Blend pool is the production credit path per application Phase 1** | [`CCX7Z6…EQ54`](https://stellar.expert/explorer/testnet/contract/CCX7Z6TGAVAKOYMS3QAHD4VZHQB2QCC2XVQ4UWBZFSOX4HHDBB45EQ54) · 18 unit tests + property suite + fuzz target |
| §7 Security checklist | **Done, continuously enforced** | CI green (fmt · clippy · tests · coverage); [SECURITY-TESTING.md](../SECURITY-TESTING.md) |
| §8 The 5-beat demo | **Done — public** | [app.leontief.tech/demo](https://app.leontief.tech/demo); integration tests mirror it 1:1 |
| §9 Scripts & reproducibility | **Done** | `scripts/` (setup, demo, wire_reflector, gen_addresses); [ADDRESSES.md](./ADDRESSES.md) generated from committed deployment registry |
| §10 Weekly gates | **Done (superseded by CI)** | `just check` = PR gate |
| Beyond spec: Blend integration (production credit path) | **In progress — Tranche 1–2** | [Integrations/Blend](https://docs.leontief.tech/integrations/blend) research doc, dated + cited |
| Beyond spec: Telegram access layer | **Tranche 2 scope** | [Telegram](https://docs.leontief.tech/telegram) hub page (design) |
| Beyond spec: Autopilot (delegated signing) | **Tranche 2 scope — design only, testnet-first** | [Autopilot](https://docs.leontief.tech/autopilot) hub page (policy + Path A/B decision) |
| Beyond spec: multi-asset era (commodities → equities/ETFs) | **Planned — supply-triggered** (litepaper §9 phase 6) | Design doc pending commit (`leontief-multiasset-design.md`) |

## Live testnet metrics (dated)

As of **August 2026**, on the LEOD demo asset, priced by the **live Reflector SEP-40 feed**:
~$469k wrapped value across 49 testnet wallets, 100% of shares
deployed as collateral, 0 failed liquidations. Live view: [leontief.tech/performance](https://leontief.tech/performance)
(server reads the chain via `simulateTransaction`; no indexer trust). Counting rules and labeling
policy: [Metrics Methodology](https://docs.leontief.tech/metrics-methodology).
