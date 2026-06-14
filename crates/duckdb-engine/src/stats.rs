//! Statistical hypothesis tests for `xf.stat.test` (Wave 7).
//!
//! Pure-Rust, ZERO new dependencies: the distribution tail probabilities
//! (Student's t, Fisher's F, chi-square) are computed from the regularized
//! incomplete beta and gamma functions, which are in turn built on a Lanczos
//! `ln_gamma` approximation and the Numerical-Recipes continued-fraction /
//! series expansions. All three tests reduce a sample (or contingency table)
//! to a (statistic, p-value) pair and are verified against SciPy reference
//! values in the unit tests below.

/// Lanczos approximation (g=7, n=9) of ln(Gamma(x)). Accurate to ~15 digits
/// for x > 0; uses the reflection formula for x < 0.5.
pub(crate) fn ln_gamma(x: f64) -> f64 {
    const G: f64 = 7.0;
    const C: [f64; 9] = [
        0.999_999_999_999_809_93,
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_13,
        -176.615_029_162_140_59,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_571_6e-6,
        1.505_632_735_149_311_6e-7,
    ];
    if x < 0.5 {
        // Reflection: Gamma(x)Gamma(1-x) = pi / sin(pi x)
        let pi = std::f64::consts::PI;
        (pi / (pi * x).sin()).ln() - ln_gamma(1.0 - x)
    } else {
        let x = x - 1.0;
        let mut a = C[0];
        let t = x + G + 0.5;
        for (i, &c) in C.iter().enumerate().skip(1) {
            a += c / (x + i as f64);
        }
        0.5 * (2.0 * std::f64::consts::PI).ln() + (x + 0.5) * t.ln() - t + a.ln()
    }
}

/// Continued fraction for the incomplete beta function (Lentz's method),
/// as used by `betai`.
fn betacf(a: f64, b: f64, x: f64) -> f64 {
    const MAXIT: usize = 200;
    const EPS: f64 = 3.0e-12;
    const FPMIN: f64 = 1.0e-300;
    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < FPMIN {
        d = FPMIN;
    }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..=MAXIT {
        let m = m as f64;
        let m2 = 2.0 * m;
        // even step
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        h *= d * c;
        // odd step
        let aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < EPS {
            break;
        }
    }
    h
}

/// Regularized incomplete beta function I_x(a, b), in [0, 1].
pub(crate) fn betai(a: f64, b: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let bt =
        (ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b) + a * x.ln() + b * (1.0 - x).ln()).exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        bt * betacf(a, b, x) / a
    } else {
        1.0 - bt * betacf(b, a, 1.0 - x) / b
    }
}

/// Series expansion of the lower regularized incomplete gamma P(a, x).
fn gser(a: f64, x: f64) -> f64 {
    const MAXIT: usize = 300;
    const EPS: f64 = 3.0e-12;
    if x <= 0.0 {
        return 0.0;
    }
    let gln = ln_gamma(a);
    let mut ap = a;
    let mut sum = 1.0 / a;
    let mut del = sum;
    for _ in 0..MAXIT {
        ap += 1.0;
        del *= x / ap;
        sum += del;
        if del.abs() < sum.abs() * EPS {
            break;
        }
    }
    sum * (-x + a * x.ln() - gln).exp()
}

/// Continued fraction for the upper regularized incomplete gamma Q(a, x).
fn gcf(a: f64, x: f64) -> f64 {
    const MAXIT: usize = 300;
    const EPS: f64 = 3.0e-12;
    const FPMIN: f64 = 1.0e-300;
    let gln = ln_gamma(a);
    let mut b = x + 1.0 - a;
    let mut c = 1.0 / FPMIN;
    let mut d = 1.0 / b;
    let mut h = d;
    for i in 1..=MAXIT {
        let an = -(i as f64) * (i as f64 - a);
        b += 2.0;
        d = an * d + b;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = b + an / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < EPS {
            break;
        }
    }
    (-x + a * x.ln() - gln).exp() * h
}

/// Upper regularized incomplete gamma Q(a, x) = 1 - P(a, x).
pub(crate) fn gammq(a: f64, x: f64) -> f64 {
    if x < 0.0 || a <= 0.0 {
        return f64::NAN;
    }
    if x < a + 1.0 {
        1.0 - gser(a, x)
    } else {
        gcf(a, x)
    }
}

