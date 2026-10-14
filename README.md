# mraianeto.github.io

Personal academic website of Mário Raia Neto, live at <https://mraianeto.github.io>.

It looks like the [al-folio](https://github.com/alshedivat/al-folio) Jekyll theme, but it is plain HTML, CSS and JavaScript: no Ruby, no Jekyll, no build step. GitHub Pages serves the files as they are (the empty `.nojekyll` file turns Jekyll off).

## Structure

```
index.html                    about page: bio, news, selected publications, "Fun: Kerr Geodesics"
publications/index.html       publications, rendered from assets/bibliography/papers.bib
studies/index.html            reports and notes, rendered from assets/bibliography/studies.bib
cv/index.html                 CV, rendered from assets/json/cv.json
404.html                      "page not found" + redirects from the old addresses (/cv.html, /assets/cv.pdf, ...)
assets/
  bibliography/papers.bib     publications (al-folio's papers.bib format)
  bibliography/studies.bib    reports / study notes
  json/cv.json                CV data (al-folio's _data/cv.yml schema, as JSON)
  css/main.css                al-folio styles ported to plain CSS (+ the Kerr widget)
  js/theme.js                 light / dark / system theme toggle
  js/common.js                mobile menu, ABS/BIB buttons, footer year
  js/bibliography.js          BibTeX -> al-folio publication list
  js/cv.js                    cv.json -> al-folio CV cards
  js/kerr-geodesics.js        Kerr geodesic widget
  img/                        profile photo, favicon, figures
  img/publication_preview/    thumbnails for publications
  pdf/                        CV and paper PDFs
  fonts/                      K22 Gadget (currently unused)
```

Bootstrap 4.6.2, MDB 4.20.0, Font Awesome 6.5.2, Academicons 1.9.4 and MathJax 3.2.2 are loaded from CDNs with pinned versions, the same libraries al-folio uses.

## Common edits

- **News:** in `index.html`, copy a `<tr>` in the news table to the top and change the date and text.
- **New paper:** add a BibTeX entry to `assets/bibliography/papers.bib`. The comment at the top of that file lists the extra fields (`abbr`, `abstract`, `arxiv`, `pdf`, `preview`, `bibtex_show`, `selected`, ...). Put the PDF in `assets/pdf/` and the thumbnail in `assets/img/publication_preview/`. `selected = {true}` also shows it on the about page.
- **New report / study:** same, in `assets/bibliography/studies.bib`.
- **CV:** edit `assets/json/cv.json`, and replace `assets/pdf/cv.pdf` with the new PDF. Section types are `map`, `time_table`, `list` and `nested_list` (as in al-folio); strings may contain HTML. JSON does not allow trailing commas.
- **Bio, photo, links:** in `index.html`. The navbar and footer are repeated in each page, so a new menu item has to be added to all five HTML files.
- **Colours:** the `:root` (light) and `html[data-theme="dark"]` blocks at the top of `assets/css/main.css`. Both themes use al-folio's cyan `#2698ba` as the accent colour.

## Preview locally

The pages use absolute paths (`/assets/...`) and load data with `fetch`, so open them through a local server, not by double-clicking the file:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Kerr geodesics widget

The integration is a JavaScript port of the single-geodesic part of the Wolfram code PP_Kerr_vWolfram_Equatorial.wl (integrarGeodesica, metricaInversa and its derivatives, criarCovetor, calcularConstantes, potencialRadial, haRetornoExterior; the Penrose process is not included). It integrates Hamilton's equations for H = ½ g^{μν} p_μ p_ν in Boyer–Lindquist coordinates and Mino time, stops at r₊ + 10⁻³ M, at r_escape or near the poles, and uses an adaptive Dormand–Prince 5(4) scheme with the notebook's NDSolve settings (accuracy and precision goals 10, maximum step 1/500 of the interval). Checked against the Wolfram code itself: endpoints agree to about 1e-9. Photon orbits, ISCOs (Bardeen, Press & Teukolsky 1972), critical impact parameters and the capture band are computed in closed form. The geodesic starts on the equator at the chosen point (t₀, r₀, φ₀) moving inward, with the chosen E and L (or b for photons); p_r follows from the mass shell and the integration runs forward in Mino time. `window.Kerr` exposes the functions in the browser console.

## Credits

Design: [al-folio](https://github.com/alshedivat/al-folio) (MIT License). Theme-toggle icons: [Tabler Icons](https://tabler.io/icons) (MIT License).
