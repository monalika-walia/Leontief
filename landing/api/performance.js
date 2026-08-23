// Vercel serverless function — reads the Leontief testnet contracts live and
// returns a JSON snapshot for the /performance dashboard. Reads run server-side
// via simulateTransaction (no keys, no client bundle), so the page is a thin
// fetch() poller and the data is genuinely on-chain + real-time.
//
// The vault's NAV now comes from a LIVE Reflector SEP-40 feed on testnet (via the
// reflector-feed shim mapping LEOD -> Reflector USDC, a stable ~$1 par-NAV proxy),
// so share_price / TVL / health update on real market data and never go stale.
// Wallet cost basis is the only non-live field (the chain does not store it); it
// was re-based to each wallet's collateral value at the Reflector cutover, so the
// unrealized-gain column tracks movement from the live-oracle baseline.
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const READ_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const SCALE = 1_000_000_000_000n;

const CONTRACTS = {
  vault: "CB64EHOFGTWH2USSZP3PL2B66XJ4KD6A6C3SFXKPNTEO3NCIZFZWLHUS",
  mini_pool: "CCX7Z6TGAVAKOYMS3QAHD4VZHQB2QCC2XVQ4UWBZFSOX4HHDBB45EQ54",
  oracle_adapter: "CC624XAUEW2MYLGRQ6LMLVJQWF3ER3FQXUW2UQIJ7N2JRIDBZTGBH7NC",
  usdc_sac: "CBZ6PBCQUQPAJKMC75PPUSVUBXZD3SNEZMYWHWHMKMYOT5H25SEDUE6Z",
  leod_sac: "CDE5ZRPD2SJCUZIKEVM546Y25YIER35WYKVWICQFDW3I2ZHL2MLD4AOW",
  mock_oracle: "CBKHRAA4GJPOP537MNZ5EVYPW5PSKV3S2R6MQPXP7MTWOJFXQMXXHSYG",
};

