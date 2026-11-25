# mraianeto.github.io

Personal academic website of Mário Raia Neto, live at <https://mraianeto.github.io>.

It looks like the [al-folio](https://github.com/alshedivat/al-folio) Jekyll theme, but it is plain HTML, CSS and JavaScript: no Ruby, no Jekyll, no build step. GitHub Pages serves the files as they are (the empty `.nojekyll` file turns Jekyll off).

## Structure

```
index.html                    about page: bio, news, selected publications, "Fun: Kerr Geodesics",
                              "Fun: Black Hole Accretion Disks"
publications/index.html       publications, rendered from assets/bibliography/papers.bib
studies/index.html            reports, notes and talks, rendered from assets/bibliography/studies.bib
cv/index.html                 CV, rendered from assets/json/cv.json
404.html                      "page not found" + redirects from the old addresses (/cv.html, /assets/cv.pdf, ...)
assets/
  bibliography/papers.bib     publications (al-folio's papers.bib format)
  bibliography/studies.bib    reports / study notes
  json/cv.json                CV data (al-folio's _data/cv.yml schema, as JSON)
  css/main.css                al-folio styles ported to plain CSS (+ the Kerr widget)
  js/theme.js                 light / dark / system theme toggle
  js/common.js                mobile menu, ABS/BIB buttons, footer year
  js/bibliography.js          BibTeX -> al-folio publication list (+ the "Slides" box of talks)
  js/cv.js                    cv.json -> al-folio CV cards
  js/kerr-geodesics.js        Kerr geodesic widget
  js/accretion-disk.js        accretion-disk widget (ipole maps -> images and spectra)
  data/disk/                  ipole maps of the disk widget (index.json + one gzipped .dat per spin, inclination)
  img/                        profile photo, favicon, figures
  img/publication_preview/    thumbnails for publications
  pdf/                        CV and paper PDFs
  pdf/slides/                 slide decks (one talk, several versions: see slides_versions below)
  fonts/                      K22 Gadget (currently unused)
tools/make_disk_maps.py       makes assets/data/disk/ with ipole (see "Accretion disk widget" below)
```

Bootstrap 4.6.2, MDB 4.20.0, Font Awesome 6.5.2, Academicons 1.9.4 and MathJax 3.2.2 are loaded from CDNs with pinned versions, the same libraries al-folio uses.

## Common edits

- **News:** in `index.html`, copy a `<tr>` in the news table to the top and change the date and text.
- **New paper:** add a BibTeX entry to `assets/bibliography/papers.bib`. The comment at the top of that file lists the extra fields (`abbr`, `abstract`, `arxiv`, `pdf`, `preview`, `bibtex_show`, `selected`, ...). Put the PDF in `assets/pdf/` and the thumbnail in `assets/img/publication_preview/`. `selected = {true}` also shows it on the about page.
- **New report / study:** same, in `assets/bibliography/studies.bib`.
- **Talk with several versions of the slides:** in `studies.bib`, give the entry
  `slides_versions = {Full deck, 66 pages | slides/full.pdf ; 30 minutes, 34 pages | slides/30.pdf}`
  (files in `assets/pdf/`). The entry gets a **Slides** button and a box with a version picker, a PDF
  reader and Download / Open-in-a-new-tab links for the chosen version; the first version is shown first,
  and `slides_open = {true}` opens the box when the page loads. The seminar decks come from
  `~/Desktop/AccretionDisksRadiativePresentation/presentation/00sstyle/00style_ipole/presentation_00style_white_ipole*.pdf`.
- **CV:** edit `assets/json/cv.json`, and replace `assets/pdf/cv.pdf` with the new PDF. Section types are `map`, `time_table`, `list` and `nested_list` (as in al-folio); strings may contain HTML. JSON does not allow trailing commas.
- **Bio, photo, links:** in `index.html`. The navbar and footer are repeated in each page, so a new menu item has to be added to all five HTML files.
- **Colours:** the `:root` (light) and `html[data-theme="dark"]` blocks at the top of `assets/css/main.css`. Both themes use al-folio's cyan `#2698ba` as the accent colour.

- **After changing any CSS or JS file:** bump the `?v=...` tag on its `<link>`/`<script>` in all five
  HTML files (search for `?v=`), so browsers that cached the old file load the new one.

## Preview locally

The pages use absolute paths (`/assets/...`) and load data with `fetch`, so open them through a local server, not by double-clicking the file:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Kerr geodesics widget

The integration is a JavaScript port of the single-geodesic part of the Wolfram code PP_Kerr_vWolfram_Equatorial.wl (integrarGeodesica, metricaInversa and its derivatives, criarCovetor, calcularConstantes, potencialRadial, haRetornoExterior; the Penrose process is not included). It integrates Hamilton's equations for H = ½ g^{μν} p_μ p_ν in Boyer–Lindquist coordinates and Mino time, stops at r₊ + 10⁻³ M, at r_escape or near the poles, and uses an adaptive Dormand–Prince 5(4) scheme with the notebook's NDSolve settings (accuracy and precision goals 10, maximum step 1/500 of the interval). Checked against the Wolfram code itself: endpoints agree to about 1e-9. Photon orbits, ISCOs (Bardeen, Press & Teukolsky 1972), critical impact parameters and the capture band are computed in closed form. The geodesic starts on the equator at the chosen point (t₀, r₀, φ₀) moving inward, with the chosen E and L (or b for photons); p_r follows from the mass shell and the integration runs forward in Mino time. `window.Kerr` exposes the functions in the browser console.

## Accretion disk widget

A Novikov–Thorne thin disk (inner edge at the ISCO, outer edge 20 GM/c², camera at 1000 GM/c²), for spins
0, 0.3, 0.5, 0.7, 0.9, 0.99, 0.998 and inclinations 5°–85° (49 maps). For each pair, ipole rendered the disk
once (320×320 pixels, model `thin_disk_web`, output mode 4) and stored, per pixel, the emission radius r, the
redshift g = ν_obs/ν_emit and the emission angle. `assets/js/accretion-disk.js` evaluates ipole's own
emission formula on these maps, I_ν = g³ f⁻⁴ B_ν(ν/g, f T(r)) [× Chandrasekhar limb darkening], so mass,
accretion rate, photon energy, colour correction and limb darkening are continuous controls. The spectrum
is the sum over pixels, next to the same disk in flat space without relativistic effects.

```bash
python3 tools/make_disk_maps.py run     # ipole runs -> ../disk_runs/ (outside the repo), skips existing ones
python3 tools/make_disk_maps.py pack    # -> assets/data/disk/*.dat + index.json
python3 tools/make_disk_maps.py check   # direct ipole mode-0 images vs the maps -> assets/data/disk/check.json
```

The ipole source and its build are with the seminar decks, in
`~/Desktop/AccretionDisksRadiativePresentation/presentation/00sstyle/00style_ipole/` (`ipole/model/thin_disk_web/`,
`build_web/ipole`). One map takes about 40 s on 12 cores (about 80 s when a ray needs more than 12000 steps,
at small inclination or high spin; the script retries with 40000). `check` agreement: median |ΔI|/I a few
1e-5, 99th percentile ≤ 6e-4, total flux 1e-6.

## Credits

Design: [al-folio](https://github.com/alshedivat/al-folio) (MIT License). Theme-toggle icons: [Tabler Icons](https://tabler.io/icons) (MIT License).
