// "Fun: Black Hole Accretion Disks" on the about page: a Novikov–Thorne thin disk around a Kerr
// black hole, as a distant observer sees it, from pre-rendered ipole maps.
//
// For every (spin a*, inclination i) of the grid, ipole (Mościbrodzka & Gammie 2018) traced each
// pixel's photon back to the disk once (tools/make_disk_maps.py, model thin_disk_web, mode 4) and
// stored, per pixel: the emission radius r, the redshift g = ν_obs/ν_emit (Doppler + gravitational,
// light bending included) and μ = |cos| of the emission angle in the fluid frame. The browser then
// evaluates ipole's own emission formula on those maps (thin_disk: fbbpolemis, mode 0):
//     I_ν = g³ f⁻⁴ B_ν(ν/g, f T(r)) [× Chandrasekhar limb darkening I(μ)],
// with the Novikov–Thorne (Page–Thorne) temperature T(r) of the ipole model, and zero emission
// outside r_ISCO < r < r_out, as in ipole. So mass, accretion rate, photon energy, colour correction
// and limb darkening are free; spin and inclination are the ipole grid values.
// Since I_ν/ν³ is invariant, I_ν = f⁻⁴ 2hν³/c² / (exp(hν/kT_obs) − 1) with T_obs = g f T(r): each
// pixel is a blackbody at its observed colour temperature, which is what the spectrum sums.
(function () {
  const root = document.getElementById("disk-widget");
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const DATA = "/assets/data/disk/";

  // ipole's constants (src/constants.h), cgs
  const CL = 2.99792458e10, HPL = 6.6260693e-27, KBOL = 1.3806505e-16, SIG = 5.6704e-5;
  const GNEWT = 6.6742e-8, MP = 1.67262171e-24, MSUN = 1.989e33, SIGMA_T = 0.665245873e-24;
  const KEV = 1.602176634e-9; // erg
  const YEAR = 3.15576e7; // s

  // Colour maps (matplotlib afmhot, RdBu, cividis; 64 steps): sequential for I, diverging around
  // g = 1 for the redshift, sequential for r.
  const LUTS = {
    hot: "0000000800001000001800002000002800003000003800004000004800005000005800006000006800007000007800008202008a0a009212009a1a00a22200aa2a00b23200ba3a00c24200ca4a00d25200da5a00e26200ea6a00f27200fa7a00ff8405ff8c0dff9415ff9c1dffa425ffac2dffb435ffbc3dffc445ffcc4dffd455ffdc5dffe465ffec6dfff475fffc7dffff87ffff8fffff97ffff9fffffa7ffffafffffb7ffffbfffffc7ffffcfffffd7ffffdfffffe7ffffeffffff7ffffff",
    rdbu: "67001f7304217f08238a0b25960f27a21328ae172ab61f2ebb2a34c13639c6413ecc4c44d25849d7634fdc6e57e17860e6866aeb9172f09c7bf4a683f6af8ef7b799f8bfa4fac8affbd0b9fdd9c4fcdecdfbe3d4fae7dcf9ebe3f9f0ebf8f4f2f3f5f6edf2f5e7f0f4e1edf3dbeaf2d5e7f1cfe4efc5dfecbbdaeab1d5e7a7d0e49dcbe193c6de87beda7bb6d66eaed25fa5cd529dc84695c43f8ec03a87bd3480b92f79b52a71b2246aae1f63a81b5a9c1752901249840e417909386d053061",
    cividis: "00224e00255400285b002b62002e6a0030700533711235701a386f213b6e273e6e2d416d32436d36466c3b496c3f4c6c444f6c48526c4c556c50576c545a6d575d6d5b606e5e636f62656f656870696b716c6e727071737374757777767a7a787e7d788280798683798a86788e8978928c78958f779992779d9576a19975a59c74a99f73ada272b1a570b6a96fbaac6dbfb06bc3b369c7b767ccba64d0be62d4c15fd9c55cddc858e1cc55e6d051ead34cefd748f3db42f8df3cfde334fee838",
  };
  const lut = {};
  for (const [name, hex] of Object.entries(LUTS)) {
    const n = hex.length / 6;
    lut[name] = Array.from({ length: n }, (_, k) => [0, 2, 4].map((o) => parseInt(hex.substr(6 * k + o, 2), 16)));
  }
  // Colour at v ∈ [0, 1], linear between the 64 steps.
  function colourAt(name, v) {
    const L = lut[name];
    const x = Math.min(1, Math.max(0, v)) * (L.length - 1);
    const k = Math.min(L.length - 2, Math.floor(x));
    const t = x - k;
    return [0, 1, 2].map((c) => L[k][c] + t * (L[k + 1][c] - L[k][c]));
  }

  const state = {
    show: "inu", // inu | bol | g | r
    scale: "lin", // lin | log
    ai: 0, // index into index.spins
    ii: 0, // index into index.incls
    logM: 1, // log10(M/Msun)
    logMdot: -1, // log10(Mdot/Mdot_Edd)
    logE: 0, // log10(E/keV)
    fcol: 1.7,
    limb: 1,
  };

  let index = null; // assets/data/disk/index.json
  const cache = new Map(); // file name -> { g, r, mu } Float32Arrays
  let maps = null; // the current one
  let derived = null; // per-pixel quantities for the current physics (see derive)

  // ------------------------------------------------------------ physics (as the ipole model)

  const iscoRadius = (a) => {
    const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
    const z2 = Math.sqrt(3 * a * a + z1 * z1);
    return 3 + z2 - Math.sign(a || 1) * Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  };
  const horizon = (a) => 1 + Math.sqrt(1 - a * a);
  // Specific energy of the circular orbit at the ISCO (disk co-rotating with +φ; a < 0 is retrograde).
  const iscoEnergy = (a) => {
    const r = iscoRadius(a);
    const sr = Math.sqrt(r);
    return (r * sr - 2 * sr + a) / (Math.pow(r, 0.75) * Math.sqrt(r * sr - 3 * sr + 2 * a));
  };

  // Page–Thorne / Novikov–Thorne factor (ipole thin_disk krolikc).
  function krolikc(r, a, risco) {
    const y = Math.sqrt(r);
    const yms = Math.sqrt(risco);
    const y1 = 2 * Math.cos((Math.acos(a) - Math.PI) / 3);
    const y2 = 2 * Math.cos((Math.acos(a) + Math.PI) / 3);
    const y3 = -2 * Math.cos(Math.acos(a) / 3);
    const term = (yk, yl, ym) => ((3 * (yk - a) ** 2) / (y * yk * (yk - yl) * (yk - ym))) * Math.log((y - yk) / (yms - yk));
    return 1 - yms / y - ((3 * a) / (2 * y)) * Math.log(y / yms) - term(y1, y2, y3) - term(y2, y1, y3) - term(y3, y1, y2);
  }

  // Mass, accretion rate and the temperature scale T0 of the ipole model.
  function scales() {
    const M = Math.pow(10, state.logM) * MSUN;
    const Lunit = (GNEWT * M) / (CL * CL); // GM/c² [cm]
    const MdotEdd = (4 * Math.PI * GNEWT * M * MP) / 0.1 / CL / SIGMA_T; // L_Edd/(0.1 c²) [g/s]
    const Mdot = Math.pow(10, state.logMdot) * MdotEdd;
    const T0 = Math.pow(((3 / 8 / Math.PI) * GNEWT * M * Mdot) / Lunit ** 3 / SIG, 0.25);
    return { M, Lunit, MdotEdd, Mdot, T0, LEdd: 0.1 * MdotEdd * CL * CL };
  }

  const temperature = (r, a, risco, T0) => T0 * Math.pow(krolikc(r, a, risco) / (1 - 3 / r + (2 * a) / r ** 1.5) / r ** 3, 0.25);

  // Chandrasekhar's Table 24 (electron-scattering atmosphere), linear in μ as in ipole.
  function limbFactor(mu) {
    if (!state.limb) return 1;
    const tab = index.chandra;
    const m = Math.min(mu, 1 - 1e-12);
    let k = 0;
    while (k < tab.length - 2 && tab[k + 1][0] < m) k += 1;
    const w = (m - tab[k][0]) / (tab[k + 1][0] - tab[k][0]);
    return (1 - w) * tab[k][1] + w * tab[k + 1][1];
  }

  // Specific intensity of a blackbody of temperature T at frequency nu, divided by f⁴ by the caller.
  const planck = (nu, T) => (2 * HPL * nu ** 3) / (CL * CL) / Math.expm1((HPL * nu) / (KBOL * T));

  // Per-pixel observed colour temperature T_obs = g f T(r) and weight f⁻⁴ I_limb(μ).
  function derive() {
    const a = index.spins[state.ai];
    const risco = iscoRadius(a);
    const sc = scales();
    const n = maps.g.length;
    const Tobs = new Float32Array(n);
    const wt = new Float32Array(n);
    const on = [];
    let Tmax = 0;
    let gmin = Infinity;
    let gmax = 0;
    const f4 = Math.pow(state.fcol, -4);
    for (let k = 0; k < n; k += 1) {
      const g = maps.g[k];
      const r = maps.r[k];
      if (!(g > 0 && r > risco && r < index.r_out)) continue;
      const T = temperature(r, a, risco, sc.T0);
      Tobs[k] = g * state.fcol * T;
      wt[k] = f4 * limbFactor(maps.mu[k]);
      on.push(k);
      if (Tobs[k] > Tmax) Tmax = Tobs[k];
      if (g < gmin) gmin = g;
      if (g > gmax) gmax = g;
    }
    // Local (fluid-frame) peak temperature of the disk, on a fine radial grid.
    let Tpeak = 0;
    let rpeak = risco;
    for (let k = 1; k <= 2000; k += 1) {
      const r = risco * Math.pow(index.r_out / risco, k / 2000);
      const T = temperature(Math.min(r, index.r_out * 0.999999), a, risco, sc.T0);
      if (T > Tpeak) {
        Tpeak = T;
        rpeak = r;
      }
    }
    const dA = ((index.fov / index.npix) * sc.Lunit) ** 2; // pixel area at the black hole [cm²]
    derived = { a, risco, sc, Tobs, wt, on: Int32Array.from(on), TobsMax: Tmax, gmin, gmax, Tpeak, rpeak, dA };
    derived.spectrum = spectrum();
  }

  // Apparent νL_ν = 4π D² ν F_ν [erg/s] of the ipole image, and of the same disk without relativistic
  // effects (flat space, no Doppler or gravitational shift, no light bending, seen at the same i).
  function spectrum() {
    const d = derived;
    const kTc = (KBOL * d.TobsMax) / KEV;
    const Emin = kTc / 1000;
    const Emax = kTc * 30;
    const n = 120;
    const E = [];
    const rel = [];
    const cls = [];
    const a = d.a;
    const incl = (index.incls[state.ii] * Math.PI) / 180;
    const limbCl = limbFactor(Math.cos(incl));
    const f4 = Math.pow(state.fcol, -4);
    // radial grid for the flat-space disk
    const nr = 600;
    const rr = [];
    for (let k = 0; k <= nr; k += 1) rr.push(d.risco * Math.pow(index.r_out / d.risco, k / nr));
    const Tr = rr.map((r, k) => (k === 0 ? 0 : temperature(Math.min(r, index.r_out * 0.999999), a, d.risco, d.sc.T0)));
    // Pixels binned in ln T_obs (4000 bins; weight sum and weighted mean T per bin): the spectrum is
    // then a sum of 4000 blackbodies instead of one per pixel.
    let tlo = Infinity;
    for (let q = 0; q < d.on.length; q += 1) tlo = Math.min(tlo, d.Tobs[d.on[q]]);
    const nb = 4000;
    const lnlo = Math.log(tlo);
    const span = Math.log(d.TobsMax) - lnlo || 1;
    const W = new Float64Array(nb);
    const WT = new Float64Array(nb);
    for (let q = 0; q < d.on.length; q += 1) {
      const k = d.on[q];
      const b = Math.min(nb - 1, Math.floor(((Math.log(d.Tobs[k]) - lnlo) / span) * nb));
      W[b] += d.wt[k];
      WT[b] += d.wt[k] * d.Tobs[k];
    }
    const bins = [];
    for (let b = 0; b < nb; b += 1) if (W[b] > 0) bins.push([W[b], WT[b] / W[b]]);
    for (let j = 0; j < n; j += 1) {
      const e = Emin * Math.pow(Emax / Emin, j / (n - 1));
      const nu = (e * KEV) / HPL;
      let sum = 0;
      const c = (2 * HPL * nu ** 3) / (CL * CL);
      for (const [w, T] of bins) sum += w / Math.expm1((HPL * nu) / (KBOL * T));
      rel.push(nu * 4 * Math.PI * c * sum * d.dA);
      let flat = 0;
      for (let k = 1; k <= nr; k += 1) {
        const r1 = rr[k - 1];
        const r2 = rr[k];
        const i1 = k - 1 === 0 ? 0 : f4 * planck(nu, state.fcol * Tr[k - 1]) * r1;
        const i2 = f4 * planck(nu, state.fcol * Tr[k]) * r2;
        flat += 0.5 * (i1 + i2) * (r2 - r1);
      }
      cls.push(nu * 4 * Math.PI * Math.cos(incl) * limbCl * 2 * Math.PI * flat * d.sc.Lunit ** 2);
      E.push(e);
    }
    // Plot range: where either curve is within 10⁻⁴ of the peak, plus a little margin.
    const top = Math.max(...rel, ...cls);
    const inside = E.map((_, k) => Math.max(rel[k], cls[k]) > 1e-4 * top);
    const k0 = Math.max(0, inside.indexOf(true) - 3);
    const k1 = Math.min(n - 1, inside.lastIndexOf(true) + 3);
    return { E: E.slice(k0, k1 + 1), rel: rel.slice(k0, k1 + 1), cls: cls.slice(k0, k1 + 1) };
  }

  // Value shown at pixel k for the current "show" setting (null: no disk emission there).
  function pixelValue(k) {
    if (!derived || !(derived.Tobs[k] > 0)) return null;
    switch (state.show) {
      case "g":
        return maps.g[k];
      case "r":
        return maps.r[k];
      case "bol":
        return ((derived.wt[k] * state.fcol ** 4 * SIG) / Math.PI) * (derived.Tobs[k] / state.fcol) ** 4;
      default: {
        const nu = (Math.pow(10, state.logE) * KEV) / HPL;
        return derived.wt[k] * planck(nu, derived.Tobs[k]);
      }
    }
  }

  // ------------------------------------------------------------ drawing

  const imgCanvas = $("disk-canvas");
  const specCanvas = $("disk-spectrum");
  const ictx = imgCanvas.getContext("2d");
  const sctx = specCanvas.getContext("2d");
  const off = document.createElement("canvas");
  const octx = off.getContext("2d");
  let layout = null; // image placement, for hover

  function colours() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    return { bg: v("--kerr-canvas-bg"), text: v("--global-text-color-light"), ink: v("--global-text-color"), grid: v("--kerr-grid"), accent: v("--global-theme-color"), divider: v("--global-divider-color") };
  }

  // Height set here from the width (heightOf(width) gives the drawing height in CSS px), so the layout
  // never depends on CSS aspect-ratio support or on a cached stylesheet.
  function sizeCanvas(cv, ctx, heightOf) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = Math.round(heightOf(w));
    const border = cv.offsetHeight - cv.clientHeight; // the CSS height includes the border (border-box)
    if (cv.style.height !== `${h + border}px`) cv.style.height = `${h + border}px`;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [w, h];
  }

  // 1.2e+7 -> "1.2×10⁷"
  const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  function sci(x, digits = 2) {
    if (!Number.isFinite(x)) return "–";
    if (x === 0) return "0";
    const e = Math.floor(Math.log10(Math.abs(x)));
    if (e >= -2 && e <= 3) return String(+x.toPrecision(digits));
    const m = x / 10 ** e;
    const ms = m.toPrecision(digits);
    const pow = `10${String(e).split("").map((c) => SUP[c]).join("")}`;
    return ms === "1" || ms === "1.0" ? pow : `${ms}×${pow}`;
  }
  const pow10 = (e) => `10${String(e).split("").map((c) => SUP[c]).join("")}`;

  function displayRange() {
    const d = derived;
    if (state.show === "g") {
      // Diverging around g = 1 (no shift), in ln g; each side spans its own data range.
      return { kind: "g", lo: Math.min(d.gmin, 0.99), hi: Math.max(d.gmax, 1.01) };
    }
    if (state.show === "r") return { kind: "r", lo: d.risco, hi: index.r_out };
    let vmax = 0;
    for (let q = 0; q < d.on.length; q += 1) vmax = Math.max(vmax, pixelValue(d.on[q]) || 0);
    return { kind: state.show, lo: state.scale === "log" ? vmax * 1e-3 : 0, hi: vmax };
  }

  // Normalised colour coordinate of a value, for the current range.
  function norm(v, rg) {
    if (rg.kind === "g") {
      const L = Math.log(v);
      return L < 0 ? 0.5 - (0.5 * L) / Math.log(rg.lo) : 0.5 + (0.5 * L) / Math.log(rg.hi);
    }
    if (rg.kind === "r") return (v - rg.lo) / (rg.hi - rg.lo);
    if (!(rg.hi > 0)) return 0;
    if (state.scale === "log") return v > 0 ? 1 + Math.log10(v / rg.hi) / 3 : 0;
    return v / rg.hi;
  }
  const lutName = () => (state.show === "g" ? "rdbu" : state.show === "r" ? "cividis" : "hot");

  // Colour-bar caption: one line, or quantity and units on two lines when it is wider than the canvas.
  function captionLines(width) {
    const label = colourbarLabel();
    ictx.font = "11px Roboto, sans-serif";
    if (ictx.measureText(label).width <= width - 8) return [label];
    const k = label.indexOf("  [") >= 0 ? label.indexOf("  [") : label.indexOf("  (");
    return k > 0 ? [label.slice(0, k), label.slice(k + 2)] : [label];
  }

  function drawImage(message) {
    // 8 top + S image + 40 axis + 12 bar + 18 ticks + 16 per caption line + 6
    const [W, H] = sizeCanvas(imgCanvas, ictx, (w) => w - 56 + 8 + 40 + 12 + 18 + 16 * captionLines(w).length + 6);
    const c = colours();
    ictx.clearRect(0, 0, W, H);
    if (!derived) {
      if (message) {
        ictx.fillStyle = c.text;
        ictx.font = "13px Roboto, sans-serif";
        ictx.textAlign = "center";
        ictx.textBaseline = "middle";
        ictx.fillText(message.length > 60 ? `${message.slice(0, 60)}…` : message, W / 2, H / 2);
      }
      return;
    }
    const left = 46;
    const right = 10;
    const top = 8;
    const S = W - left - right;
    const cbTop = top + S + 40;
    layout = { left, top, S };

    // pixels
    const N = index.npix;
    if (off.width !== N) {
      off.width = N;
      off.height = N;
    }
    const img = octx.createImageData(N, N);
    const rg = displayRange();
    const name = lutName();
    for (let k = 0; k < N * N; k += 1) {
      const v = pixelValue(k);
      let rgb = [0, 0, 0];
      if (v !== null) rgb = colourAt(name, norm(v, rg));
      img.data[4 * k] = rgb[0];
      img.data[4 * k + 1] = rgb[1];
      img.data[4 * k + 2] = rgb[2];
      img.data[4 * k + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    ictx.imageSmoothingEnabled = true;
    ictx.drawImage(off, left, top, S, S);
    if (!(rg.hi > 0)) {
      // I_ν underflows to 0 in every pixel: E is far above the Wien cutoff of the hottest pixel.
      const kTobs = (KBOL * derived.TobsMax) / KEV;
      ictx.fillStyle = "#e8e8e8";
      ictx.font = "13px Roboto, sans-serif";
      ictx.textAlign = "center";
      ictx.textBaseline = "middle";
      ictx.fillText(`No measurable emission at E = ${fmtE(Math.pow(10, state.logE))}:`, left + S / 2, top + S / 2 - 10);
      ictx.fillText(`the hottest pixel has kT_obs = ${fmtE(kTobs)} (Wien cutoff).`, left + S / 2, top + S / 2 + 10);
    }
    ictx.strokeStyle = c.divider;
    ictx.lineWidth = 1;
    ictx.strokeRect(left + 0.5, top + 0.5, S - 1, S - 1);

    // axes: α (horizontal), β (vertical) in GM/c²
    const half = index.fov / 2;
    const X = (al) => left + ((al + half) / index.fov) * S;
    const Y = (be) => top + ((half - be) / index.fov) * S;
    ictx.fillStyle = c.text;
    ictx.strokeStyle = c.text;
    ictx.font = "11px Roboto, sans-serif";
    for (const t of [-20, -10, 0, 10, 20]) {
      ictx.beginPath();
      ictx.moveTo(X(t), top + S);
      ictx.lineTo(X(t), top + S + 4);
      ictx.moveTo(left, Y(t));
      ictx.lineTo(left - 4, Y(t));
      ictx.stroke();
      ictx.textAlign = "center";
      ictx.textBaseline = "top";
      ictx.fillText(String(t), X(t), top + S + 6);
      ictx.textAlign = "right";
      ictx.textBaseline = "middle";
      ictx.fillText(String(t), left - 6, Y(t));
    }
    ictx.textAlign = "center";
    ictx.textBaseline = "top";
    ictx.fillText("α  [GM/c²]", left + S / 2, top + S + 20);
    ictx.save();
    ictx.translate(11, top + S / 2);
    ictx.rotate(-Math.PI / 2);
    ictx.textBaseline = "middle";
    ictx.fillText("β  [GM/c²]", 0, 0);
    ictx.restore();
    ictx.textAlign = "left";
    ictx.textBaseline = "top";
    ictx.fillStyle = "#e8e8e8";
    ictx.fillText(`a* = ${derived.a},  i = ${index.incls[state.ii]}°`, left + 8, top + 7);

    // colour bar
    const cbH = 12;
    const grad = ictx.createLinearGradient(left, 0, left + S, 0);
    for (let k = 0; k <= 32; k += 1) {
      const [r, g, b] = colourAt(name, k / 32);
      grad.addColorStop(k / 32, `rgb(${r},${g},${b})`);
    }
    ictx.fillStyle = grad;
    ictx.fillRect(left, cbTop, S, cbH);
    ictx.strokeStyle = c.divider;
    ictx.strokeRect(left + 0.5, cbTop + 0.5, S - 1, cbH - 1);
    const ticks = colourbarTicks(rg);
    ictx.fillStyle = c.text;
    ictx.strokeStyle = c.text;
    ictx.textBaseline = "top";
    for (const [v, label] of ticks) {
      const x = left + Math.min(1, Math.max(0, norm(v, rg))) * S;
      ictx.beginPath();
      ictx.moveTo(x, cbTop + cbH);
      ictx.lineTo(x, cbTop + cbH + 4);
      ictx.stroke();
      ictx.textAlign = x < left + 10 ? "left" : x > left + S - 10 ? "right" : "center";
      ictx.fillText(label, x, cbTop + cbH + 6);
    }
    ictx.textAlign = "center";
    ictx.font = "11px Roboto, sans-serif";
    captionLines(W).forEach((line, k) => ictx.fillText(line, W / 2, cbTop + cbH + 22 + 16 * k));
  }

  function colourbarLabel() {
    switch (state.show) {
      case "g":
        return "redshift g = ν_obs / ν_emit  (dimensionless; red: g < 1, blue: g > 1)";
      case "r":
        return "emission radius r  [GM/c²]   (inner edge: ISCO)";
      case "bol":
        return "bolometric intensity I  [erg s⁻¹ cm⁻² sr⁻¹]";
      default:
        return `specific intensity I_ν at ${fmtE(Math.pow(10, state.logE))}  [erg s⁻¹ cm⁻² Hz⁻¹ sr⁻¹]`;
    }
  }

  function colourbarTicks(rg) {
    if (rg.kind === "g") {
      const vals = [rg.lo, Math.sqrt(rg.lo), 1, Math.sqrt(rg.hi), rg.hi];
      return vals.map((v) => [v, v.toFixed(2)]);
    }
    if (rg.kind === "r") {
      const vals = [rg.lo, 5, 10, 15, 20].filter((v, k) => k === 0 || v > rg.lo + 2);
      return vals.map((v, k) => [v, k === 0 ? v.toFixed(2) : String(v)]);
    }
    if (!(rg.hi > 0)) return [];
    if (state.scale === "log") return [-3, -2, -1, 0].map((e) => [rg.hi * 10 ** e, sci(rg.hi * 10 ** e)]);
    return [0, 0.25, 0.5, 0.75, 1].map((t) => [t * rg.hi, t === 0 ? "0" : sci(t * rg.hi)]);
  }

  // ---- spectrum: log-log νL_ν vs E, one axis
  let specLayout = null;
  const LEGEND = ["ipole image (relativistic)", "same disk, flat space, no shifts"];
  function legendRows(width) {
    sctx.font = "11px Roboto, sans-serif";
    const total = LEGEND.reduce((sum, label) => sum + 28 + sctx.measureText(label).width + 18, 0);
    return total <= width - 52 ? 1 : 2;
  }

  function drawSpectrum(hoverX) {
    const [W, H] = sizeCanvas(specCanvas, sctx, (w) => (w * 11) / 16 + 16 * (legendRows(w) - 1));
    const c = colours();
    sctx.clearRect(0, 0, W, H);
    if (!derived) return;
    const sp = derived.spectrum;
    const rows = legendRows(W);
    const left = 52;
    const right = 12;
    const top = 30 + 16 * (rows - 1);
    const bottom = 38;
    const pw = W - left - right;
    const ph = H - top - bottom;
    const ymax = Math.max(...sp.rel, ...sp.cls);
    const y0 = Math.floor(Math.log10(ymax)) - 3;
    const y1 = Math.log10(ymax) + 0.25;
    const x0 = Math.log10(sp.E[0]);
    const x1 = Math.log10(sp.E[sp.E.length - 1]);
    const X = (e) => left + ((Math.log10(e) - x0) / (x1 - x0)) * pw;
    const Y = (v) => top + (1 - (Math.log10(Math.max(v, 1e-300)) - y0) / (y1 - y0)) * ph;
    specLayout = { left, pw, X, x0, x1 };

    // grid and decade ticks
    sctx.font = "11px Roboto, sans-serif";
    sctx.strokeStyle = c.grid;
    sctx.fillStyle = c.text;
    sctx.lineWidth = 1;
    for (let e = Math.ceil(x0); e <= x1; e += 1) {
      const x = X(10 ** e);
      sctx.beginPath();
      sctx.moveTo(x, top);
      sctx.lineTo(x, top + ph);
      sctx.stroke();
      sctx.textAlign = "center";
      sctx.textBaseline = "top";
      sctx.fillText(pow10(e), x, top + ph + 4);
    }
    for (let e = Math.ceil(y0); e <= y1; e += 1) {
      const y = Y(10 ** e);
      sctx.beginPath();
      sctx.moveTo(left, y);
      sctx.lineTo(left + pw, y);
      sctx.stroke();
      sctx.textAlign = "right";
      sctx.textBaseline = "middle";
      sctx.fillText(pow10(e), left - 5, y);
    }
    sctx.strokeStyle = c.divider;
    sctx.strokeRect(left + 0.5, top + 0.5, pw - 1, ph - 1);
    sctx.textAlign = "center";
    sctx.textBaseline = "top";
    sctx.fillText("photon energy E  [keV]", left + pw / 2, top + ph + 20);
    sctx.save();
    sctx.translate(11, top + ph / 2);
    sctx.rotate(-Math.PI / 2);
    sctx.textBaseline = "middle";
    sctx.fillText("νL_ν = 4πD² νF_ν  [erg s⁻¹]", 0, 0);
    sctx.restore();

    // selected energy
    const Esel = Math.pow(10, state.logE);
    if (Esel < sp.E[0] || Esel > sp.E[sp.E.length - 1]) {
      sctx.fillStyle = c.text;
      sctx.textBaseline = "top";
      sctx.textAlign = Esel < sp.E[0] ? "left" : "right";
      sctx.fillText(`${Esel < sp.E[0] ? "◀" : ""} E = ${fmtE(Esel)} ${Esel < sp.E[0] ? "" : "▶"}`, Esel < sp.E[0] ? left + 6 : left + pw - 6, top + 6);
    } else {
      sctx.strokeStyle = c.text;
      sctx.setLineDash([2, 3]);
      sctx.beginPath();
      sctx.moveTo(X(Esel), top);
      sctx.lineTo(X(Esel), top + ph);
      sctx.stroke();
      sctx.setLineDash([]);
    }

    // curves: ipole (solid, accent) and no relativistic effects (dashed, muted)
    const line = (vals, colour, dash) => {
      sctx.save();
      sctx.beginPath();
      sctx.rect(left, top, pw, ph);
      sctx.clip();
      sctx.strokeStyle = colour;
      sctx.lineWidth = 2;
      sctx.setLineDash(dash);
      sctx.beginPath();
      vals.forEach((v, k) => (k ? sctx.lineTo(X(sp.E[k]), Y(v)) : sctx.moveTo(X(sp.E[k]), Y(v))));
      sctx.stroke();
      sctx.restore();
    };
    line(sp.cls, c.text, [6, 4]);
    line(sp.rel, c.accent, []);

    // legend (always present for two series), above the plot
    sctx.textBaseline = "middle";
    sctx.textAlign = "left";
    let lx = left;
    let ly = 14;
    for (const [label, colour, dash] of [
      [LEGEND[0], c.accent, []],
      [LEGEND[1], c.text, [6, 4]],
    ]) {
      sctx.strokeStyle = colour;
      sctx.lineWidth = 2;
      sctx.setLineDash(dash);
      sctx.beginPath();
      sctx.moveTo(lx, ly);
      sctx.lineTo(lx + 22, ly);
      sctx.stroke();
      sctx.setLineDash([]);
      sctx.fillStyle = c.ink;
      sctx.fillText(label, lx + 28, ly);
      if (rows === 1) lx += 28 + sctx.measureText(label).width + 18;
      else ly += 16;
    }

    // hover crosshair
    if (hoverX !== undefined && hoverX >= left && hoverX <= left + pw) {
      const lx2 = x0 + ((hoverX - left) / pw) * (x1 - x0);
      const k = Math.round(((lx2 - x0) / (x1 - x0)) * (sp.E.length - 1));
      sctx.strokeStyle = c.ink;
      sctx.lineWidth = 1;
      sctx.beginPath();
      sctx.moveTo(X(sp.E[k]), top);
      sctx.lineTo(X(sp.E[k]), top + ph);
      sctx.stroke();
      for (const [v, colour] of [[sp.rel[k], c.accent], [sp.cls[k], c.text]]) {
        sctx.fillStyle = colour;
        sctx.strokeStyle = c.bg;
        sctx.lineWidth = 2;
        sctx.beginPath();
        sctx.arc(X(sp.E[k]), Y(v), 4.5, 0, 2 * Math.PI);
        sctx.fill();
        sctx.stroke();
      }
      showTip(
        $("disk-spectrum-tip"),
        `E = ${fmtE(sp.E[k])}<br><span class="tip-swatch solid"></span>ipole: ${sci(sp.rel[k], 3)} erg s⁻¹<br><span class="tip-swatch dashed"></span>flat: ${sci(sp.cls[k], 3)} erg s⁻¹`,
        X(sp.E[k]),
        Math.min(Y(sp.rel[k]), Y(sp.cls[k])),
        W,
      );
    } else {
      hideTip($("disk-spectrum-tip"));
    }
  }

  function showTip(tip, html, x, y, W) {
    tip.innerHTML = html;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(4, x + 12), W - tw - 4)}px`;
    tip.style.top = `${Math.max(4, y - tip.offsetHeight - 8)}px`;
  }
  const hideTip = (tip) => {
    tip.hidden = true;
  };

  // ------------------------------------------------------------ readouts

  function fmtE(e) {
    if (e >= 1) return `${+e.toPrecision(3)} keV`;
    if (e >= 1e-3) return `${+(e * 1e3).toPrecision(3)} eV`;
    return `${+(e * 1e6).toPrecision(3)} meV`;
  }

  function updateReadouts() {
    const d = derived;
    const sc = d.sc;
    const eta = 1 - iscoEnergy(d.a);
    const L = eta * sc.Mdot * CL * CL;
    $("disk-rplus").textContent = horizon(d.a).toFixed(3);
    $("disk-risco").textContent = d.risco.toFixed(3);
    $("disk-eta").textContent = eta.toFixed(3);
    $("disk-mdot").textContent = sci((sc.Mdot * YEAR) / MSUN, 3);
    $("disk-lum").textContent = `${sci(L, 3)} (${sci(L / sc.LEdd, 2)} L_Edd)`;
    $("disk-tmax").textContent = `${sci(d.Tpeak, 3)} at ${d.rpeak.toFixed(2)}`;
    $("disk-ktc").textContent = fmtE((KBOL * state.fcol * d.Tpeak) / KEV);
    $("disk-grange").textContent = `${d.gmin.toFixed(2)} – ${d.gmax.toFixed(2)}`;
    $("disk-M-label").textContent = sci(Math.pow(10, state.logM), 3);
    $("disk-mdot-label").textContent = sci(Math.pow(10, state.logMdot), 3);
    $("disk-E-label").textContent = fmtE(Math.pow(10, state.logE));
    const peak = d.spectrum.E[d.spectrum.rel.indexOf(Math.max(...d.spectrum.rel))];
    $("disk-status").textContent =
      `ipole map a* = ${d.a}, i = ${index.incls[state.ii]}°: disk from the ISCO (${d.risco.toFixed(2)} GM/c²) to ${index.r_out} GM/c², ` +
      `redshift g from ${d.gmin.toFixed(2)} to ${d.gmax.toFixed(2)}; the spectrum peaks at ${fmtE(peak)}. Hover the image or the spectrum to read values.`;
  }

  // ------------------------------------------------------------ UI

  let physicsDirty = true;
  let pending = false;
  function redraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(async () => {
      pending = false;
      const got = await ensureMaps();
      if (got === "stale") return; // a newer choice was made while this map loaded; its redraw draws
      if (got !== "ok") {
        derived = null;
        drawImage(got);
        drawSpectrum();
        return;
      }
      if (physicsDirty) {
        derive();
        physicsDirty = false;
      }
      drawImage();
      drawSpectrum();
      updateReadouts();
      drawn = `${mapsKey}|${JSON.stringify(state)}`;
    });
  }
  let drawn = ""; // what the last complete redraw showed (for tests)
  const touchPhysics = () => {
    physicsDirty = true;
    redraw();
  };

  async function loadFile(file) {
    if (cache.has(file)) return cache.get(file);
    if (loading.has(file)) return loading.get(file);
    const job = fetchMaps(file);
    loading.set(file, job);
    try {
      return await job;
    } finally {
      loading.delete(file);
    }
  }
  const loading = new Map();
  async function fetchMaps(file) {
    const res = await fetch(DATA + file, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    let buf = await res.arrayBuffer();
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) {
      // gzip, unless the server already decoded it
      buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    }
    const n = index.npix * index.npix;
    const u = new Uint16Array(buf);
    if (u.length !== 3 * n) throw new Error(`${file}: unexpected size`);
    const g = new Float32Array(n);
    const r = new Float32Array(n);
    const mu = new Float32Array(n);
    for (let k = 0; k < n; k += 1) {
      g[k] = (u[k] / 65535) * index.ranges.g;
      r[k] = (u[n + k] / 65535) * index.ranges.r;
      mu[k] = (u[2 * n + k] / 65535) * index.ranges.mu;
    }
    const m = { g, r, mu };
    cache.set(file, m);
    return m;
  }

  // Makes `maps` the ipole maps of the chosen (a*, i). Returns "ok"; "stale" if the choice changed
  // while they loaded (then nothing is drawn: the newer choice's own redraw draws); or the message to
  // show if they are missing or could not be loaded.
  let mapsKey = null;
  const currentKey = () =>
    `a${index.spins[state.ai] >= 0 ? "+" : ""}${index.spins[state.ai].toFixed(3)}_i${String(index.incls[state.ii]).padStart(2, "0")}`;
  async function ensureMaps() {
    const key = currentKey();
    if (mapsKey === key) return "ok";
    const file = index.files[key];
    if (!file) {
      maps = null;
      mapsKey = null;
      const msg = `The ipole map for a* = ${index.spins[state.ai]}, i = ${index.incls[state.ii]}° has not been rendered.`;
      $("disk-status").textContent = msg;
      return msg;
    }
    if (!cache.has(file)) $("disk-status").textContent = "Loading the ipole map…";
    try {
      const m = await loadFile(file);
      if (currentKey() !== key) return "stale";
      maps = m;
      mapsKey = key;
      physicsDirty = true;
      return "ok";
    } catch (error) {
      if (currentKey() !== key) return "stale";
      maps = null;
      mapsKey = null;
      const msg = `Could not load the ipole map (${error.message}).`;
      $("disk-status").textContent = msg;
      return msg;
    }
  }

  // Slider + number box. The slider may hold a transformed value (log10, grid index).
  function bind(key, { toBox, fromBox, digits = 3, physics = true }) {
    const range = $(`disk-${key}`);
    const box = $(`disk-${key}-num`);
    const set = (value, from) => {
      const min = parseFloat(range.min);
      const max = parseFloat(range.max);
      state[key] = Math.min(max, Math.max(min, value));
      if (from !== range) range.value = state[key];
      range.style.setProperty("--fill", `${(100 * (state[key] - min)) / (max - min)}%`);
      if (from !== box) box.value = toBox ? toBox(state[key]) : state[key].toFixed(digits);
      if (physics) touchPhysics();
      else redraw();
    };
    range.addEventListener("input", () => set(parseFloat(range.value), range));
    box.addEventListener("change", () => {
      const v = fromBox ? fromBox(box.value) : parseFloat(box.value);
      if (Number.isFinite(v)) set(v, null);
      else box.value = toBox ? toBox(state[key]) : state[key].toFixed(digits);
    });
    return set;
  }

  const nearestIndex = (list, v) => list.reduce((best, x, k) => (Math.abs(x - v) < Math.abs(list[best] - v) ? k : best), 0);
  const sig = (x, n) => String(+x.toPrecision(n));

  function segmented(groupId, key, physics) {
    const buttons = root.querySelectorAll(`#${groupId} button`);
    const select = (value) => {
      state[key] = isNaN(+value) ? value : +value;
      buttons.forEach((b) => {
        const on = b.dataset.value === String(value);
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      if (key === "show") root.querySelector("#disk-scale").hidden = !(value === "inu" || value === "bol");
      if (physics) touchPhysics();
      else redraw();
    };
    buttons.forEach((b) => b.addEventListener("click", () => select(b.dataset.value)));
    return select;
  }

  // Hover on the image: read one pixel.
  imgCanvas.addEventListener("mousemove", (ev) => {
    if (!layout || !derived) return;
    const rect = imgCanvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const { left, top, S } = layout;
    const tip = $("disk-image-tip");
    if (x < left || x >= left + S || y < top || y >= top + S) return hideTip(tip);
    const N = index.npix;
    const i = Math.floor(((x - left) / S) * N);
    const j = Math.floor(((y - top) / S) * N);
    const k = j * N + i;
    const al = ((i + 0.5) / N - 0.5) * index.fov;
    const be = (0.5 - (j + 0.5) / N) * index.fov;
    let html = `α = ${al.toFixed(1)}, β = ${be.toFixed(1)} GM/c²<br>`;
    if (!(derived.Tobs[k] > 0)) {
      html += "no disk emission on this ray";
    } else {
      const nu = (Math.pow(10, state.logE) * KEV) / HPL;
      html +=
        `emitted at r = ${maps.r[k].toFixed(2)} GM/c²<br>g = ${maps.g[k].toFixed(3)}, cos θ_em = ${maps.mu[k].toFixed(2)}<br>` +
        `I_ν = ${sci(derived.wt[k] * planck(nu, derived.Tobs[k]), 3)} erg s⁻¹ cm⁻² Hz⁻¹ sr⁻¹`;
    }
    showTip(tip, html, x, y, rect.width);
  });
  imgCanvas.addEventListener("mouseleave", () => hideTip($("disk-image-tip")));
  specCanvas.addEventListener("mousemove", (ev) => {
    if (!derived) return;
    const rect = specCanvas.getBoundingClientRect();
    drawSpectrum(ev.clientX - rect.left);
  });
  specCanvas.addEventListener("mouseleave", () => drawSpectrum());

  async function init() {
    try {
      const res = await fetch(`${DATA}index.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      index = await res.json();
    } catch (error) {
      $("disk-status").textContent = `Could not load the ipole maps (${error.message}).`;
      return;
    }
    if (!("DecompressionStream" in window)) {
      $("disk-status").textContent = "This browser cannot unpack the ipole maps (it lacks DecompressionStream); please use a recent browser.";
      return;
    }
    $("disk-ai").max = index.spins.length - 1;
    $("disk-ii").max = index.incls.length - 1;
    state.ai = index.spins.indexOf(index.default.a);
    state.ii = index.incls.indexOf(index.default.i);

    bind("ai", { toBox: (k) => index.spins[k].toFixed(3), fromBox: (s) => nearestIndex(index.spins, parseFloat(s)) })(state.ai, null);
    bind("ii", { toBox: (k) => String(index.incls[k]), fromBox: (s) => nearestIndex(index.incls, parseFloat(s)) })(state.ii, null);
    const setM = bind("logM", { toBox: (v) => sig(Math.pow(10, v), 3), fromBox: (s) => Math.log10(parseFloat(s)) });
    const setMdot = bind("logMdot", { toBox: (v) => sig(Math.pow(10, v), 3), fromBox: (s) => Math.log10(parseFloat(s)) });
    const setE = bind("logE", { toBox: (v) => sig(Math.pow(10, v), 3), fromBox: (s) => Math.log10(parseFloat(s)), physics: false });
    bind("fcol", { digits: 2 })(state.fcol, null);
    setM(state.logM, null);
    setMdot(state.logMdot, null);
    setE(state.logE, null);

    segmented("disk-show", "show", false)(state.show);
    segmented("disk-scale", "scale", false)(state.scale);
    segmented("disk-limb", "limb", true)(state.limb);

    root.querySelectorAll("[data-disk-preset]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const p = btn.dataset.diskPreset;
        if (p === "xrb") {
          setM(1, null);
          setMdot(-1, null);
          setE(0, null);
        } else if (p === "agn") {
          setM(8, null);
          setMdot(-1, null);
          setE(-2, null);
        } else if (p === "peak" && derived) {
          const sp = derived.spectrum;
          setE(Math.log10(sp.E[sp.rel.indexOf(Math.max(...sp.rel))]), null);
        }
      }),
    );

    document.addEventListener("themechange", redraw);
    if (window.ResizeObserver) new ResizeObserver(redraw).observe(imgCanvas);
    window.addEventListener("resize", redraw);
    touchPhysics();
  }

  init();

  // Exposed for checking numbers from the browser console.
  window.Disk = {
    state, iscoRadius, iscoEnergy, krolikc, temperature, scales, planck, pixelValue,
    get derived() { return derived; }, get maps() { return maps; }, get index() { return index; },
    get drawn() { return drawn; }, get key() { return mapsKey; },
  };
})();
