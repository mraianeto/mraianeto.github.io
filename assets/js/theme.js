// Light / dark / system theme, as in al-folio.
// Loaded in <head> without `defer`, so the right theme is set before the first paint.
// Other scripts can listen for the "themechange" event (detail: { theme: "light" | "dark" }).
(function () {
  const STORAGE_KEY = "theme";
  const SETTINGS = ["system", "light", "dark"];
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;

  function readSetting() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (SETTINGS.includes(saved)) return saved;
    } catch (e) {
      // localStorage can be unavailable (private mode, blocked storage).
    }
    return "system";
  }

  function computedTheme(setting) {
    if (setting === "system") return darkQuery.matches ? "dark" : "light";
    return setting;
  }

  function apply(setting, animate) {
    const theme = computedTheme(setting);
    if (animate) {
      root.classList.add("transition");
      window.setTimeout(() => root.classList.remove("transition"), 500);
    }
    root.setAttribute("data-theme-setting", setting);
    root.setAttribute("data-theme", theme);
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  }

  // Cycle system -> light -> dark -> system, like al-folio's toggle.
  function toggle() {
    const next = { system: "light", light: "dark", dark: "system" }[readSetting()];
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {}
    apply(next, true);
  }

  apply(readSetting(), false);

  darkQuery.addEventListener("change", () => apply(readSetting(), true));

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("light-toggle");
    if (button) button.addEventListener("click", toggle);
  });
})();
