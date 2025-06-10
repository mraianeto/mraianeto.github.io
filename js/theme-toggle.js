document.addEventListener("DOMContentLoaded", () => {
    // --- ELEMENTOS GLOBAIS ---
    const toggleBtn = document.getElementById("theme-toggle");
    const hamburger = document.getElementById("hamburger");
    const menu = document.getElementById("page-links");
    const overlay = document.querySelector(".overlay"); // Pega o novo elemento

    // --- LÓGICA DO TEMA ---
    const applyTheme = (theme) => {
        document.documentElement.setAttribute("data-theme", theme);
        if (toggleBtn) {
            toggleBtn.textContent = theme === "dark" ? "☀️" : "🌙";
        }
    };

    const savedTheme = localStorage.getItem("theme") || "dark";
    applyTheme(savedTheme);

    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            const currentTheme = document.documentElement.getAttribute("data-theme");
            const newTheme = currentTheme === "dark" ? "light" : "dark";
            localStorage.setItem("theme", newTheme);
            applyTheme(newTheme);
        });
    }

    // --- LÓGICA DO MENU HAMBÚRGUER E OVERLAY (ATUALIZADA) ---
    if (hamburger && menu && overlay) {
        const toggleMenu = () => {
            const isMenuOpen = menu.classList.toggle('show');
            overlay.classList.toggle('show');
            hamburger.textContent = isMenuOpen ? "✖" : "☰";
        };

        hamburger.addEventListener('click', toggleMenu);
        overlay.addEventListener('click', toggleMenu); // Fecha o menu ao clicar no overlay
    }


    // --- LÓGICA PARA CAIXAS DE PUBLICAÇÕES ---
    const publicationToggles = document.querySelectorAll('.pub-btn[data-target]');
    publicationToggles.forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            const targetId = button.dataset.target;
            const targetBox = document.getElementById(targetId);
            if (!targetBox) return;
            const isAlreadyActive = targetBox.classList.contains('show');
            document.querySelectorAll('.hidden-box.show').forEach(openBox => {
                openBox.classList.remove('show');
            });
            if (!isAlreadyActive) {
                targetBox.classList.add('show');
            }
        });
    });
});