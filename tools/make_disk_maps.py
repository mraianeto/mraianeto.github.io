#!/usr/bin/env python3
"""ipole maps for the "Fun: Black Hole Accretion Disks" widget (assets/js/accretion-disk.js).

For every (spin a*, inclination i) of the grid, ipole renders a Novikov-Thorne thin disk once, in the
packed output mode 4 of the model thin_disk_web (a copy of the seminar model thin_disk_talk with one more
mode). Each pixel then carries, for the ray that ipole traced back to the disk:
    g   = nu_obs / nu_emit      (Doppler + gravitational redshift, light bending included)
    r   = emission radius       [GM/c^2]
    mu  = |cos| of the emission angle to the disk normal, in the fluid frame
The browser evaluates ipole's own mode-0 emission formula on these maps,
    I_nu = g^3 f^-4 B_nu(nu/g, f T(r)) [x Chandrasekhar limb darkening(mu)],   T = NT73 profile,
so mass, accretion rate, photon energy, colour correction and limb darkening are free sliders without new
ipole runs. `check` compares this with direct ipole mode-0 images.

    python3 tools/make_disk_maps.py run      # ipole runs -> RUNS (skips existing ones)
    python3 tools/make_disk_maps.py pack     # RUNS -> assets/data/disk/*.dat + index.json
    python3 tools/make_disk_maps.py check    # direct ipole mode-0 images vs the maps

The ipole source and build live with the seminar decks:
  ~/Desktop/AccretionDisksRadiativePresentation/presentation/00sstyle/00style_ipole/
    ipole/model/thin_disk_web/   model (modes 0-3 identical to thin_disk_talk; 4 = packed r, mu, g)
    build_web/ipole              make -f ../ipole/makefile MODEL=thin_disk_web
"""
import gzip
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

SITE = Path(__file__).resolve().parents[1]
OUT = SITE / "assets" / "data" / "disk"
IPOLE_DIR = Path.home() / "Desktop/AccretionDisksRadiativePresentation/presentation/00sstyle/00style_ipole"
EXE = IPOLE_DIR / "build_web" / "ipole"
CHANDRA = IPOLE_DIR / "ipole" / "model" / "thin_disk_web" / "ch24_vals.txt"
RUNS = SITE.parent / "disk_runs"          # HDF5 outputs, outside the repository
ENV = dict(os.environ, MALLOC_MMAP_THRESHOLD_="268435456")

SPINS = [0.0, 0.3, 0.5, 0.7, 0.9, 0.99, 0.998]      # prograde disks only
INCLS = [5, 20, 35, 50, 65, 75, 85]
DEFAULT = (0.9, 65)
NPIX = 320
FOV = 44.0            # [GM/c^2], square field of view
ROUT = 20.0           # outer disk edge [GM/c^2]; inner edge = ISCO
KEV_HZ = 2.417989e17
BASE = dict(rcam=1000, dsource=0.05, freqcgs=KEV_HZ, MBH=10, Mdot=0.1, limb=0, fcol=1.0,
            mode=4, nx=NPIX, ny=NPIX, dx=FOV, dy=FOV, rout_disk=ROUT)
# 16-bit storage ranges (pixel value = round(65535 x / range)); g < 2.5 and mu <= 1 everywhere
G_RANGE, R_RANGE, MU_RANGE = 2.5, 1.05 * ROUT, 1.0


def name(a, i):
    return f"a{a:+.3f}_i{i:02d}"


def grid():
    """Default first, then the rest of the default spin's row, then the other spins."""
    first = [DEFAULT] + [(DEFAULT[0], i) for i in INCLS if i != DEFAULT[1]]
    return first + [(a, i) for a in SPINS for i in INCLS if a != DEFAULT[0]]