/// Two-sided survival probability for Student's t: P(|T| >= |t|) with df.
pub(crate) fn student_t_two_sided(t: f64, df: f64) -> f64 {
    if df <= 0.0 {
        return f64::NAN;
    }
    // One tail = 0.5 * I_{df/(df+t^2)}(df/2, 1/2); two-sided doubles it.
    let x = df / (df + t * t);
    betai(0.5 * df, 0.5, x)
}

/// Upper-tail probability for the F distribution: P(F >= f) with df1, df2.
pub(crate) fn f_sf(f: f64, df1: f64, df2: f64) -> f64 {
    if f <= 0.0 {
        return 1.0;
    }
    let x = df2 / (df2 + df1 * f);
    betai(0.5 * df2, 0.5 * df1, x)
}

/// Upper-tail probability for chi-square: P(X >= x) with k degrees of freedom.
pub(crate) fn chi2_sf(x: f64, k: f64) -> f64 {
    if x <= 0.0 {
        return 1.0;
    }
    gammq(0.5 * k, 0.5 * x)
}

/// Sample mean and unbiased (ddof=1) variance.
fn mean_var(v: &[f64]) -> (f64, f64) {
    let n = v.len() as f64;
    let mean = v.iter().sum::<f64>() / n;
    let var = if v.len() > 1 {
        v.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0)
    } else {
        0.0
    };
    (mean, var)
}

/// Independent two-sample Student's t-test (equal-variance, pooled), two-sided.
/// Returns (t, df, p). Matches scipy.stats.ttest_ind(equal_var=True).
pub(crate) fn ttest_ind(a: &[f64], b: &[f64]) -> Option<(f64, f64, f64)> {
    if a.len() < 2 || b.len() < 2 {
        return None;
    }
    let (m1, v1) = mean_var(a);
    let (m2, v2) = mean_var(b);
    let n1 = a.len() as f64;
    let n2 = b.len() as f64;
    let df = n1 + n2 - 2.0;
    let sp2 = ((n1 - 1.0) * v1 + (n2 - 1.0) * v2) / df;
    let denom = (sp2 * (1.0 / n1 + 1.0 / n2)).sqrt();
    if denom == 0.0 {
        return None;
    }
    let t = (m1 - m2) / denom;
    let p = student_t_two_sided(t.abs(), df);
    Some((t, df, p))
}

/// One-way ANOVA across k groups. Returns (F, df_between, df_within, p).
/// Matches scipy.stats.f_oneway.
pub(crate) fn anova_oneway(groups: &[Vec<f64>]) -> Option<(f64, f64, f64, f64)> {
    let k = groups.len();
    if k < 2 {
        return None;
    }
    let total_n: usize = groups.iter().map(|g| g.len()).sum();
    if total_n <= k {
        return None;
    }
    let grand_mean =
        groups.iter().flat_map(|g| g.iter()).sum::<f64>() / total_n as f64;
    let mut ss_between = 0.0;
    let mut ss_within = 0.0;
    for g in groups {
        if g.is_empty() {
            return None;
        }
        let gm = g.iter().sum::<f64>() / g.len() as f64;
        ss_between += g.len() as f64 * (gm - grand_mean).powi(2);
        ss_within += g.iter().map(|x| (x - gm).powi(2)).sum::<f64>();
    }
    let df_b = (k - 1) as f64;
    let df_w = (total_n - k) as f64;
    if ss_within == 0.0 {
        return None;
    }
    let f = (ss_between / df_b) / (ss_within / df_w);
    let p = f_sf(f, df_b, df_w);
    Some((f, df_b, df_w, p))
}

