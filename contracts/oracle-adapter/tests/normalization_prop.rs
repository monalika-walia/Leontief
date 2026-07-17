//! Property: decimal normalization round-trips within 1 ulp for random
//! (price, decimals ∈ 4..=18) — prompt C2.

use oracle_adapter::normalize_price;
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    #[test]
    fn round_trips_within_one_ulp(
        price in 1_i128..1_000_000_000_000_000_000_000_000_000_000, // up to 10^30
        decimals in 4_u32..=18,
    ) {
        let nav = normalize_price(price, decimals).expect("no overflow in this range");
        prop_assert!(nav >= 0);

        if decimals <= 12 {
            // Scaling up is exact: inverting recovers the price bit-for-bit.
            let back = nav / 10_i128.pow(12 - decimals);
            prop_assert_eq!(back, price);
        } else {
            // Scaling down floors: inverting undershoots by strictly less than
            // one source-precision quantum (1 ulp).
            let ulp = 10_i128.pow(decimals - 12);
            let back = nav.checked_mul(ulp).expect("bounded by construction");
            prop_assert!(back <= price);
            prop_assert!(price - back < ulp);
        }
    }

    #[test]
    fn nonpositive_prices_never_normalize(price in i128::MIN..=0, decimals in 4_u32..=18) {
        prop_assert_eq!(normalize_price(price, decimals), None);
    }
}