def run_one(a, i, extra=None, tag=None):
    RUNS.mkdir(exist_ok=True)
    chandra = RUNS / "ch24_vals.txt"      # the model reads this table from the working directory
    if not chandra.exists():
        chandra.write_text(CHANDRA.read_text())
    out = RUNS / f"{tag or name(a, i)}.h5"
    if out.exists():
        return out
    # ipole stops if any ray needs more steps than maxnstep, so a finished image is complete. It
    # allocates and zeroes maxnstep steps per ray, so try 12000 first and 40000 only if that is
    # not enough (near-polar rays at small i, high spin).
    for maxnstep in (12000, 40000):
        p = dict(BASE, a=a, thetacam=i, maxnstep=maxnstep)
        p.update(extra or {})
        cmd = [str(EXE), "-unpol"] + [f"--{k}={v}" for k, v in p.items()] + [f"--outfile={out.name}"]
        t = time.time()
        with open(out.with_suffix(".log"), "w") as log:
            rc = subprocess.run(cmd, cwd=RUNS, env=ENV, stdout=log, stderr=subprocess.STDOUT).returncode
        print(f"{out.stem:22s} maxnstep={maxnstep:5d} exit={rc}  {time.time() - t:6.1f} s", flush=True)
        if rc == 0:
            return out
        out.unlink(missing_ok=True)
        if "MaxNStep exceeded" not in out.with_suffix(".log").read_text(errors="replace"):
            break
    raise SystemExit(f"ipole failed for {out.stem}, see {out.with_suffix('.log')}")


def decode(path):
    """ipole mode-4 file -> (g, r, mu), arrays in screen order (row 0 = top), shape (ny, nx)."""
    import h5py
    with h5py.File(path, "r") as f:
        V = f["unpol"][()].T[::-1]          # ipole: plot unpol.T with origin lower
    Vi = np.floor(V)
    g = 4.0 * (V - Vi)
    R = np.floor(Vi / 10001.0)
    C = Vi - R * 10001.0
    return g, R * 1e-4, C * 1e-4


def r_isco(a):
    z1 = 1 + (1 - a * a) ** (1 / 3) * ((1 + a) ** (1 / 3) + (1 - a) ** (1 / 3))
    z2 = np.sqrt(3 * a * a + z1 * z1)
    return float(3 + z2 - np.copysign(np.sqrt((3 - z1) * (3 + z1 + 2 * z2)), a))


def pack():
    OUT.mkdir(parents=True, exist_ok=True)
    files = {}
    for a, i in grid():
        h5 = RUNS / f"{name(a, i)}.h5"
        if not h5.exists():
            continue
        g, r, mu = decode(h5)
        assert g.max() < G_RANGE and r.max() < R_RANGE and mu.max() <= MU_RANGE, (a, i, g.max(), r.max())
        q = lambda x, rng: np.round(np.clip(x, 0, rng) / rng * 65535).astype("<u2")
        raw = q(g, G_RANGE).tobytes() + q(r, R_RANGE).tobytes() + q(mu, MU_RANGE).tobytes()
        fn = f"{name(a, i)}.dat"
        (OUT / fn).write_bytes(gzip.compress(raw, 9, mtime=0))
        files[name(a, i)] = fn
    index = dict(
        about="ipole (Moscibrodzka & Gammie 2018) Novikov-Thorne disk maps, model thin_disk_web mode 4; "
              "made by tools/make_disk_maps.py. Each .dat is gzip of three little-endian uint16 planes "
              "(g, r, mu), NPIX x NPIX each, row 0 = top of the image; value = round(65535 x / range).",
        npix=NPIX, fov=FOV, r_out=ROUT, rcam=BASE["rcam"], ranges=dict(g=G_RANGE, r=R_RANGE, mu=MU_RANGE),
        spins=SPINS, incls=INCLS, default=dict(a=DEFAULT[0], i=DEFAULT[1]),
        r_isco={f"{a:+.3f}": round(r_isco(a), 6) for a in SPINS},
        chandra=np.loadtxt(CHANDRA).round(6).tolist(),
        files=files,
    )
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    for old in OUT.glob("*.dat"):                # maps no longer in the grid
        if old.name not in files.values():
            old.unlink()
    total = sum((OUT / f).stat().st_size for f in files.values())
    print(f"packed {len(files)} maps, {total / 1e6:.1f} MB")


# ------------------------------------------------------------- check against direct ipole images
HPL, CL, KBOL, SIG = 6.6260693e-27, 2.99792458e10, 1.3806505e-16, 5.670400e-5
GNEWT, MP, MSUN, SIGMA_T = 6.6742e-8, 1.67262171e-24, 1.989e33, 0.665245873e-24


