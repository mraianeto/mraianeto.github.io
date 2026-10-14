// Equatorial geodesics of a Kerr black hole, drawn on the about page.
//
// Units G = c = M = 1. The hole spins about +z, i.e. counter-clockwise on screen.
// Orbits stay in the equatorial plane θ = π/2: ∂H/∂θ vanishes there by reflection symmetry,
// so p_θ = 0 is preserved. E = −p_v and L = p_φ are conserved (per unit rest mass for
// timelike orbits, μ = 1; for photons only b = L/E matters, so E = 1). L > 0 is prograde.
//
// Hamiltonian method: H = ½ g^{μν} p_μ p_ν with the inverse Kerr metric in ingoing Kerr
// coordinates (v, r, θ, φ̃), dv = dt + (r²+a²)/Δ dr, dφ̃ = dφ + a/Δ dr, which is regular at
// the horizon. On the equator (Σ = r²):
//   g^{vv} = a²/r²,  g^{vr} = (r²+a²)/r²,  g^{vφ} = a/r²,  g^{rr} = Δ/r²,  g^{rφ} = a/r²,  g^{φφ} = 1/r²
// so, with P = E(r²+a²) − aL and Δ = r² − 2r + a²,
//   H(r, p_r) = [(L − aE)² − 2P p_r + Δ p_r²] / (2r²)
// and Hamilton's equations in the affine parameter λ (proper time for μ = 1) are
//   dr/dλ   =  ∂H/∂p_r = (Δ p_r − P) / r²
//   dφ̃/dλ  =  ∂H/∂p_φ = (L − aE + a p_r) / r²
//   dp_r/dλ = −∂H/∂r   = N/r³ − ∂N/∂r / (2r²),   N = 2r²H,   ∂N/∂r = −4E r p_r + 2(r − 1) p_r²
// with the mass-shell constraint H = −μ²/2 (μ = 1 timelike, 0 null), which the integrator monitors.
// They are integrated with an adaptive Dormand–Prince 5(4) Runge–Kutta scheme.
(function () {
  const canvas = document.getElementById("kerr-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  const ZOOM_LEVELS = [4, 6, 8, 10, 12, 15, 20, 30, 50];
  const MAX_TURNS = 12; // stop bound orbits after this many revolutions
  const MAX_STEPS = 150000;

  // Default timelike orbit: bound, 5 M ≤ r ≤ 12 M at a = 0.9 (R(5) = R(12) = 0).
  const state = { mode: "timelike", a: 0.9, b: 3.0, E: 0.9442, L: 3.012, zoom: 5 };

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

  // Radial function R(r) = P² − Δ[μ²r² + (L − aE)²], from H = −μ²/2 with p_r eliminated.
  // Used only to place the initial point (turning points and initial p_r).
  function radialFunction(g) {
    const { a, E, L, mu2 } = g;
    const c4 = E * E - mu2;
    const c3 = 2 * mu2;
    const c2 = a * a * c4 - L * L;
    const c1 = 2 * (L - a * E) * (L - a * E);
    return (r) => r * (c1 + r * (c2 + r * (c3 + r * c4)));
  }

  // Hamiltonian H(r, p_r) on the equator in ingoing Kerr coordinates.
  function hamiltonian(g, r, pr) {
    const { a, E, L } = g;
    const P = E * (r * r + a * a) - a * L;
    const delta = r * r - 2 * r + a * a;
    return ((L - a * E) * (L - a * E) - 2 * P * pr + delta * pr * pr) / (2 * r * r);
  }

  // Hamilton's equations: d/dλ of the state [r, φ̃, p_r].
  function hamiltonRates(g, y) {
    const { a, E, L } = g;
    const [r, , pr] = y;
    const r2 = r * r;
    const P = E * (r2 + a * a) - a * L;
    const delta = r2 - 2 * r + a * a;
    const N = (L - a * E) * (L - a * E) - 2 * P * pr + delta * pr * pr; // N = 2r²H
    const dNdr = -4 * E * r * pr + (2 * r - 2) * pr * pr; //               ∂N/∂r at fixed p_r
    return [
      (delta * pr - P) / r2, //                 dr/dλ   =  ∂H/∂p_r
      (L - a * E + a * pr) / r2, //             dφ̃/dλ  =  ∂H/∂p_φ
      -(dNdr / (2 * r2) - N / (r2 * r)), //     dp_r/dλ = −∂H/∂r,  H = N/(2r²)
    ];
  }

  // Ingoing solution of H = −μ²/2 for p_r:  Δp_r² − 2P p_r + K = 0  →  p_r = K/(P + √R).
  function ingoingMomentum(g, r, R) {
    const { a, E, L, mu2 } = g;
    const P = E * (r * r + a * a) - a * L;
    const K = mu2 * r * r + (L - a * E) * (L - a * E);
    return K / (P + Math.sqrt(Math.max(R, 0)));
  }

  // Largest turning point above the horizon for bound (E < 1) orbits, or null.
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
  const RTOL = 1e-10;
  const ATOL = 1e-10;

  // One Dormand–Prince step; returns the 5th-order solution and the scaled error norm.
  function dopriStep(f, y, h) {
    const k = [f(y)];
    for (let s = 1; s < 7; s += 1) {
      const ys = y.map((q, i) => q + h * DP_A[s].reduce((sum, aij, j) => sum + aij * k[j][i], 0));
      k.push(f(ys));
    }
    const next = y.map((q, i) => q + h * DP_B.reduce((sum, b, j) => sum + b * k[j][i], 0));
    let err = 0;
    for (let i = 0; i < y.length; i += 1) {
      const e = h * DP_E.reduce((sum, c, j) => sum + c * k[j][i], 0);
      const scale = ATOL + RTOL * Math.max(Math.abs(y[i]), Math.abs(next[i]));
      err = Math.max(err, Math.abs(e) / scale);
    }
    return { next, err };
  }

  // Integrates one geodesic from Hamilton's equations.
  function geodesic(s, startRadius) {
    const a = s.a;
    const rPlus = horizons(a).plus;
    const g = s.mode === "null" ? { a, E: 1, L: s.b, mu2: 0 } : { a, E: s.E, L: s.L, mu2: 1 };
    const R = radialFunction(g);
    const f = (y) => hamiltonRates(g, y);

    let r;
    let pr;
    let phi;
    let bound = false;
    if (g.mu2 === 1 && g.E < 1) {
      // Bound orbit: start at rest radially at the apoapsis (R = 0, so p_r = P/Δ = K/P).
      bound = true;
      r = outerTurningPoint(R, rPlus, g.E);
      if (r === null) return { points: [], fate: "forbidden" };
      pr = ingoingMomentum(g, r, 0);
      phi = 0;
    } else {
      r = startRadius;
      if (R(r) < 0) return { points: [], fate: "far" };
      pr = ingoingMomentum(g, r, R(r));
      // Place the start so that the initial velocity points along −x (horizontal, leftwards).
      const [dr, dphi] = f([r, 0, pr]);
      phi = Math.atan2(r * dphi, -dr);
    }

    let y = [r, phi, pr];
    const points = [[r * Math.cos(phi), r * Math.sin(phi)]];
    const phi0 = phi;
    const escapeRadius = Math.max(startRadius, r) + 1;
    const shell = -g.mu2 / 2;
    let constraint = Math.abs(hamiltonian(g, r, pr) - shell);
    let rMin = r;
    let rMax = r;
    let heading = null;
    let turning = 0;
    const periapses = [];
    let fate = bound ? "bound" : "whirl";
    let h = 1e-3 * r;
    // Photons near b_c whirl around the unstable photon orbit; count those turns.
    const rPhoton = g.mu2 === 0 ? photonOrbit(a, g.L >= 0 ? 1 : -1) : null;
    let whirlTurns = 0;

    for (let step = 0; step < MAX_STEPS; step += 1) {
      // Cap the step so that consecutive drawn points are at most ~3% of r apart.
      const [dr, dphi] = f(y);
      const speed = Math.hypot(dr, y[0] * dphi) || 1e-12;
      h = Math.min(h, (0.03 * Math.max(y[0], 1)) / speed);
      const { next, err } = dopriStep(f, y, h);
      if (err > 1) {
        h *= Math.max(0.2, 0.9 * Math.pow(err, -0.2));
        continue;
      }
      const drNext = f(next)[0];

      // Periapsis: dr/dλ changes sign from − to +. Locate it inside the step by regula falsi
      // on the step length, so the periapsis advance is accurate to the integrator tolerance.
      if (dr < 0 && drNext >= 0) {
        let lo = 0;
        let hi = h;
        let fLo = dr;
        let fHi = drNext;
        let at = next;
        for (let it = 0; it < 30 && hi - lo > 1e-13 * h; it += 1) {
          const tau = lo + (hi - lo) * (fLo / (fLo - fHi));
          at = dopriStep(f, y, tau).next;
          const fm = f(at)[0];
          if (Math.abs(fm) < 1e-14) break;
          if (fm < 0) {
            lo = tau;
            fLo = fm;
          } else {
            hi = tau;
            fHi = fm;
          }
        }
        periapses.push(at[1]);
      }
      if (next[0] <= rPlus) {
        const t = (y[0] - rPlus) / (y[0] - next[0]);
        const ph = y[1] + t * (next[1] - y[1]);
        points.push([rPlus * Math.cos(ph), rPlus * Math.sin(ph)]);
        fate = "captured";
        break;
      }

      if (rPhoton !== null && Math.abs(next[0] - rPhoton) < 0.01 * rPhoton) whirlTurns += Math.abs(next[1] - y[1]) / (2 * Math.PI);
      y = next;
      constraint = Math.max(constraint, Math.abs(hamiltonian(g, y[0], y[2]) - shell));
      const x = y[0] * Math.cos(y[1]);
      const yy = y[0] * Math.sin(y[1]);
      const [px, py] = points[points.length - 1];
      const hd = Math.atan2(yy - py, x - px);
      if (heading !== null) {
        let d = hd - heading;
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        turning += d;
      }
      heading = hd;
      points.push([x, yy]);
      rMin = Math.min(rMin, y[0]);
      rMax = Math.max(rMax, y[0]);

      if (!bound && y[0] > escapeRadius && drNext > 0) {
        fate = "escaped";
        break;
      }
      if (Math.abs(y[1] - phi0) > 2 * Math.PI * MAX_TURNS) {
        fate = bound ? "bound" : "whirl";
        break;
      }
      h *= Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2)));
    }

    let advance = null;
    if (periapses.length >= 2) {
      const dphi = Math.abs(periapses[1] - periapses[0]);
      advance = ((dphi - 2 * Math.PI) * 180) / Math.PI;
    }
    return { points, fate, bound, rMin, rMax, deflection: (Math.abs(turning) * 180) / Math.PI, advance, constraint, whirlTurns, rPhoton };
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
    if (state.mode === "null") {
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
      drawArrow(result.points, X, Y, half, pathColor);
      if (result.bound) {
        const [x0, y0] = result.points[0];
        ctx.fillStyle = pathColor;
        ctx.beginPath();
        ctx.arc(X(x0), Y(y0), 3.5, 0, 2 * Math.PI);
        ctx.fill();
      }
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
    const who = state.mode === "null" ? "Photon" : "Particle";
    let msg;
    switch (result.fate) {
      case "captured":
        msg = `${who} is captured: it crosses the event horizon r₊.`;
        break;
      case "escaped":
        msg = `${who} is scattered: deflection ${fmt(result.deflection, 1)}°, closest approach r = ${fmt(result.rMin, 2)} M.`;
        break;
      case "whirl":
        msg = `${who} whirls around the unstable circular orbit near r = ${fmt(result.rMin, 2)} M (drawing stopped after ${MAX_TURNS} turns).`;
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
      default:
        msg = "The orbit stays outside the plotted region.";
    }
    if (result.whirlTurns >= 1 && (result.fate === "captured" || result.fate === "escaped")) {
      const end = result.fate === "captured" ? "crosses the event horizon r₊" : `escapes (deflection ${fmt(result.deflection, 1)}°)`;
      msg = `${who} whirls ${fmt(result.whirlTurns, 1)} turns around the photon orbit r = ${fmt(result.rPhoton, 3)} M, then ${end}.`;
    }
    if (Number.isFinite(result.constraint)) msg += ` Hamiltonian constraint kept to |H + μ²/2| ≤ ${result.constraint.toExponential(0)}.`;
    $("kerr-status").textContent = msg;
    canvas.setAttribute("aria-label", `Kerr black hole with a/M = ${fmt(state.a)}. ${msg}`);
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
  void setA;

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".kerr-modes button").forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll(".kerr [data-for]").forEach((el) => {
      el.hidden = el.dataset.for !== mode;
    });
    redraw();
  }

  document.querySelectorAll(".kerr-modes button").forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));

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
  setMode(state.mode);

  // Exposed for checking numbers from the browser console.
  window.Kerr = { horizons, photonOrbit, criticalImpact, isco, circularOrbit, hamiltonian, hamiltonRates, geodesic, state };
})();
