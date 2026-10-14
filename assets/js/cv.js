// Renders assets/json/cv.json as al-folio CV cards (replaces _layouts/cv.liquid).
//
// The JSON follows al-folio's _data/cv.yml: a list of sections
//   { "title": ..., "type": "map" | "time_table" | "list" | "nested_list", "contents": [...] }
// Two small additions: a section may have an "intro" paragraph, and a time_table
// may contain { "subheading": "..." } rows. Strings may contain HTML.
(function () {
  const items = (list, cls) =>
    `<ul class="${cls}">${list
      .map((item) =>
        item && item.contents
          ? `<li><span class="item-title">${item.title}</span><ul class="subitems">${item.contents.map((s) => `<li><span class="subitem">${s}</span></li>`).join("")}</ul></li>`
          : `<li><span class="item">${item}</span></li>`,
      )
      .join("")}</ul>`;

  function linkButtons(links, nameKey) {
    return links
      .filter((item) => item.link)
      .map(
        (item) =>
          `<div class="container-link-button"><a href="${item.link}" target="_blank" rel="noopener noreferrer" class="btncv z-depth-0">${item[nameKey] || "doc"}</a></div>`,
      )
      .join("");
  }

  function map(entry) {
    const rows = entry.contents
      .map((c) => {
        let value = "";
        if (c.value) value = `<td class="p-1 pl-2 font-weight-light text">${c.value}</td>`;
        if (c.links) value = `<td class="p-1 pl-2 font-weight-light text"><div class="container-pdf d-flex flex-wrap">${linkButtons(c.links, "name")}</div></td>`;
        return `<tr><td class="p-1 pr-2 font-weight-bold"><b>${c.name}</b></td>${value}</tr>`;
      })
      .join("");
    return `<table class="table table-cv table-sm table-borderless table-responsive">${rows}</table>`;
  }

  function list(entry) {
    return `<ul class="card-text font-weight-light list-group list-group-flush">${entry.contents.map((c) => `<li class="list-group-item">${c}</li>`).join("")}</ul>`;
  }

  function nestedList(entry) {
    return `<ul class="card-text font-weight-light list-group list-group-flush">${entry.contents
      .map((c) => `<li class="list-group-item"><h5 class="font-italic">${c.title}</h5>${c.items ? items(c.items, "subitems") : ""}</li>`)
      .join("")}</ul>`;
  }

  function timeTableItem(c) {
    if (c.subheading) return `<li class="list-group-item list-group-subheading">${c.subheading}</li>`;
    const date = c.year
      ? `<div class="col-xs-2 col-sm-2 col-md-2 text-center" style="width: 75px">
           <table class="table-cv"><tbody>
             <tr><td><span class="badge font-weight-bold danger-color-dark text-uppercase align-middle" style="min-width: 75px">${c.year}</span></td></tr>
             ${c.location ? `<tr><td><p class="location"><i class="fa-solid fa-location-dot iconlocation"></i> ${c.location}</p></td></tr>` : ""}
           </tbody></table>
         </div>`
      : "";
    const place =
      c.institution || c.department
        ? `<table class="table-cv ml-1 ml-md-4 institution"><tbody>
             ${c.institution ? `<tr><td style="vertical-align: top; text-align: center" class="institution"><i class="fa-solid fa-building-columns iconinstitution"></i></td><td class="institution">${c.institution}</td></tr>` : ""}
             ${c.department ? `<tr><td style="vertical-align: top; text-align: center" class="department"><i class="fa-regular fa-circle-dot icondepartment"></i></td><td class="department">${c.department}</td></tr>` : ""}
           </tbody></table>`
        : "";
    return `<li class="list-group-item">
      <div class="row">
        ${date}
        <div class="col-xs-10 col-sm-10 col-md-10 mt-2 mt-md-0">
          ${c.title ? `<h6 class="title font-weight-bold ml-1 ml-md-4">${c.title}</h6>` : ""}
          ${place}
          ${c.maindescription ? `<div class="ml-1 ml-md-4">${c.maindescription}</div>` : ""}
          ${c.description ? items(c.description, "items") : ""}
          ${c.items ? items(c.items, "items") : ""}
          ${c.linkitems ? `<div class="container-links ml-1 ml-md-4">${linkButtons(c.linkitems, "linkname")}</div>` : ""}
        </div>
      </div>
    </li>`;
  }

  function timeTable(entry) {
    return `<ul class="card-text font-weight-light list-group list-group-flush">${entry.contents.map(timeTableItem).join("")}</ul>`;
  }

  const RENDERERS = { map, list, nested_list: nestedList, time_table: timeTable };

  function render(container, sections) {
    container.innerHTML = sections
      .map((entry) => {
        const id = entry.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        const body = RENDERERS[entry.type] ? RENDERERS[entry.type](entry) : entry.contents;
        return `<a class="anchor" id="${id}"></a>
          <div class="card mt-3 p-3">
            <h3 class="card-title font-weight-medium">${entry.title}</h3>
            ${entry.intro ? `<p class="card-intro">${entry.intro}</p>` : ""}
            <div>${body}</div>
          </div>`;
      })
      .join("");
    // Jump to #section once the cards exist.
    if (window.location.hash) {
      const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const container = document.querySelector("[data-cv]");
    if (!container) return;
    try {
      const response = await fetch(container.dataset.cv);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(container, await response.json());
    } catch (error) {
      container.innerHTML = `<p>Could not load the CV (${error.message}). Download the <a href="/assets/pdf/cv.pdf">PDF</a> instead.</p>`;
    }
  });
})();