// Tracked wallets. basis = collateral value at the Reflector cutover (7-dec USD),
// so the unrealized column reads ~0 at switchover and then moves with the live NAV.
const WALLETS = [
  { address: "GCCDH7TXDEXCQZOCP7WTNV2MHSQOUSU736J6IRGZ5MPLJCNISGNMVYZD", basis: 160072275700 },
  { address: "GA4PG5M3WIIYYXKOQFTAZ6IINT7TKSNHHAD62AL32F4S3Q4IRBCL5XMB", basis: 135060982618 },
  { address: "GCD5FOZUGNHEG7WHBMZTKD6FFG3LB5A3O3UVN7LLN5S5AV5OZVX6YPUB", basis: 130058724007 },
  { address: "GB7XND6M7PLZEO5JSKXYFUOTA4TW6DIKJYFV42VRETWTZHFAI3JOKLKZ", basis: 45020327550 },
  { address: "GAD2PST6IJVTWPRFQGP6X6YIQ53AHLS57MSIU6L5DQK74O2RH6AX7WHW", basis: 440176984727 },
  { address: "GB2TFIEJ2P2Y4SL5YYCT4KARGTSLWAOBKPNT4ULMZDEKAZXWO4U7JHA4", basis: 156049118470 },
  { address: "GC2RH4AYGCWXHDWC7PBCUMUBWWRZIXJYWQ4EMGJKC27K77BRDZV45EJL", basis: 65008011671 },
  { address: "GCY7AVYALU5UWEPHE7SSGBIYTBOUZYWGU7UV5T34NI3UZCZ4AQSFPRQ6", basis: 61006204780 },
  { address: "GAGTIVKVCMN2ATYEURXUXSTXEXDIHIPUL6FYD7BPEL5FU2GYD5NT2YH6", basis: 132038277116 },
  { address: "GBP7XPL4IOEWXGQTJ5RK7TS6DFVWGBDX25QZ5FHVIA7WKZ42OOJFT52U", basis: 42990956989 },
  { address: "GDSQD53O2TW4MIZEL6FT4VHHT2K54B63INYEVNZTRRNPDL6HEAV5UAQJ", basis: 41490279405 },
  { address: "GBAIIXCBBZ4JJBBBXMNGLCK4GOW3C7JH65FYMFDZOL34EWWJLKI3SK7D", basis: 57004397887 },
  { address: "GDJBH32QJRPHOH2HEODNYJVQ5DWRHOZ343B7RAQD6A3DVFXJKZMTL6JY", basis: 310118683821 },
  { address: "GBOBRO7QHI7KCD52IFKP5KXANKQQBJ6JACTT7TRW2TLA4AO4QKTDGXN2", basis: 53002590994 },
  { address: "GAAPCY442ETTFLX3ALWOSBA5OA6JCD77V23URI4D3ZF5IRGD5DXVLXHO", basis: 117031501270 },
  { address: "GAOT2JY3NKDTMVO4AX2JBRBTFPLBAO5RKJEKK2WQMSKERV5KLDHP4NTU", basis: 50001235826 },
  { address: "GAUPAM7G7JH4JRSSJTMCCPBADTVH4SRY55GQD4G4QPBYXQGFI54PISP7", basis: 48000332379 },
  { address: "GCDI2BZAQ2F54NNMXNIE3YZ3KKLIRZ5R4UM7UM6EVMYIJN2R57BSRU5Y", basis: 103025177148 },
  { address: "GCUAWP6QY22OZIZEIOKXBSBMR6PIFTEDQ57Y2GA7NVH745NL7FQG4UNG", basis: 45999428933 },
  { address: "GDUSUNQNVNATBBD3BAJ33N4ELMJW7ORIH6C63IDUWC3NVHC3T7OOQGVD", basis: 43998525487 },
  { address: "GD26YDOOSFNUVACN4NCPVGTL2NAKN2O7GKMADSUY36BZREMTJBG3F3PX", basis: 240087063207 },
  { address: "GBCFWTZ7QPTGEZE2ZXCF2VGCP5TWXHGMNUGL3JLK64YRXJ5BGF5IEZAM", basis: 41997622041 },
  { address: "GARMQKIYPQFB7GNDOZOV7EEYZDKPXCYF6PDG7LYGP4B5MC33GTGFPPVG", basis: 40496944456 },
  { address: "GBKXMUCNPOOW5T2PSWJGLRQ2WJ7ZDA3EWXIWMZFFNRMJDIB2XE4EE6WH", basis: 94021111639 },
  { address: "GD5LNFR4EEPX6EEXEUB4TDQ4MYIMTETBGHMLNURCTUFZSSAD2LJGKOBX", basis: 49000784103 },
  { address: "GASYFVBKA5LCBYRNMA7IBOP5UQDZCXQEMQZ2623XIGLPH6IRU5LPPMQO", basis: 47500106518 },
  { address: "GCM5Z6Q3CV3LHTDIR3JTKPULDXLJKCAGEDYOP2HAHA6V7IQ35XTH7JS2", basis: 45999428933 },
  { address: "GB3DNVIZRWERPCLQIZ6YKNE3NWX7BPXA2WI2M54VKQHXU7JLG5GRLF2J", basis: 81015239240 },
  { address: "GBFEL3YFYG7OQUX33E4DTABI66UK3VYYTWHLKY42NAWXUSJBIIYE2CFK", basis: 44498751349 },
  { address: "GBDKVSM52F7SCBXKEQFE4YOJGFFME5LPUGPJLRBGLGUSIHBITVQIP7XH", basis: 42998073764 },
  { address: "GD4AW5JJOEFP462335QINRJHO3FWLF4VDXOJCDCCWYWGBEB4MWIQNRFC", basis: 195064913425 },
  { address: "GB6RYJOJYNGFCLJKDNJNZ7OJMI2KRGJXIVITKQFHSAMX2JCRPQOQYTI7", basis: 41497396180 },
  { address: "GCG5WB2OXVS5UCNQZJCMTFN4OT7O7ABXF5A2TSJX2XTRKZS5YHAFO2QC", basis: 39996718596 },
  { address: "GD6G2Z2PDI2DA4W2D2F7CTIJOP2YMXCMLECTDNZSRNDLVZ3DWA27U2J3", basis: 76012980625 },
  { address: "GBFTZTSRRVIS6KTAWXUBWY4T7KWDUCREFD54ZQCHRFGT74BLJT2KWM2G", basis: 38996266872 },
  { address: "GCDD6CWKOYZCAOTMAFX25F4LPOSDUFWQVPJI6B6GNHQSVKVHSQLYOZ3B", basis: 37995815148 },
  { address: "GDWME2GND6DQD6U22HCON2LIIQ2YVSRAD7QV5WHY562I7QKMZZQBWGRG", basis: 36995363426 },
  { address: "GAVOZP6O5JEQMZJBX6HJKO2WKYQPE7LMJEWNSPEEZW3DIM3DKLAXGQBZ", basis: 35993089460 },
  { address: "GCA6OR4KYZRLVILHFKUR2EVNULHWO5FFUAYIPDTPWOV5W7LMU2DGX7KV", basis: 69007996320 },
  { address: "GAKN27ENQAAWFEFKGH7DMFJTHL7OOJQJRTEXSVUODCCAL7NNP2YLS5JW", basis: 34994459980 },
  { address: "GD37QLNGNUW5FD3ZHBTTHWF547OTNU5AC5NFZFS5LWFUQ5FBRMKUFNGR", basis: 33994008257 },
  { address: "GC5LDVWSJLDQGGYG25ZLAKY7LSN5QNNFZQ4PJA5CHFT3WFB7JIM7TRV5", basis: 32993556533 },
  { address: "GB2OCRNSLJSRYRKHPVTHVSEGMIQVJWAQ26AHQBY7FBAUEGORU4OIJLRW", basis: 31993104811 },
  { address: "GDO2453NFROCZQ775EVJVXWM7PBRHEZ3GVB3WBJZGYLOH5FHSNAVIPEK", basis: 31492878950 },
  { address: "GCPQBMEJNMO3RSRYGRJTHOYI5MVX3PSSIP5WAUW7PK2PZ3H5XVQUFYHO", basis: 400102404691 },
  { address: "GAOCDY3KWGINWVJH5DAFGUFMPK7VU6PRTW4NJYQ5Z4EPOAMAC5XVKTVB", basis: 180003025619 },
  { address: "GDW4JYIQQDG6OBSK3WBKLR6GJ5AFW7CJAL64OX5WIPRH2F7DXFYV4UDC", basis: 134982698082 },
  { address: "GB7DYIOAOGR6T2DSV2KWMXCQDHO6TQGMTXWBAYIF4AFUYRO7HCJLJHQ3", basis: 110051441143 },
  { address: "GB6DQCWOGW4TFZJX4BHYQN34WAIV3XU2XSTB2TVFCIHW4KJ6RM7NACMU", basis: 156992635989 },
];

