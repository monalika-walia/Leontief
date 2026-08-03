// One cycle of the engine, per user:
//
//   read state → strategy proposes → PRE-FLIGHT SIMULATE the post-action health
//   factor → checkPolicy → execute → log → notify
//
// The order matters. The policy check consumes a simulated post-action HF, not
// an estimate, so the 1.6 floor is asserted against what the chain says would
// happen — and any read that fails means we refuse rather than guess
// (fail-closed, matching the oracle policy in spec §5).
import type { LeontiefClient, Signer } from "@leontief/sdk";
import type { Config } from "./config.js";
import { activeGrants, type GrantRow, logAction, spendState } from "./db.js";
import { checkPolicy, type ProposedAction } from "./policy.js";
import { DEFAULT_STRATEGY_CONFIG, propose, type UserState } from "./strategies.js";

export type Notifier = (chatId: number | null, text: string) => Promise<void>;

export type SignerFor = (grant: GrantRow) => Signer | null;

async function readState(client: LeontiefClient, address: string): Promise<UserState | null> {
  try {
    const [idleDebtAsset, idleUnderlying, pos, sharePrice, hfRaw] = await Promise.all([
      client.debtBalance(address),
      client.underlyingBalance(address),
      client.positions(address),
      client.sharePrice(),
      client.healthFactor(address),
    ]);
    const DEBT_FREE = 10n ** 24n; // the contract returns i128::MAX when debt-free
    return {
      idleDebtAsset,
      idleUnderlying,
      collateralShares: pos.collateral_shares,
      debt: pos.debt,
      sharePrice,
      hf: pos.debt > 0n && hfRaw < DEBT_FREE ? hfRaw : null,
    };
  } catch {
    return null; // halted oracle or unreachable RPC — do nothing at all
  }
}

/** Post-action HF from simulation, for the exact action proposed. */
async function simulatePostHf(
  client: LeontiefClient,
  address: string,
  action: ProposedAction,
): Promise<{ ok: true; postHf: bigint | null } | { ok: false }> {
  try {
    if (action.kind === "repay") {
      return { ok: true, postHf: await client.previewHealthFactor(address, 0n, -action.amount) };
    }
    if (action.kind === "supply") {
      return { ok: true, postHf: await client.previewHealthFactor(address, action.amount, 0n) };
    }
    // A wrap moves wallet balance into ld-shares; it does not touch the pool
    // position, so the HF is unchanged.
    return { ok: true, postHf: await client.previewHealthFactor(address, 0n, 0n) };
  } catch {
    return { ok: false };
  }
}

async function execute(
  client: LeontiefClient,
  signer: Signer,
  action: ProposedAction,
): Promise<string> {
  if (action.kind === "repay") return (await client.repay(signer, action.amount)).hash;
  if (action.kind === "supply") return (await client.supplyCollateral(signer, action.amount)).hash;
  return (await client.wrap(signer, action.amount)).hash;
}

export async function runCycle(
  client: LeontiefClient,
  config: Config,
  signerFor: SignerFor,
  notify: Notifier,
): Promise<number> {
  if (!config.enabled) return 0;
  if (config.killed) {
    console.warn("autopilot: kill switch engaged — no actions this cycle");
    return 0;
  }

  const grants = await activeGrants();
  let acted = 0;

  for (const grant of grants) {
    if (acted >= config.MAX_ACTIONS_PER_CYCLE) break;
    if (grant.strategy === "digest-only") continue;

    const state = await readState(client, grant.user);
    if (!state) continue;

    const action = propose(grant.strategy, state, {
      vault: config.VAULT,
      miniPool: config.MINI_POOL,
      ...DEFAULT_STRATEGY_CONFIG,
    });
    if (!action) continue;

    const sim = await simulatePostHf(client, grant.user, action);
    if (!sim.ok) {
      await logAction({
        address: grant.user,
        strategy: grant.strategy,
        action: action.kind,
        amount: action.amount,
        outcome: "refused",
        detail: "pre-flight simulation failed — refusing to act blind",
      });
      continue;
    }

    const { spentToday, secondsSinceLastAction } = await spendState(grant.user);
    const verdict = checkPolicy(action, {
      grant,
      spentToday,
      postHf: sim.postHf,
      now: Math.floor(Date.now() / 1000),
      secondsSinceLastAction,
      cooldownSeconds: config.COOLDOWN_SECS,
      killSwitch: config.killed,
    });
    if (!verdict.allow) {
      await logAction({
        address: grant.user,
        strategy: grant.strategy,
        action: action.kind,
        amount: action.amount,
        preHf: state.hf,
        postHf: sim.postHf,
        outcome: "refused",
        detail: verdict.reason,
      });
      continue;
    }

    const signer = signerFor(grant);
    if (!signer) continue; // capability gone (revoked) — nothing to do

    try {
      const hash = await execute(client, signer, action);
      await logAction({
        address: grant.user,
        strategy: grant.strategy,
        action: action.kind,
        amount: action.amount,
        tx: hash,
        preHf: state.hf,
        postHf: sim.postHf,
        outcome: "executed",
      });
      acted++;
      const hf = (v: bigint | null) => (v === null ? "∞" : (Number(v) / 1e12).toFixed(3));
      await notify(
        grant.chatId,
        [
          `Autopilot (${grant.strategy}) acted for you.`,
          `${action.kind} ${(Number(action.amount) / 1e7).toFixed(4)}`,
          `health factor ${hf(state.hf)} → ${hf(sim.postHf)}`,
          `${config.EXPLORER_BASE}/tx/${hash}`,
          "",
          `Disable any time: ${config.APP_BASE_URL}/autopilot`,
        ].join("\n"),
      );
    } catch (e) {
      // A revoked signer lands here: the transaction is rejected on-chain and we
      // record the loss of capability rather than retrying into a wall.
      await logAction({
        address: grant.user,
        strategy: grant.strategy,
        action: action.kind,
        amount: action.amount,
        preHf: state.hf,
        postHf: sim.postHf,
        outcome: "failed",
        detail: (e as Error).message.slice(0, 400),
      });
    }
  }
  return acted;
}