def krolikc(r, a):
    y = np.sqrt(r); yms = np.sqrt(r_isco(a))
    y1 = 2 * np.cos((np.arccos(a) - np.pi) / 3); y2 = 2 * np.cos((np.arccos(a) + np.pi) / 3)
    y3 = -2 * np.cos(np.arccos(a) / 3)
    t = lambda yk, yl, ym: 3 * (yk - a) ** 2 / (y * yk * (yk - yl) * (yk - ym)) * np.log((y - yk) / (yms - yk))
    return 1 - yms / y - 3 * a / (2 * y) * np.log(y / yms) - t(y1, y2, y3) - t(y2, y1, y3) - t(y3, y1, y2)


def intensity(g, r, mu, a, MBH, mdot, nu, fcol, limb):
    """ipole thin_disk mode 0 (fbbpolemis) on the maps; zero outside r_in < r < r_out, as in ipole."""
    M = MBH * MSUN; L = GNEWT * M / CL ** 2
    Mdot = mdot * 4 * np.pi * GNEWT * M * MP / 0.1 / CL / SIGMA_T
    T0 = (3 / (8 * np.pi) * GNEWT * M * Mdot / L ** 3 / SIG) ** 0.25
    on = (r > r_isco(a)) & (r < ROUT) & (g > 0)
    rr = np.where(on, r, 10.0); gg = np.where(on, g, 1.0)
    T = T0 * (krolikc(rr, a) / (1 - 3 / rr + 2 * a / rr ** 1.5) / rr ** 3) ** 0.25
    nue = nu / gg
    B = 2 * HPL * nue ** 3 / CL ** 2 / np.expm1(HPL * nue / (KBOL * fcol * T))
    I = gg ** 3 * fcol ** -4 * B
    if limb:
        ch = np.loadtxt(CHANDRA)
        I = I * np.interp(np.minimum(mu, 1 - 1e-12), ch[:, 0], ch[:, 1])
    return np.where(on, I, 0.0)


def check():
    import h5py
    cases = [(0.9, 65, 10, 0.1, 1.0, 1.7, 1), (0.3, 35, 10, 0.3, 0.3, 1.0, 0), (0.998, 85, 1e8, 0.1, 0.005, 1.7, 1),
             (0.0, 5, 1e6, 0.01, 0.05, 2.0, 1)]
    res = []
    for a, i, MBH, mdot, ekev, fcol, limb in cases:
        tag = f"chk_{name(a, i)}_M{MBH:g}_m{mdot:g}_{ekev:g}keV_f{fcol:g}_l{limb}"
        h5 = run_one(a, i, dict(mode=0, MBH=MBH, Mdot=mdot, freqcgs=ekev * KEV_HZ, fcol=fcol, limb=limb), tag)
        with h5py.File(h5, "r") as f:
            I0 = f["unpol"][()].T[::-1]
        raw = gzip.decompress((OUT / f"{name(a, i)}.dat").read_bytes())
        planes = np.frombuffer(raw, "<u2").reshape(3, NPIX, NPIX).astype(float) / 65535
        g, r, mu = planes[0] * G_RANGE, planes[1] * R_RANGE, planes[2] * MU_RANGE
        I = intensity(g, r, mu, a, MBH, mdot, ekev * KEV_HZ, fcol, limb)
        bright = I0 > 1e-3 * I0.max()
        rel = np.abs(I - I0)[bright] / I0[bright]
        flux = I.sum() / I0.sum() - 1
        res.append(dict(case=tag, median_rel=float(np.median(rel)), p99_rel=float(np.percentile(rel, 99)),
                        total_flux_rel=float(flux)))
        print(f"{tag}: median |dI|/I = {np.median(rel):.1e}, 99th pct = {np.percentile(rel, 99):.1e}, "
              f"total flux {flux:+.1e}")
    (OUT / "check.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "run"
    if what == "run":
        for a, i in grid():
            run_one(a, i)
    elif what == "pack":
        pack()
    elif what == "check":
        check()
    else:
        raise SystemExit(__doc__)
