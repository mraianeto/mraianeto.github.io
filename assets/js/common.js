// Behaviour shared by every page: mobile navbar, ABS/BIB toggles, footer year.
document.addEventListener("DOMContentLoaded", () => {
  // Navbar collapse on small screens (replaces Bootstrap's collapse plugin + jQuery).
  const toggler = document.querySelector(".navbar-toggler");
  const nav = document.getElementById("navbarNav");
  if (toggler && nav) {
    toggler.addEventListener("click", () => {
      const open = nav.classList.toggle("show");
      toggler.classList.toggle("collapsed", !open);
      toggler.setAttribute("aria-expanded", String(open));
    });
  }

  // Publication buttons: ABS and BIB open their box and close the other one
  // (al-folio common.js). Delegated, because entries are rendered by bibliography.js.
  document.addEventListener("click", (event) => {
    const button = event.target.closest("a.abstract, a.bibtex");
    if (!button) return;
    event.preventDefault();
    const entry = button.closest(".bib-entry");
    if (!entry) return;
    const target = button.classList.contains("abstract") ? "abstract" : "bibtex";
    const other = target === "abstract" ? "bibtex" : "abstract";
    const box = entry.querySelector(`.${target}.hidden`);
    const otherBox = entry.querySelector(`.${other}.hidden`);
    if (box) box.classList.toggle("open");
    if (otherBox) otherBox.classList.remove("open");
  });

  // Footer year.
  document.querySelectorAll("[data-current-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });
});