/// Pearson chi-square test of independence on an R x C contingency table.
/// Returns (chi2, df, p). Matches scipy.stats.chi2_contingency(correction=False).
pub(crate) fn chi2_independence(table: &[Vec<f64>]) -> Option<(f64, f64, f64)> {
    let r = table.len();
    if r < 2 {
        return None;
    }
    let c = table[0].len();
    if c < 2 || table.iter().any(|row| row.len() != c) {
        return None;
    }
    let row_sums: Vec<f64> = table.iter().map(|row| row.iter().sum()).collect();
    let mut col_sums = vec![0.0; c];
    for row in table {
        for (j, &v) in row.iter().enumerate() {
            col_sums[j] += v;
        }
    }
    let total: f64 = row_sums.iter().sum();
    if total == 0.0 {
        return None;
    }
    let mut chi2 = 0.0;
    for (i, row) in table.iter().enumerate() {
        for (j, &obs) in row.iter().enumerate() {
            let exp = row_sums[i] * col_sums[j] / total;
            if exp > 0.0 {
                chi2 += (obs - exp).powi(2) / exp;
            }
        }
    }
    let df = ((r - 1) * (c - 1)) as f64;
    let p = chi2_sf(chi2, df);
    Some((chi2, df, p))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol * (1.0 + b.abs())
    }

    #[test]
    fn ln_gamma_matches_known_values() {
        // ln_gamma(5) = ln(24) = 3.1780538..., ln_gamma(0.5) = ln(sqrt(pi))
        assert!(close(ln_gamma(5.0), 24.0_f64.ln(), 1e-10));
        assert!(close(
            ln_gamma(0.5),
            std::f64::consts::PI.sqrt().ln(),
            1e-10
        ));
        assert!(close(ln_gamma(10.0), 362880.0_f64.ln(), 1e-10));
    }

    #[test]
    fn ttest_ind_matches_scipy() {
        // ttest_ind([1,2,3,4,5],[2,4,6,8,10], equal_var=True): pooled sp2=6.25,
        // denom=sqrt(2.5)=1.5811, t=-3/1.5811=-1.8973665961. Two-sided p
        // (df=8) = 0.09434977284189738 (independent numerical-integration ref).
        let a = [1.0, 2.0, 3.0, 4.0, 5.0];
        let b = [2.0, 4.0, 6.0, 8.0, 10.0];
        let (t, df, p) = ttest_ind(&a, &b).unwrap();
        assert!(close(t, -1.8973665961010275, 1e-9), "t={}", t);
        assert_eq!(df, 8.0);
        assert!(close(p, 0.09434977284189738, 1e-7), "p={}", p);
    }

    #[test]
    fn anova_matches_scipy() {
        // scipy.stats.f_oneway([1,2,3],[4,5,6],[7,8,9])
        // -> F = 27.0, p = 0.0010000000000000009
        let g = vec![
            vec![1.0, 2.0, 3.0],
            vec![4.0, 5.0, 6.0],
            vec![7.0, 8.0, 9.0],
        ];
        let (f, df_b, df_w, p) = anova_oneway(&g).unwrap();
        assert!(close(f, 27.0, 1e-9), "F={}", f);
        assert_eq!(df_b, 2.0);
        assert_eq!(df_w, 6.0);
        assert!(close(p, 0.001, 1e-6), "p={}", p);
    }

    #[test]
    fn chi2_independence_matches_scipy() {
        // scipy.stats.chi2_contingency([[10,20],[20,40]], correction=False)
        // perfectly independent -> chi2 = 0.0, p = 1.0
        let t = vec![vec![10.0, 20.0], vec![20.0, 40.0]];
        let (chi2, df, p) = chi2_independence(&t).unwrap();
        assert!(close(chi2, 0.0, 1e-9), "chi2={}", chi2);
        assert_eq!(df, 1.0);
        assert!(close(p, 1.0, 1e-9), "p={}", p);

        // chi2_contingency([[10,10],[5,20]], correction=False): expected cells
        // 6.667/13.333/8.333/16.667 -> chi2 = 4.5, df=1, p = 0.033894853524689
        // (p from stdlib math.erfc(sqrt(4.5/2)), independent of betai/gammq).
        let t2 = vec![vec![10.0, 10.0], vec![5.0, 20.0]];
        let (chi2b, dfb, pb) = chi2_independence(&t2).unwrap();
        assert!(close(chi2b, 4.5, 1e-9), "chi2={}", chi2b);
        assert_eq!(dfb, 1.0);
        assert!(close(pb, 0.033894853524689274, 1e-7), "p={}", pb);
    }
}
