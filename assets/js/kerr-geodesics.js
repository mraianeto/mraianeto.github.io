// Equatorial geodesics of a Kerr black hole, drawn on the about page.
//
// The integration is a JavaScript port of the single-geodesic part of the Wolfram code
// PP_Kerr_vWolfram_Equatorial.wl (integrarGeodesica and the functions it uses); the Penrose
// process itself is not ported. Wolfram names are given in [brackets] next to each function.
//
// Method (as in the Wolfram code): Hamilton's equations for H = ½ g^{μν} p_μ p_ν with the
// inverse Kerr metric in Boyer–Lindquist coordinates (t, r, θ, φ), written in Mino time λ
// (dτ = Σ dλ) and integrated over s ∈ [0, 1] with λ = λ_lim s:
//   dx^μ/ds  =  λ_lim Σ g^{μν} p_ν
//   dp_r/ds  = −λ_lim Σ ½ p_μ p_ν ∂_r g^{μν}
//   dp_θ/ds  = −λ_lim Σ ½ p_μ p_ν ∂_θ g^{μν}
//   dτ/ds    =  λ_lim Σ,   dλ/ds = λ_lim,   p_t = −E and p_φ = L constant.
// Integration stops at r = r₊ + ε M (Boyer–Lindquist coordinates are singular at r₊), at
// r = r_escape, or near the poles. NDSolve (AccuracyGoal = PrecisionGoal = 10,
// MaxStepFraction = 1/500) is replaced by an adaptive Dormand–Prince 5(4) Runge–Kutta
// with the same tolerances and maximum step, plus a smaller step where needed for drawing.
//
// Units G = c = M = 1 in the widget; the hole spins about +z (counter-clockwise on screen).
// θ = π/2 and p_θ = 0 initially, so the orbit stays equatorial; max|θ − π/2| is reported.
(function () {
  const canvas = document.getElementById("kerr-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  const ZOOM_LEVELS = [4, 6, 8, 10, 12, 15, 20, 30, 50];
  const MAX_STEPS = 200000; // safety cap on Runge–Kutta steps per integration
  const EPS_HORIZON = 1e-3; // (r_stop − r₊)/M  [epsilonHorizonte]

  // Default timelike orbit: bound, 5 M ≤ r ≤ 12 M at a = 0.9 (R(5) = R(12) = 0).
  const MINO_LENGTH = 20; // M |λ_lim|, the Mino-time length of an integration [lambdaMaximo]

  // tab: "constants" (E, L or b) or "initial" (position & momentum); direction: +1 forward,
  // −1 backward in Mino time. Angles th0, ph0 are in degrees. The default "initial" data
  // (at rest radially at r = 12 M with p_φ = 3.012) is the same bound orbit as the E, L tab.
  const state = {
    mode: "timelike", tab: "constants", direction: 1, a: 0.9, b: 3.0, E: 0.9442, L: 3.012,
    t0: 0, r0: 12, th0: 90, ph0: 0, pr: 0, pth: 0, pph: 3.012, zoom: 5,
  };

  // ------------------------------------------------------------ physics

  const horizons = (a) => {
    const s = Math.sqrt(1 - a * a);
    return { plus: 1 + s, minus: 1 - s };
  };

  // Circular photon orbit radius (dir = +1 prograde, −1 retrograde), Bardeen et al. 1972.
  const photonOrbit = (a, dir) => 2 * (1 + Math.cos((2 / 3) * Math.acos(-dir * a)));

  // Critical impact parameter of that orbit: b_c = ±3√(r_ph) − a (edge of the capture band).
  const criticalImpact = (a, dir) => dir * 3 * Math.sqrt(photonOrbit(a, dir)) - a;

  // Innermost stable circular orbit, Bardeen, Press & Teukolsky 1972.
  function isco(a, dir) {
    const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
    const z2 = Math.sqrt(3 * a * a + z1 * z1);
    return 3 + z2 - dir * Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  }

  // E and L of a circular equatorial orbit at radius r (BPT 1972, eqs. 2.12–2.13).
  function circularOrbit(a, r, dir) {
    const sr = Math.sqrt(r);
    const den = Math.pow(r, 0.75) * Math.sqrt(r * sr - 3 * sr + 2 * dir * a);
    return {
      E: (r * sr - 2 * sr + dir * a) / den,
      L: (dir * (r * r - 2 * dir * a * sr + a * a)) / den,
    };
  }

  // ---------------------------------------- port of PP_Kerr_vWolfram_Equatorial.wl

  const deltaKerr = (r, M, a) => r * r - 2 * M * r + a * a; //                  [deltaKerr]
  const sigmaKerr = (r, th, a) => r * r + a * a * Math.cos(th) ** 2; //         [sigmaKerr]
  const horizonRadius = (M, a) => M + Math.sqrt(M * M - a * a); //             [raioHorizonte]
  const normalization = (type) => (type === "timelike" ? 1 : 0); //            [normalizacao]

  // Inverse Boyer–Lindquist metric g^{μν}, index order (t, r, θ, φ).           [metricaInversa]
  function inverseMetric(r, th, M, a) {
    const sig = sigmaKerr(r, th, a);
    const del = deltaKerr(r, M, a);
    const s2 = Math.sin(th) ** 2;
    const A = (r * r + a * a) ** 2 - a * a * del * s2;
    const gtp = (-2 * M * a * r) / (sig * del);
    return [
      [-A / (sig * del), 0, 0, gtp],
      [0, del / sig, 0, 0],
      [0, 0, 1 / sig, 0],
      [gtp, 0, 0, (del - a * a * s2) / (sig * del * s2)],
    ];
  }

  // ∂g^{μν}/∂r and ∂g^{μν}/∂θ. The Wolfram code takes them with D[]; here they are written
  // out, using g^{φφ} = 1/(Σ sin²θ) − a²/(ΣΔ).          [derivadaMetricaRadial, derivadaMetricaPolar]
  function inverseMetricDerivatives(r, th, M, a) {
    const sn = Math.sin(th);
    const cs = Math.cos(th);
    const s2 = sn * sn;
    const sig = sigmaKerr(r, th, a);
    const del = deltaKerr(r, M, a);
    const A = (r * r + a * a) ** 2 - a * a * del * s2;
    const SD = sig * del;
    // radial
    const sigR = 2 * r;
    const delR = 2 * r - 2 * M;
    const AR = 4 * r * (r * r + a * a) - a * a * delR * s2;
    const SDR = sigR * del + sig * delR;
    const ttR = -(AR * SD - A * SDR) / (SD * SD);
    const tpR = (-2 * M * a * (SD - r * SDR)) / (SD * SD);
    const rrR = (delR * sig - del * sigR) / (sig * sig);
    const hhR = -sigR / (sig * sig);
    const ppR = -sigR / (sig * sig * s2) + (a * a * SDR) / (SD * SD);
    // polar
    const sigT = -2 * a * a * sn * cs;
    const s2T = 2 * sn * cs;
    const AT = -a * a * del * s2T;
    const SDT = sigT * del;
    const ttT = -(AT * SD - A * SDT) / (SD * SD);
    const tpT = (2 * M * a * r * SDT) / (SD * SD);
    const rrT = (-del * sigT) / (sig * sig);
    const hhT = -sigT / (sig * sig);
    const ppT = -(sigT * s2 + sig * s2T) / ((sig * s2) ** 2) + (a * a * SDT) / (SD * SD);
    const mat = (tt, tp, rr, hh, pp) => [
      [tt, 0, 0, tp],
      [0, rr, 0, 0],
      [0, 0, hh, 0],
      [tp, 0, 0, pp],
    ];
    return { dr: mat(ttR, tpR, rrR, hhR, ppR), dth: mat(ttT, tpT, rrT, hhT, ppT) };
  }

  const raise = (g, p) => g.map((row) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + row[3] * p[3]);
  const contract = (p, g, q) => p.reduce((sum, pi, i) => sum + pi * (g[i][0] * q[0] + g[i][1] * q[1] + g[i][2] * q[2] + g[i][3] * q[3]), 0);

  // Covector p_μ from its spatial components: solves g^{μν}p_μp_ν = −μ² for p_t and keeps the
  // future-directed root (p^t > 0) with the largest p^t; null if there is none.     [criarCovetor]
  function createCovector(type, pr, pth, pph, r, th, M, a) {
    const g = inverseMetric(r, th, M, a);
    const qa = g[0][0];
    const qb = 2 * g[0][3] * pph;
    const qc = g[1][1] * pr * pr + g[2][2] * pth * pth + g[3][3] * pph * pph + normalization(type);
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) return null;
    const roots = disc === 0 ? [-qb / (2 * qa)] : [(-qb + Math.sqrt(disc)) / (2 * qa), (-qb - Math.sqrt(disc)) / (2 * qa)];
    const contravariantT = (pt) => g[0][0] * pt + g[0][3] * pph;
    const future = roots.filter((pt) => contravariantT(pt) > 0);
    if (!future.length) return null;
    const pt = future.reduce((best, x) => (contravariantT(x) > contravariantT(best) ? x : best));
    return [pt, pr, pth, pph];
  }

  // Radial potential R(r).                                                      [potencialRadial]
  const radialPotential = (r, M, a, E, L, Q, mu2) =>
    (E * (r * r + a * a) - a * L) ** 2 - deltaKerr(r, M, a) * (mu2 * r * r + (L - a * E) ** 2 + Q);

  // Energy, angular momentum and Carter constant of a covector, plus checks.    [calcularConstantes]
  function constantsOfMotion(p, type, r, th, M, a) {
    const g = inverseMetric(r, th, M, a);
    const mu2 = normalization(type);
    const E = -p[0];
    const L = p[3];
    const Q = p[2] ** 2 + Math.cos(th) ** 2 * (a * a * (mu2 - E * E) + (L * L) / Math.sin(th) ** 2);
    return { E, L, Q, mu2, norm: -contract(p, g, p), ut: raise(g, p)[0] };
  }

  // Real roots of a polynomial c[0] x^n + ... + c[n] (Durand–Kerner, then Newton polish).
  function realRoots(coeffs) {
    const big = Math.max(...coeffs.map(Math.abs));
    let c = coeffs.slice();
    while (c.length > 1 && Math.abs(c[0]) <= 1e-14 * big) c.shift();
    const n = c.length - 1;
    if (n < 1) return [];
    c = c.map((x) => x / c[0]);
    const bound = 1 + Math.max(...c.slice(1).map(Math.abs));
    let z = Array.from({ length: n }, (_, k) => [bound * Math.cos(0.4 + (2 * Math.PI * k) / n), bound * Math.sin(0.4 + (2 * Math.PI * k) / n)]);
    const mul = (u, v) => [u[0] * v[0] - u[1] * v[1], u[0] * v[1] + u[1] * v[0]];
    const div = (u, v) => {
      const d = v[0] * v[0] + v[1] * v[1] || 1e-300;
      return [(u[0] * v[0] + u[1] * v[1]) / d, (u[1] * v[0] - u[0] * v[1]) / d];
    };
    for (let it = 0; it < 500; it += 1) {
      let moved = 0;
      z = z.map((zi, i) => {
        let pz = [1, 0];
        for (let k = 1; k <= n; k += 1) pz = [pz[0] * zi[0] - pz[1] * zi[1] + c[k], pz[0] * zi[1] + pz[1] * zi[0]];
        let den = [1, 0];
        z.forEach((zj, j) => {
          if (j !== i) den = mul(den, [zi[0] - zj[0], zi[1] - zj[1]]);
        });
        const step = div(pz, den);
        moved = Math.max(moved, Math.hypot(step[0], step[1]));
        return [zi[0] - step[0], zi[1] - step[1]];
      });
      if (moved < 1e-15 * bound) break;
    }
    const poly = (x) => c.reduce((acc, ck) => acc * x + ck, 0);
    const dpoly = (x) => c.slice(0, n).reduce((acc, ck, k) => acc * x + ck * (n - k), 0);
    return z
      .filter((zi) => Math.abs(zi[1]) <= 1e-7 * Math.max(1, Math.abs(zi[0])))
      .map((zi) => {
        let x = zi[0];
        for (let k = 0; k < 3; k += 1) {
          const d = dpoly(x);
          if (d) x -= poly(x) / d;
        }
        return x;
      })
      .sort((u, v) => u - v);
  }

  // Coefficients of R(r) = c0 r⁴ + c1 r³ + c2 r² + c3 r + c4 (expanded potencialRadial).
  const potentialCoefficients = (M, a, E, L, Q, mu2) => [
    E * E - mu2,
    2 * M * mu2,
    a * a * (E * E - mu2) - L * L - Q,
    2 * M * ((L - a * E) ** 2 + Q),
    -a * a * Q,
  ];

  // Is there a turning point R(r) = 0 beyond rInitial? (Then reaching r_escape does not
  // mean escaping to infinity.)                                              [haRetornoExterior]
  function hasOuterReturn(c, M, a, rInitial) {
    return realRoots(potentialCoefficients(M, a, c.E, c.L, c.Q, c.mu2)).some((x) => x > rInitial);
  }

  // Escape radius used to confirm escapes: beyond every turning point.  [raioEscapeVerificacao]
  function escapeRadius(c, M, a, r0) {
    const roots = realRoots(potentialCoefficients(M, a, c.E, c.L, c.Q, c.mu2));
    return Math.min(Math.max(50, 2 * r0, 2 * Math.max(0, ...roots)), 1e7);
  }

  // Dormand–Prince 5(4) tableau (the system is autonomous, so the nodes c_i are not needed).
  const DP_A = [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
  ];
  const DP_B = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
  const DP_E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40]; // b5 − b4
  const RTOL = 1e-10; // PrecisionGoal -> 10
  const ATOL = 1e-10; // AccuracyGoal -> 10
  const MAX_STEP = 1 / 500; // MaxStepFraction -> 1/500 of s ∈ [0, 1]

  // One Dormand–Prince step; returns the 5th-order solution and the scaled error norm.
  function dopriStep(f, y, h) {
    const k = [f(y)];
    for (let st = 1; st < 7; st += 1) {
      const ys = y.map((q, i) => q + h * DP_A[st].reduce((sum, aij, j) => sum + aij * k[j][i], 0));
      k.push(f(ys));
    }
    const next = y.map((q, i) => q + h * DP_B.reduce((sum, bj, j) => sum + bj * k[j][i], 0));
    let err = 0;
    for (let i = 0; i < y.length; i += 1) {
      const e = h * DP_E.reduce((sum, cj, j) => sum + cj * k[j][i], 0);
      err = Math.max(err, Math.abs(e) / (ATOL + RTOL * Math.max(Math.abs(y[i]), Math.abs(next[i]))));
    }
    return { next, err };
  }

  // Finds the step length τ ∈ (0, h] at which event(y) changes sign (regula falsi), like
  // WhenEvent in NDSolve. Returns the state there.
  function locateEvent(f, y, h, event, fy, fNext) {
    let lo = 0;
    let hi = h;
    let fLo = fy;
    let fHi = fNext;
    let at = null;
    for (let it = 0; it < 40 && hi - lo > 1e-14 * h; it += 1) {
      const tau = lo + (hi - lo) * (fLo / (fLo - fHi));
      at = dopriStep(f, y, tau).next;
      const fm = event(at);
      if (Math.abs(fm) < 1e-13) break;
      if (Math.sign(fm) === Math.sign(fLo)) {
        lo = tau;
        fLo = fm;
      } else {
        hi = tau;
        fHi = fm;
      }
    }
    return at || dopriStep(f, y, h).next;
  }

  // Integrates one geodesic from the event (t, r, θ, φ) with initial covector p0.
  // State y = [t, r, θ, φ, p_r, p_θ, τ, λ].                                   [integrarGeodesica]
  function integrateGeodesic(M, a, c, p0, event, minoLimit, rEscape, epsHorizon, maxSpatialStep) {
    const rStop = horizonRadius(M, a) + epsHorizon * M;
    const pt = -c.E;
    const pph = c.L;
    const rhs = (y) => {
      const [, r, th, , pr, pth] = y;
      const p = [pt, pr, pth, pph];
      const g = inverseMetric(r, th, M, a);
      const d = inverseMetricDerivatives(r, th, M, a);
      const k = minoLimit * sigmaKerr(r, th, a);
      const up = raise(g, p);
      return [k * up[0], k * up[1], k * up[2], k * up[3], (-k * contract(p, d.dr, p)) / 2, (-k * contract(p, d.dth, p)) / 2, k, minoLimit];
    };
    // StopIntegration events, as WhenEvent conditions written as functions that change sign.
    const events = [(y) => y[1] - rStop, (y) => rEscape - y[1], (y) => y[2] - 1e-7, (y) => Math.PI - 1e-7 - y[2]];

    let y = [event[0], event[1], event[2], event[3], p0[1], p0[2], 0, 0];
    const samples = [y];
    const periapses = [];
    let s = 0;
    let h = MAX_STEP / 10;
    let stopped = false;
    for (let step = 0; step < MAX_STEPS && s < 1 && !stopped; step += 1) {
      const f0 = rhs(y);
      // Optional extra cap so drawn points are close together in the plane.
      const speed = Math.hypot(f0[1], y[1] * f0[3]) || 1e-300;
      h = Math.min(h, MAX_STEP, 1 - s, maxSpatialStep(y[1]) / speed);
      const { next, err } = dopriStep(rhs, y, h);
      if (err > 1) {
        h *= Math.max(0.2, 0.9 * Math.pow(err, -0.2));
        continue;
      }
      // Periapsis (dr/ds = λ_lim Σ g^{rr} p_r changes from − to +): for the status line only.
      if (minoLimit * y[4] < 0 && minoLimit * next[4] >= 0) {
        periapses.push(locateEvent(rhs, y, h, (q) => minoLimit * q[4], minoLimit * y[4], minoLimit * next[4])[3]);
      }
      const crossed = events.findIndex((ev) => ev(y) > 0 && ev(next) <= 0);
      if (crossed >= 0) {
        const ev = events[crossed];
        y = locateEvent(rhs, y, h, ev, ev(y), ev(next));
        samples.push(y);
        stopped = true;
        break;
      }
      y = next;
      s += h;
      samples.push(y);
      h *= Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2)));
    }

    const rFinal = y[1];
    const state =
      rFinal <= rStop * (1 + 1e-7) ? "Horizonte" : rFinal >= rEscape * (1 - 1e-7) ? "Infinito" : "Fim do intervalo";
    return { samples, state, rFinal, minoFinal: y[7], properTimeFinal: y[6], periapses, rStop };
  }

  // Largest turning point above the horizon for bound (E < μ) orbits, or null.
  function outerTurningPoint(R, rPlus, E) {
    const rHigh = Math.max(50, 4 / Math.max(1 - E * E, 1e-6));
    const n = 6000;
    let prev = rHigh;
    if (R(prev) >= 0) return rHigh;
    for (let k = 1; k <= n; k += 1) {
      const r = rHigh * Math.pow(rPlus / rHigh, k / n);
      if (R(r) >= 0) {
        let lo = r;
        let hi = prev;
        for (let it = 0; it < 80; it += 1) {
          const mid = 0.5 * (lo + hi);
          if (R(mid) >= 0) lo = mid;
          else hi = mid;
        }
        return lo;
      }
      prev = r;
    }
    return null;
  }

  // ---------------------------------------- the widget's geodesic

  // Initial event and covector from the "E, L" tab: photons/particles arriving from the right
  // (start at r = startRadius) or, for bound orbits, starting at rest radially at apoapsis.
  function initialFromConstants(s, startRadius, M, a, type) {
    const E = s.mode === "null" ? 1 : s.E;
    const L = s.mode === "null" ? s.b : s.L;
    const mu2 = normalization(type);
    const rPlus = horizonRadius(M, a);
    const R = (r) => radialPotential(r, M, a, E, L, 0, mu2);
    const th0 = Math.PI / 2;
    const bound = mu2 === 1 && E < 1;
    let r0;
    let pr;
    if (bound) {
      r0 = outerTurningPoint(R, rPlus, E);
      if (r0 === null) return { error: "forbidden" };
      pr = 0;
    } else {
      r0 = startRadius;
      if (R(r0) < 0) return { error: "far" };
      // Ingoing p_r from the mass shell: g^{rr} p_r² = −μ² − (g^{tt}E² − 2g^{tφ}EL + g^{φφ}L²).
      const g = inverseMetric(r0, th0, M, a);
      const rest = mu2 + g[0][0] * E * E - 2 * g[0][3] * E * L + g[3][3] * L * L;
      pr = -Math.sqrt(Math.max(0, -rest / g[1][1]));
    }
    // criarCovetor recovers p_t = −E as the future-directed root; keep the slider's E if the
    // start lies in the ergoregion, where two future-directed roots can exist.
    let p0 = createCovector(type, pr, 0, L, r0, th0, M, a);
    if (!p0 || Math.abs(p0[0] + E) > 1e-8 * Math.max(1, E)) p0 = [-E, pr, 0, L];
    // Start so that the initial velocity points along −x (horizontal, leftwards).
    let phi0 = 0;
    if (!bound) {
      const up = raise(inverseMetric(r0, th0, M, a), p0);
      phi0 = Math.atan2(r0 * up[3], -up[1]);
    }
    return { event: [0, r0, th0, phi0], p0, showStart: bound };
  }

  // Initial event and covector from the "position & momentum" tab: x^μ = (t, r, θ, φ) and the
  // spatial components (p_r, p_θ, p_φ); p_t follows from the mass shell, as in the notebook.
  function initialFromPositionMomentum(s, M, a, type) {
    const th0 = (s.th0 * Math.PI) / 180;
    const ph0 = (s.ph0 * Math.PI) / 180;
    if (s.r0 <= horizonRadius(M, a) + EPS_HORIZON * M) return { error: "inside" };
    const p0 = createCovector(type, s.pr, s.pth, s.pph, s.r0, th0, M, a);
    if (!p0) return { error: "noroot" };
    return { event: [s.t0, s.r0, th0, ph0], p0, showStart: true };
  }

  // Integrates the widget's geodesic forward or backward in Mino time and classifies it like
  // verificarPorIntegracao: Horizonte; Infinito when no turning point lies beyond; else Ligada.
  function geodesic(s, startRadius) {
    const M = 1;
    const a = s.a;
    const type = s.mode === "null" ? "null" : "timelike";
    const mu2 = normalization(type);
    const init = s.tab === "initial" ? initialFromPositionMomentum(s, M, a, type) : initialFromConstants(s, startRadius, M, a, type);
    if (init.error) return { points: [], fate: init.error };
    const { event, p0 } = init;
    const constants = constantsOfMotion(p0, type, event[1], event[2], M, a);
    if (constants.ut <= 0) return { points: [], fate: "forbidden", constants };
    const bound = mu2 === 1 && constants.E < 1;
    const rEsc = escapeRadius(constants, M, a, event[1]);
    const spatialStep = (r) => 0.03 * Math.max(r, 1);
    const direction = s.direction < 0 ? -1 : 1;

    // Mino interval M λ = ±20; as in the Wolfram tracker it is lengthened ×4 (up to 300/M)
    // while an unbound orbit has neither reached the horizon nor escaped.
    let limit = MINO_LENGTH;
    let run = integrateGeodesic(M, a, constants, p0, event, direction * limit, rEsc, EPS_HORIZON, spatialStep);
    while (!bound && run.state === "Fim do intervalo" && limit < 300) {
      limit *= 4;
      run = integrateGeodesic(M, a, constants, p0, event, direction * limit, rEsc, EPS_HORIZON, spatialStep);
    }

    // Diagnostics: mass shell −g^{μν}p_μp_ν = μ², relative to the scale Σ|p_μ p_ν g^{μν}| as in
    // configurarQuebra (near r₊ the individual terms are huge), and equatorial deviation |θ − π/2|.
    let normError = 0;
    let thetaDeviation = 0;
    const points = [];
    let rMin = Infinity;
    let rMax = 0;
    let heading = null;
    let turning = 0;
    run.samples.forEach((q) => {
      const [, r, th, ph, qr, qth] = q;
      const p = [p0[0], qr, qth, p0[3]];
      const g = inverseMetric(r, th, M, a);
      let scale = 0;
      for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) scale += Math.abs(p[i] * p[j] * g[i][j]);
      normError = Math.max(normError, Math.abs(-contract(p, g, p) - mu2) / Math.max(scale, 1e-30));
      thetaDeviation = Math.max(thetaDeviation, Math.abs(th - Math.PI / 2));
      // Projection on the equatorial plane, as linhaXY: (r sinθ cosφ, r sinθ sinφ).
      const x = r * Math.sin(th) * Math.cos(ph);
      const yy = r * Math.sin(th) * Math.sin(ph);
      if (points.length) {
        const [px, py] = points[points.length - 1];
        const hd = Math.atan2(yy - py, x - px);
        if (heading !== null) {
          let dd = hd - heading;
          dd -= 2 * Math.PI * Math.round(dd / (2 * Math.PI));
          turning += dd;
        }
        heading = hd;
      }
      points.push([x, yy]);
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    });

    // Turns spent within 1% of the equatorial photon orbit (only meaningful on the equator).
    const equatorial = thetaDeviation < 1e-6;
    const rPhoton = mu2 === 0 && equatorial ? photonOrbit(a, constants.L >= 0 ? 1 : -1) : null;
    let whirlTurns = 0;
    if (rPhoton !== null) {
      for (let k = 1; k < run.samples.length; k += 1) {
        if (Math.abs(run.samples[k][1] - rPhoton) < 0.01 * rPhoton) whirlTurns += Math.abs(run.samples[k][3] - run.samples[k - 1][3]) / (2 * Math.PI);
      }
    }

    let fate;
    if (run.state === "Horizonte") fate = "captured";
    else if (run.state === "Infinito" && !hasOuterReturn(constants, M, a, run.rFinal)) fate = "escaped";
    else fate = bound ? "bound" : "whirl";

    let advance = null;
    if (equatorial && run.periapses.length >= 2) advance = ((Math.abs(run.periapses[1] - run.periapses[0]) - 2 * Math.PI) * 180) / Math.PI;

    const last = run.samples[run.samples.length - 1];
    return {
      points, fate, bound, rMin, rMax, advance, whirlTurns, rPhoton, constants, normError, thetaDeviation, equatorial,
      deflection: (Math.abs(turning) * 180) / Math.PI, minoLimit: direction * limit, direction, wolframState: run.state,
      rStop: run.rStop, event, p0, tFinal: last[0], showStart: init.showStart,
    };
  }

  // ------------------------------------------------------------ drawing

  function colors() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    return {
      bg: v("--kerr-canvas-bg"),
      grid: v("--kerr-grid"),
      horizon: v("--kerr-horizon"),
      horizonEdge: v("--kerr-horizon-edge"),
      ergo: v("--kerr-ergo"),
      ergoEdge: v("--kerr-ergo-edge"),
      photonPro: v("--kerr-photon-pro"),
      photonRetro: v("--kerr-photon-retro"),
      iscoPro: v("--kerr-isco-pro"),
      iscoRetro: v("--kerr-isco-retro"),
      capture: v("--kerr-capture"),
      captureEdge: v("--kerr-capture-edge"),
      path: v("--kerr-path"),
      text: v("--global-text-color-light"),
    };
  }

  function niceLength(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
    return 10 * p;
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth;
    if (!size) return;
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colors();
    const half = ZOOM_LEVELS[state.zoom];
    const scale = size / 2 / half;
    const cx = size / 2;
    const cy = size / 2;
    const X = (x) => cx + x * scale;
    const Y = (y) => cy - y * scale;
    const circle = (r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(r * scale, 0), 0, 2 * Math.PI);
    };
    const a = state.a;
    const { plus: rPlus, minus: rMinus } = horizons(a);

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, size, size);

    // Grid: circles every `step` M and the x/y axes.
    const gridStep = niceLength(half / 3);
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (let r = gridStep; r < half * 1.5; r += gridStep) {
      circle(r);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(size, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, size);
    ctx.stroke();

    // Capture band for rays arriving from the right: b_c(retro) < b < b_c(pro).
    if (state.mode === "null" && state.tab === "constants") {
      const bPro = criticalImpact(a, 1);
      const bRetro = criticalImpact(a, -1);
      ctx.fillStyle = c.capture;
      ctx.fillRect(X(0), Y(bPro), size - X(0), Y(bRetro) - Y(bPro));
      ctx.strokeStyle = c.captureEdge;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (const b of [bPro, bRetro]) {
        ctx.moveTo(X(0), Y(b));
        ctx.lineTo(size, Y(b));
      }
      ctx.stroke();
    }

    // Ergoregion: r₊ < r < 2M on the equator.
    ctx.setLineDash([]);
    ctx.fillStyle = c.ergo;
    ctx.beginPath();
    ctx.arc(cx, cy, 2 * scale, 0, 2 * Math.PI);
    ctx.arc(cx, cy, rPlus * scale, 0, 2 * Math.PI, true);
    ctx.fill();
    ctx.strokeStyle = c.ergoEdge;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    circle(2);
    ctx.stroke();

    // Photon orbits (short dashes) and ISCOs (long dashes), one colour each for
    // prograde and retrograde; the prograde circle is always the inner one.
    ctx.lineWidth = 1.5;
    for (const [radius, color, dash] of [
      [photonOrbit(a, 1), c.photonPro, [5, 4]],
      [photonOrbit(a, -1), c.photonRetro, [5, 4]],
      [isco(a, 1), c.iscoPro, [10, 5]],
      [isco(a, -1), c.iscoRetro, [10, 5]],
    ]) {
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      circle(radius);
      ctx.stroke();
    }

    // Event horizon r₊ (and the inner horizon r₋ inside it).
    ctx.setLineDash([]);
    ctx.fillStyle = c.horizon;
    circle(rPlus);
    ctx.fill();
    ctx.strokeStyle = c.horizonEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (rMinus > 0.02) {
      ctx.setLineDash([2, 2]);
      circle(rMinus);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Geodesic.
    const result = geodesic(state, Math.max(60, 3 * half));
    const pathColor = c.path;
    if (result.points.length > 1) {
      ctx.strokeStyle = pathColor;
      ctx.lineWidth = 2.25;
      ctx.lineJoin = "round";
      ctx.beginPath();
      result.points.forEach(([x, y], k) => (k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.stroke();
      // Arrows point along the future direction of motion, also for backward integrations.
      drawArrow(result.direction < 0 ? result.points.slice().reverse() : result.points, X, Y, half, pathColor);
    }
    // Initial event x^μ(0), projected on the equatorial plane.
    if (result.showStart && result.event) {
      const [, r0, th0, ph0] = result.event;
      ctx.fillStyle = pathColor;
      ctx.strokeStyle = c.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(r0 * Math.sin(th0) * Math.cos(ph0)), Y(r0 * Math.sin(th0) * Math.sin(ph0)), 4.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }

    drawSpinIndicator(c, a);
    drawScaleBar(c, scale, size, niceLength(half / 4));
    updateStatus(result);
  }

  // Small arrowhead on the path, where it is well inside the view.
  function drawArrow(points, X, Y, half, color) {
    let k = points.findIndex(([x, y]) => Math.abs(x) < 0.8 * half && Math.abs(y) < 0.8 * half);
    if (k < 0) return;
    let travelled = 0;
    while (k + 1 < points.length && travelled < 0.15 * half) {
      travelled += Math.hypot(points[k + 1][0] - points[k][0], points[k + 1][1] - points[k][1]);
      k += 1;
    }
    if (k + 1 >= points.length) return;
    const [x1, y1] = points[k];
    const [x2, y2] = points[Math.min(k + 3, points.length - 1)];
    const ang = Math.atan2(Y(y2) - Y(y1), X(x2) - X(x1));
    const px = X(x1);
    const py = Y(y1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px + 8 * Math.cos(ang), py + 8 * Math.sin(ang));
    ctx.lineTo(px + 8 * Math.cos(ang + 2.5), py + 8 * Math.sin(ang + 2.5));
    ctx.lineTo(px + 8 * Math.cos(ang - 2.5), py + 8 * Math.sin(ang - 2.5));
    ctx.closePath();
    ctx.fill();
  }

  // Counter-clockwise arrow in the corner: sense of rotation of the hole.
  function drawSpinIndicator(c, a) {
    const x = 22;
    const y = 22;
    const rad = 9;
    ctx.strokeStyle = c.text;
    ctx.fillStyle = c.text;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.font = "12px Roboto, sans-serif";
    ctx.textBaseline = "middle";
    if (a === 0) {
      ctx.fillText("a = 0", x - rad, y);
      return;
    }
    // Canvas angles grow clockwise on screen, so moving counter-clockwise means decreasing
    // angle: the arc runs from 2.1π down to 0.35π and the arrowhead sits at 0.35π.
    const end = 0.35 * Math.PI;
    ctx.beginPath();
    ctx.arc(x, y, rad, end + 0.1 * Math.PI, 2.1 * Math.PI);
    ctx.stroke();
    const tx = Math.sin(end);
    const ty = -Math.cos(end);
    const ex = x + rad * Math.cos(end);
    const ey = y + rad * Math.sin(end);
    ctx.beginPath();
    ctx.moveTo(ex + 4 * tx, ey + 4 * ty);
    ctx.lineTo(ex - 3 * tx - 4 * ty, ey - 3 * ty + 4 * tx);
    ctx.lineTo(ex - 3 * tx + 4 * ty, ey - 3 * ty - 4 * tx);
    ctx.closePath();
    ctx.fill();
    ctx.fillText("spin", x + rad + 6, y);
  }

  function drawScaleBar(c, scale, size, length) {
    const x0 = 14;
    const y0 = size - 16;
    ctx.strokeStyle = c.text;
    ctx.fillStyle = c.text;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 4);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + length * scale, y0);
    ctx.lineTo(x0 + length * scale, y0 - 4);
    ctx.stroke();
    ctx.font = "12px Roboto, sans-serif";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${length} M`, x0 + 4, y0 - 4);
  }

  // ------------------------------------------------------------ UI

  const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "–");

  function updateTable() {
    const a = state.a;
    const h = horizons(a);
    $("kerr-rplus").textContent = fmt(h.plus);
    $("kerr-rminus").textContent = fmt(h.minus);
    $("kerr-rph-pro").textContent = fmt(photonOrbit(a, 1));
    $("kerr-rph-retro").textContent = fmt(photonOrbit(a, -1));
    $("kerr-isco-pro").textContent = fmt(isco(a, 1));
    $("kerr-isco-retro").textContent = fmt(isco(a, -1));
    $("kerr-bc-pro").textContent = fmt(criticalImpact(a, 1));
    $("kerr-bc-retro").textContent = fmt(criticalImpact(a, -1));
  }

  function updateStatus(result) {
    const who = state.mode === "null" ? "photon" : "particle";
    const Who = who[0].toUpperCase() + who.slice(1);
    const back = result.direction < 0;
    const lead = back ? `Traced back in Mino time, the ${who}` : `The ${who}`;
    let msg;
    switch (result.fate) {
      case "captured":
        msg = back
          ? `${lead} reaches r₊ + 10⁻³ M: it came out of the region next to the horizon.`
          : `${Who} is captured: it reaches r₊ + 10⁻³ M, where the integration stops.`;
        break;
      case "escaped":
        if (back) msg = `${lead} goes out beyond every turning point: it came in from infinity (closest approach r = ${fmt(result.rMin, 2)} M).`;
        else if (state.tab === "constants") msg = `${Who} is scattered: deflection ${fmt(result.deflection, 1)}°, closest approach r = ${fmt(result.rMin, 2)} M.`;
        else msg = `${Who} escapes to infinity (closest approach r = ${fmt(result.rMin, 2)} M).`;
        break;
      case "whirl":
        msg = `${lead} is still orbiting near r = ${fmt(result.rMin, 2)} M at the end of the Mino interval Mλ = ${fmt(result.minoLimit, 0)}.`;
        break;
      case "bound":
        msg =
          result.rMax - result.rMin < 1e-3
            ? `Circular orbit at r = ${fmt(result.rMin, 3)} M.`
            : `Bound orbit, ${fmt(result.rMin, 2)} M ≤ r ≤ ${fmt(result.rMax, 2)} M` +
              (result.advance !== null ? `; periapsis advance ${fmt(result.advance, 1)}° per radial period.` : ".");
        break;
      case "forbidden":
        msg = "No orbit: R(r) < 0 everywhere outside r₊ for this E and L.";
        break;
      case "inside":
        msg = "Choose r₀ outside the horizon (r₀ > r₊ + 10⁻³ M).";
        break;
      case "noroot":
        msg = "No future-directed p_t solves g^μν p_μ p_ν = −μ² for these p_r, p_θ, p_φ.";
        break;
      default:
        msg = "The orbit stays outside the plotted region.";
    }
    if (result.whirlTurns >= 1 && (result.fate === "captured" || result.fate === "escaped")) {
      const end =
        result.fate === "captured"
          ? back ? "came out of the region next to the horizon" : "reaches the horizon"
          : back ? "came in from infinity" : `escapes (deflection ${fmt(result.deflection, 1)}°)`;
      msg = `${back ? "Traced back, the " + who : Who} whirls ${fmt(result.whirlTurns, 1)} turns around the photon orbit r = ${fmt(result.rPhoton, 3)} M; it ${end}.`;
    }
    if (Number.isFinite(result.normError)) {
      msg += ` Checks: mass shell g^μν p_μ p_ν = −μ² to ${result.normError.toExponential(0)} (relative), max|θ − π/2| = ${result.thetaDeviation ? result.thetaDeviation.toExponential(0) : "0"}.`;
    }
    $("kerr-status").textContent = msg;
    canvas.setAttribute("aria-label", `Kerr black hole with a/M = ${fmt(state.a)}. ${msg}`);

    // Derived quantities shown in the position & momentum tab.
    const c = result.constants;
    $("kerr-out-pt").textContent = result.p0 ? fmt(result.p0[0], 4) : "–";
    $("kerr-out-E").textContent = c ? fmt(c.E, 4) : "–";
    $("kerr-out-L").textContent = c ? fmt(c.L, 4) : "–";
    $("kerr-out-Q").textContent = c ? fmt(Math.abs(c.Q) < 1e-12 ? 0 : c.Q, 4) : "–";
    $("kerr-out-t").textContent = Number.isFinite(result.tFinal) ? fmt(result.tFinal, 2) : "–";
  }


  let pending = false;
  function redraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      draw();
    });
  }

  // Keeps a range slider and a number box in sync with state[key].
  function bindPair(key, digits) {
    const range = $(`kerr-${key}`);
    const number = $(`kerr-${key}-num`);
    const set = (value, from) => {
      const min = parseFloat(range.min);
      const max = parseFloat(range.max);
      state[key] = Math.min(max, Math.max(min, value));
      if (from !== range) range.value = state[key];
      range.style.setProperty("--fill", `${(100 * (state[key] - min)) / (max - min)}%`);
      if (from !== number) number.value = state[key].toFixed(digits);
      if (key === "a") updateTable();
      redraw();
    };
    range.addEventListener("input", () => set(parseFloat(range.value), range));
    number.addEventListener("change", () => {
      const value = parseFloat(number.value);
      if (Number.isFinite(value)) set(value, null);
      else number.value = state[key].toFixed(digits);
    });
    set(state[key], null);
    return set;
  }

  const setA = bindPair("a", 3);
  const setB = bindPair("b", 3);
  const setE = bindPair("E", 4);
  const setL = bindPair("L", 3);
  [["t0", 2], ["r0", 3], ["th0", 2], ["ph0", 2], ["pr", 3], ["pth", 3], ["pph", 3]].forEach(([key, digits]) => bindPair(key, digits));
  void setA;

  // Shows the controls of the current mode (null/timelike) and tab (constants/initial):
  // elements carry data-for="null|timelike" and/or data-tab="constants|initial".
  function setView() {
    const groups = [
      [".kerr-modes button", "mode", state.mode],
      [".kerr-direction button", "direction", String(state.direction)],
      [".kerr-tabs button", "tab", state.tab],
    ];
    for (const [selector, key, value] of groups) {
      document.querySelectorAll(selector).forEach((btn) => {
        const active = btn.dataset[key] === value;
        btn.classList.toggle("active", active);
        btn.setAttribute(btn.getAttribute("role") === "tab" ? "aria-selected" : "aria-pressed", String(active));
      });
    }
    document.querySelectorAll(".kerr [data-for], .kerr [data-tab-panel]").forEach((el) => {
      const modeOk = !el.dataset.for || el.dataset.for === state.mode;
      const tabOk = !el.dataset.tabPanel || el.dataset.tabPanel === state.tab;
      el.hidden = !(modeOk && tabOk);
    });
    redraw();
  }

  document.querySelectorAll(".kerr-modes button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      setView();
    }),
  );
  document.querySelectorAll(".kerr-direction button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.direction = Number(btn.dataset.direction);
      setView();
    }),
  );
  document.querySelectorAll(".kerr-tabs button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      setView();
    }),
  );

  document.querySelectorAll(".kerr-presets button").forEach((btn) =>
    btn.addEventListener("click", () => {
      const dir = btn.dataset.dir === "retro" ? -1 : 1;
      if (btn.dataset.preset === "critical") {
        setB(criticalImpact(state.a, dir), null);
      } else {
        const orbit = circularOrbit(state.a, isco(state.a, dir), dir);
        setE(orbit.E, null);
        setL(orbit.L, null);
      }
    }),
  );

  $("kerr-zoom-in").addEventListener("click", () => {
    state.zoom = Math.max(0, state.zoom - 1);
    redraw();
  });
  $("kerr-zoom-out").addEventListener("click", () => {
    state.zoom = Math.min(ZOOM_LEVELS.length - 1, state.zoom + 1);
    redraw();
  });

  document.addEventListener("themechange", redraw);
  if (window.ResizeObserver) new ResizeObserver(redraw).observe(canvas);
  window.addEventListener("resize", redraw);

  updateTable();
  setView();

  // Exposed for checking numbers from the browser console.
  window.Kerr = {
    horizons, photonOrbit, criticalImpact, isco, circularOrbit, geodesic, state,
    // Port of the Wolfram code (see the comment at the top of this file).
    deltaKerr, sigmaKerr, horizonRadius, inverseMetric, inverseMetricDerivatives, createCovector,
    radialPotential, constantsOfMotion, hasOuterReturn, escapeRadius, integrateGeodesic, realRoots,
  };
})();
