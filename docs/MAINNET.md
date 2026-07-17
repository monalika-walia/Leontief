# docs/MAINNET.md — mainnet launch runbook (S3, execute at Tranche 3)

Contracts are immutable: there is no rollback, only **pause deposits + comms**.
Everything below is rehearsed end-to-end on testnet as a dress rehearsal, timed,
with the checklist committed, before any mainnet ceremony.

## 0 · Preflight gate — ALL boxes or no launch

- [ ] Audit Bank findings remediated; regression suite green against the audited
      commit (`just check`, beats, golden vectors, nightly props + fuzz clean)
- [ ] Coverage report attached to the release (CI artifact, ≥90% core)
- [ ] **D3 multisig rehearsal done on testnet** — this was deliberately skipped
      for the MVP (DECISIONS #5) and is a **hard blocker** here: 2-of-3 hardware
      multisig created, master weight 0, one param change executed via
      `stellar tx sign` multi-sig flow, documented in `docs/MULTISIG.md`
- [ ] D4 alerts live against mainnet endpoints (monitor + Healthchecks silence
      alarm + Discord webhook tested with a forced drill)
- [ ] Caps per policy: per-asset cap = **min($500K, 10% of the asset's Stellar
      float, 25% of documented weekly redemption capacity)** — numbers written
      into the release notes with their sources
- [ ] Mainnet Reflector feed IDs recorded in `INTEGRATIONS/reflector.md` (X1),
      dated and cited; adapter `max_age` calibrated to feed cadence ×2.5
- [ ] Mainnet RPC provider chosen and recorded in DECISIONS (never hardcoded)
- [ ] Legal/counsel review of ld-share receipt characterization (studio-funded)

## 1 · Ceremony order (one sitting, two operators)

1. **Ephemeral deployer**: generate in-ceremony, fund exactly (fee budget +
   reserves), never written to disk outside the ceremony machine.
2. Deploy via the tagged release artifacts:
   `stellar contract deploy --wasm <release wasm>` per contract.
3. **Verify wasm**: `stellar contract fetch --id <CID> | sha256sum` must equal
   the release's `WASM_HASHES.txt` entry. Any mismatch → abort.
4. `transfer_admin` (two-step) every contract to the **multisig**; multisig
   `accept_admin`. Verify `admin()` on-chain before proceeding.
5. Configure feeds (mainnet Reflector IDs), `set_bounds` per calibration.
6. `set_cap` per the caps policy. Confirm caps on-chain.
7. **Pause drill with dust**: deposit a dust amount, `pause`, verify deposits
   blocked and **withdraw still succeeds**, `unpause`.
8. Update `deployments/mainnet.json` + `just docs` (ADDRESSES.md) + commit.
9. Zero the ephemeral deployer (merge/close account after handover).

## 2 · Announce checklist

- [ ] Docs site updated (addresses page + status banner)
- [ ] Status page canaries switched to mainnet endpoints
- [ ] Issuer co-post scheduled (Etherfuse/Ondo channels per GTM)
- [ ] Monitoring thresholds reviewed for mainnet cadence

## 3 · Rollback stance (written now, not improvised)

Contracts are immutable. "Rollback" means, in order:

1. Multisig `pause(vault)` — deposits halt. **Exits never pause**; users can
   always withdraw/repay.
2. Status page + Discord notice ≤ 1 h; issuer notified if asset-related.
3. Post-mortem in `DECISIONS.md` ≤ 72 h with the invariant that failed and the
   test added to prevent recurrence.
4. Re-launch is a new deploy + registry update behind the same preflight gate.

## 4 · Dress rehearsal record

| Item | Value |
|---|---|
| Rehearsal date / duration | _fill on testnet dress run_ |
| Operators | _two of: Monalika · Aditya · Vyom_ |
| Deviations found | _link DECISIONS entries_ |
| Checklist | _commit the filled copy of this file under `docs/rehearsals/`_ |