const HF_MAX = 9_000_000_000_000_000n; // above this = debt-free / infinity

async function read(server, cid, method, ...scvals) {
  const tx = new TransactionBuilder(new Account(READ_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(cid).call(method, ...scvals))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) {
    throw new Error(method + " read failed");
  }
  return scValToNative(sim.result.retval);
}

export default async function handler(_req, res) {
  try {
    const server = new rpc.Server(RPC);
    const addr = (a) => new Address(a).toScVal();

    const leod = nativeToScVal("LEOD", { type: "symbol" });
    const [sp, ts, tav, nav] = await Promise.all([
      read(server, CONTRACTS.vault, "share_price"),
      read(server, CONTRACTS.vault, "total_shares"),
      read(server, CONTRACTS.vault, "total_assets_value"),
      read(server, CONTRACTS.oracle_adapter, "get_nav", leod), // live Reflector NAV
    ]);
    const sharePrice = BigInt(sp);

    const users = await Promise.all(
      WALLETS.map(async (w) => {
        const [pos, hf] = await Promise.all([
          read(server, CONTRACTS.mini_pool, "position", addr(w.address)),
          read(server, CONTRACTS.mini_pool, "health_factor", addr(w.address)),
        ]);
        const cs = BigInt(pos.collateral_shares);
        const debt = BigInt(pos.debt);
        const cv = (cs * sharePrice) / SCALE;
        const hfBig = BigInt(hf);
        return {
          address: w.address,
          basis: w.basis,
          collateral_shares: Number(cs),
          debt: Number(debt),
          hf: hfBig > HF_MAX ? null : Number(hfBig),
          collateral_value: Number(cv),
          pnl: Number(cv) - w.basis,
        };
      }),
    );

    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=20");
    res.status(200).json({
      live: true,
      network: "testnet",
      asof: new Date().toISOString(),
      oracle: "reflector", // live SEP-40 feed (via reflector-feed shim → Reflector USDC)
      explorer: "https://stellar.expert/explorer/testnet",
      contracts: CONTRACTS,
      nav: Number(BigInt(nav.nav)), // live NAV, SCALE-scaled
      nav_ts: Number(BigInt(nav.ts)),
      share_price: Number(sharePrice),
      total_shares: Number(BigInt(ts)),
      total_assets_value: Number(BigInt(tav)),
      users,
    });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
}
