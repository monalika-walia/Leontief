# scripts/record_demo.md — the ≤3-minute SCF demo kit (S2)

One-take recordable by a teammate who didn't write this kit. **Nothing staged or
mocked: every number on screen is a live chain read**, every action a real
testnet transaction with an explorer link visible.

## Setup (once, ~10 min before recording)

1. Fresh stack: `just deploy-testnet` (≈3 min) — new accounts, LEOD issued with
   real SEP-8 flags, all five contracts live, `deploy.env` written.
2. Self-check: `./scripts/demo.sh` must end **“All 5 beats passed on testnet.”**
   If it doesn't, stop and fix before recording.
3. App against the fresh deploy: `just app` → http://localhost:5173 (or use the
   deployed https://leontief-app.vercel.app if it points at the current deploy).
4. Recorder: OBS (screen + mic) or asciinema for the terminal beats. 1080p,
   browser at 100% zoom, dark desktop.

## The cut (target ≤ 3:00)

| t | Scene | Script |
|---|---|---|
| 0:00–0:20 | **Team card** | Names/roles over the landing page: “Monalika — protocol · Aditya — contracts/risk · Vyom — full-stack · incubated by 29Projects Lab. Prior artifact: this prototype, live on testnet today.” |
| 0:20–0:35 | Landing scroll | Dormant→awake transition. One line: “$3B of RWAs on Stellar sit idle. Leontief wakes them up.” |
| 0:35–2:35 | **The five beats** at `/demo` | Click through, reading each caption below. Let each explorer link flash on screen. |
| 2:35–2:55 | `/stats` | “Every number here is a chain read — total wrapped, and the KPI: how much of it is *working*.” |
| 2:55–3:00 | Close | “Leontief — the layer that wakes them up. Docs, code, and the live demo linked below.” |

## Beat captions (verbatim from the integration-test doc-comments)

> The `/demo` stepper shows the same captions; read them aloud as each runs.

1. **Beat 1 —** A restricted bond can't move to a stranger; authorize the vault and the door opens.
2. **Beat 2 —** Wrap the bond: the vault mints a composable ldLEOD share at live NAV.
3. **Beat 3 —** The share moves freely and borrows: transfer ldLEOD, pledge it, draw USDC.
4. **Beat 4 —** Yield while pledged: a NAV tick lifts the share price even for locked collateral.
5. **Beat 5a —** Distress and cure: a whitelisted liquidator repays and seizes shares at a bonus.
6. **Beat 5b —** The gate holds: an un-whitelisted wallet is refused the very same seizure.

## Terminal alternative (asciinema)

`asciinema rec demo.cast -c "./scripts/demo.sh"` — the script prints each beat
with ✓/✗ and is self-checking (nonzero exit on any unexpected outcome). Overlay
the captions above as on-screen notes in the edit.

## Checklist before publishing

- [ ] All 5 beats green in the recording (no cuts hiding a failure)
- [ ] At least one stellar.expert link opened on camera
- [ ] `/stats` shown with live figures
- [ ] Team intro ≤ 20 s; total ≤ 3:00
- [ ] Link the video from `docs-site/src/overview.md` and the SCF submission
