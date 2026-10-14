// Renders BibTeX files as al-folio publication lists (replaces jekyll-scholar).
//
// Usage:
//   <div class="publications" data-bib="/assets/bibliography/papers.bib"
//        data-group-by="year" data-selected-only></div>
//
//   data-bib            one or more .bib URLs, comma separated
//   data-group-by       "year" (default) adds year headings; "none" gives a flat list
//   data-selected-only  only entries with selected = {true}
(function () {
  // Author names highlighted as "you" (underlined), like al-folio's scholar.last_name/first_name.
  const SELF = { last: ["Raia Neto"], first: ["Mário", "M."] };

  const PREVIEW_DIR = "/assets/img/publication_preview/";
  const PDF_DIR = "/assets/pdf/";

  // Fields that drive the page and are hidden from the BIB box (al-folio filtered_bibtex_keywords).
  const CUSTOM_FIELDS = new Set([
    "abbr", "abstract", "additional_info", "altmetric", "annotation", "arxiv", "award", "award_name",
    "bibtex_show", "blog", "code", "dimensions", "google_scholar_id", "hal", "html", "inspirehep_id",
    "pdf", "pmid", "poster", "preview", "preview_dark", "selected", "slides", "supp", "video", "website",
  ]);

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  // ---------------------------------------------------------------- parsing

  // Returns [{ type, key, fields: { name: { value, raw } } }] in file order.
  function parseBibtex(src) {
    const entries = [];
    let i = 0;
    while ((i = src.indexOf("@", i)) !== -1) {
      const head = /^@\s*([A-Za-z]+)\s*([{(])/.exec(src.slice(i));
      if (!head) {
        i += 1;
        continue;
      }
      const type = head[1].toLowerCase();
      const close = head[2] === "{" ? "}" : ")";
      let j = i + head[0].length;
      if (type === "comment" || type === "preamble" || type === "string") {
        i = skipBalanced(src, j - 1);
        continue;
      }
      const comma = src.indexOf(",", j);
      if (comma === -1) break;
      const key = src.slice(j, comma).trim();
      j = comma + 1;
      const fields = {};
      for (;;) {
        while (j < src.length && /[\s,]/.test(src[j])) j += 1;
        if (j >= src.length || src[j] === close) break;
        const eq = src.indexOf("=", j);
        if (eq === -1) break;
        const name = src.slice(j, eq).trim().toLowerCase();
        j = eq + 1;
        while (/\s/.test(src[j])) j += 1;
        const start = j;
        if (src[j] === "{") {
          j = skipBalanced(src, j);
        } else if (src[j] === '"') {
          j += 1;
          let depth = 0;
          while (j < src.length && !(src[j] === '"' && depth === 0 && src[j - 1] !== "\\")) {
            if (src[j] === "{") depth += 1;
            if (src[j] === "}") depth -= 1;
            j += 1;
          }
          j += 1;
        } else {
          while (j < src.length && src[j] !== "," && src[j] !== close) j += 1;
        }
        const raw = src.slice(start, j).trim();
        fields[name] = { raw, value: unwrap(raw) };
      }
      entries.push({ type, key, fields });
      i = j + 1;
    }
    return entries;
  }

  // Index just after the {...} or (...) group that opens at `open`.
  function skipBalanced(src, open) {
    const [opening, closing] = src[open] === "(" ? ["(", ")"] : ["{", "}"];
    let depth = 0;
    for (let k = open; k < src.length; k += 1) {
      if (src[k] === opening) depth += 1;
      if (src[k] === closing) {
        depth -= 1;
        if (depth === 0) return k + 1;
      }
    }
    return src.length;
  }

  function unwrap(raw) {
    if ((raw[0] === "{" && raw.endsWith("}")) || (raw[0] === '"' && raw.endsWith('"'))) {
      return raw.slice(1, -1).replace(/\s+/g, " ").trim();
    }
    return raw;
  }

  // ------------------------------------------------------------ LaTeX text

  const ACCENTS = {
    "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃", "=": "̄", ".": "̇",
    u: "̆", v: "̌", H: "̋", c: "̧", k: "̨", r: "̊",
  };
  const SYMBOLS = { ss: "ß", o: "ø", O: "Ø", aa: "å", AA: "Å", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", l: "ł", L: "Ł" };

  function latexToText(s) {
    const base = (ch) => (ch === "\\i" ? "i" : ch === "\\j" ? "j" : ch);
    return s
      .replace(/\\([`'^"~=.])\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|(\\[ij]|[A-Za-z]))/g, (m, acc, a, b) => base(a || b) + ACCENTS[acc])
      .replace(/\\([uvHckr])\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|\s+(\\[ij]|[A-Za-z]))/g, (m, acc, a, b) => base(a || b) + ACCENTS[acc])
      .replace(/\\(ss|aa|AA|ae|AE|oe|OE|o|O|l|L)(?![A-Za-z])\s*/g, (m, name) => SYMBOLS[name])
      .replace(/\\([&%_$#])/g, "$1")
      .replace(/---/g, "—")
      .replace(/--/g, "–")
      .replace(/~/g, " ")
      .replace(/[{}]/g, "")
      .normalize("NFC");
  }

  // ------------------------------------------------------------- authors

  function splitTopLevel(s, separator) {
    const parts = [];
    let depth = 0;
    let last = 0;
    for (let k = 0; k < s.length; k += 1) {
      if (s[k] === "{") depth += 1;
      else if (s[k] === "}") depth -= 1;
      else if (depth === 0 && s.startsWith(separator, k)) {
        parts.push(s.slice(last, k));
        last = k + separator.length;
        k = last - 1;
      }
    }
    parts.push(s.slice(last));
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  function parseAuthors(field) {
    return splitTopLevel(field, " and ").map((name) => {
      const parts = splitTopLevel(name, ",");
      let first;
      let last;
      if (parts.length > 1) {
        last = parts[0];
        first = parts.slice(1).join(" ");
      } else {
        const words = splitTopLevel(name, " ");
        last = words.pop() || "";
        first = words.join(" ");
      }
      return { first: latexToText(first), last: latexToText(last) };
    });
  }

  const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  function isSelf(author) {
    return SELF.last.some((l) => fold(l) === fold(author.last)) && SELF.first.some((f) => fold(author.first).startsWith(fold(f).replace(/\.$/, "")));
  }

  // ----------------------------------------------------------- rendering

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  const text = (entry, name) => (entry.fields[name] ? latexToText(entry.fields[name].value) : "");
  const raw = (entry, name) => (entry.fields[name] ? entry.fields[name].value : "");
  const isTrue = (entry, name) => /^(true|yes|1)$/i.test(raw(entry, name));
  const url = (value, dir) => (/^[a-z]+:\/\//i.test(value) || value.startsWith("/") ? value : dir + value);

  function monthIndex(entry) {
    const m = fold(raw(entry, "month")).slice(0, 3);
    const byName = MONTHS.indexOf(m);
    if (byName !== -1) return byName;
    const n = parseInt(m, 10);
    return Number.isFinite(n) ? n - 1 : -1;
  }

  function authorsHtml(entry) {
    const authors = parseAuthors(raw(entry, "author"));
    return authors
      .map((a, k) => {
        const name = `${esc(a.first)} ${esc(a.last)}`.trim();
        let sep = "";
        if (k > 0) sep = authors.length > 2 ? ", " : " ";
        if (k > 0 && k === authors.length - 1) sep += "and ";
        return sep + (isSelf(a) ? `<em>${name}</em>` : name);
      })
      .join("");
  }

  function periodicalHtml(entry) {
    let venue = "";
    if (entry.type === "article") venue = text(entry, "journal");
    else if (["inproceedings", "incollection"].includes(entry.type)) venue = `In ${text(entry, "booktitle")}`;
    else if (["thesis", "mastersthesis", "phdthesis"].includes(entry.type)) venue = text(entry, "school");
    else if (entry.type === "techreport") venue = [text(entry, "type"), text(entry, "institution")].filter(Boolean).join(", ");
    else venue = text(entry, "howpublished");

    let html = venue ? `<em>${esc(venue)}</em>` : "";
    const place = text(entry, "location") || text(entry, "address");
    if (place) html += `${html ? ", " : ""}${esc(place)}`;
    const m = monthIndex(entry);
    const date = [m >= 0 ? MONTHS[m][0].toUpperCase() + MONTHS[m].slice(1) : "", text(entry, "year")].filter(Boolean).join(" ");
    if (date) html += `${html ? ", " : ""}${esc(date)}`;
    return html;
  }

  function button(label, href, cls) {
    if (!href) return `<a class="${cls} btn btn-sm z-depth-0" role="button" href="#">${label}</a>`;
    return `<a href="${esc(href)}" class="btn btn-sm z-depth-0" role="button" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }

  function bibtexSource(entry) {
    const lines = Object.entries(entry.fields)
      .filter(([name]) => !CUSTOM_FIELDS.has(name))
      .map(([name, f]) => `  ${name} = ${f.raw}`);
    return `@${entry.type}{${entry.key},\n${lines.join(",\n")}\n}`;
  }

  function previewHtml(entry) {
    const light = raw(entry, "preview");
    if (!light) return "";
    const dark = raw(entry, "preview_dark");
    const alt = esc(text(entry, "title"));
    const img = (src, cls) => `<img class="preview z-depth-1 rounded ${cls}" src="${esc(url(src, PREVIEW_DIR))}" alt="${alt}">`;
    return `<figure><picture>${dark ? img(light, "only-light") + img(dark, "only-dark") : img(light, "")}</picture></figure>`;
  }

  function entryHtml(entry) {
    const abbr = text(entry, "abbr");
    const links = [];
    if (raw(entry, "abstract")) links.push(button("Abs", null, "abstract"));
    if (raw(entry, "doi")) links.push(button("DOI", `https://doi.org/${raw(entry, "doi")}`));
    if (raw(entry, "arxiv")) links.push(button("arXiv", `https://arxiv.org/abs/${raw(entry, "arxiv")}`));
    if (isTrue(entry, "bibtex_show")) links.push(button("Bib", null, "bibtex"));
    if (raw(entry, "html")) links.push(button("HTML", raw(entry, "html")));
    if (raw(entry, "pdf")) links.push(button("PDF", url(raw(entry, "pdf"), PDF_DIR)));
    for (const [field, label] of [["supp", "Supp"], ["code", "Code"], ["poster", "Poster"], ["slides", "Slides"], ["website", "Website"]]) {
      if (raw(entry, field)) links.push(button(label, url(raw(entry, field), PDF_DIR)));
    }
    const note = text(entry, "note");

    return `<li>
  <div class="row bib-entry">
    <div class="col col-sm-2 abbr">
      ${abbr ? `<abbr class="badge rounded w-100">${esc(abbr)}</abbr>` : ""}
      ${previewHtml(entry)}
    </div>
    <div id="${esc(entry.key)}" class="col-sm-8">
      <div class="title">${esc(text(entry, "title"))}</div>
      <div class="author">${authorsHtml(entry)}</div>
      <div class="periodical">${periodicalHtml(entry)}</div>
      ${note ? `<div class="periodical">${esc(note)}</div>` : ""}
      <div class="links">${links.join("\n")}</div>
      ${raw(entry, "abstract") ? `<div class="abstract hidden"><p>${esc(text(entry, "abstract"))}</p></div>` : ""}
      ${isTrue(entry, "bibtex_show") ? `<div class="bibtex hidden"><figure class="highlight"><pre><code class="language-bibtex">${esc(bibtexSource(entry))}</code></pre></figure></div>` : ""}
    </div>
  </div>
</li>`;
  }

  function render(container, entries) {
    const groupByYear = (container.dataset.groupBy || "year") !== "none";
    let list = entries.map((entry, order) => ({ entry, order }));
    if (container.hasAttribute("data-selected-only")) list = list.filter(({ entry }) => isTrue(entry, "selected"));
    // Reverse chronological (year, then month), file order breaks ties.
    list.sort((a, b) => (parseInt(raw(b.entry, "year"), 10) || 0) - (parseInt(raw(a.entry, "year"), 10) || 0) || monthIndex(b.entry) - monthIndex(a.entry) || a.order - b.order);

    if (!list.length) {
      container.innerHTML = "<p>No entries yet.</p>";
      return;
    }
    if (!groupByYear) {
      container.innerHTML = `<ol class="bibliography">${list.map(({ entry }) => entryHtml(entry)).join("")}</ol>`;
      return;
    }
    let html = "";
    let year = null;
    for (const { entry } of list) {
      const y = text(entry, "year");
      if (y !== year) {
        if (year !== null) html += "</ol>";
        html += `<h2 class="bibliography">${esc(y)}</h2><ol class="bibliography">`;
        year = y;
      }
      html += entryHtml(entry);
    }
    container.innerHTML = `${html}</ol>`;
  }

  async function load(container) {
    const sources = container.dataset.bib.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      const texts = await Promise.all(
        sources.map(async (src) => {
          const response = await fetch(src);
          if (!response.ok) throw new Error(`${src}: HTTP ${response.status}`);
          return response.text();
        }),
      );
      render(container, texts.flatMap(parseBibtex));
    } catch (error) {
      container.innerHTML = `<p class="text-muted">Could not load the publication list (${esc(error.message)}).</p>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-bib]").forEach(load);
  });

  // Exposed for testing in the browser console.
  window.Bibliography = { parseBibtex, latexToText, parseAuthors };
})();
