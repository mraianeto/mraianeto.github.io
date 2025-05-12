document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.getElementById("theme-toggle");
  const hamburger = document.getElementById("hamburger");
  const menu = document.getElementById("page-links");

  // Só conecta se o botão existir (evita erros silenciosos)
  if (toggleBtn) {
    const currentTheme = localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", currentTheme);
    toggleBtn.textContent = currentTheme === "dark" ? "☀️" : "🌙";

    toggleBtn.addEventListener("click", () => {
      const newTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      toggleBtn.textContent = newTheme === "light" ? "☀️" : "🌙";
    });
  }

  if (hamburger && menu) {
    hamburger.addEventListener("click", () => {
      menu.classList.toggle("show");
      hamburger.textContent = menu.classList.contains("show") ? "✖" : "☰";
    });
  }
 

});
