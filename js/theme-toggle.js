document.addEventListener("DOMContentLoaded", () => {
    // --- ELEMENTOS GLOBAIS ---
    const toggleBtn = document.getElementById("theme-toggle");
    const hamburger = document.getElementById("hamburger");
    const menu = document.getElementById("page-links");
    const overlay = document.querySelector(".overlay");

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

    // --- LÓGICA DO MENU HAMBÚRGUER E OVERLAY ---
    if (hamburger && menu && overlay) {
        const toggleMenu = () => {
            const isMenuOpen = menu.classList.toggle('show');
            overlay.classList.toggle('show');
            hamburger.textContent = isMenuOpen ? "✖" : "☰";
        };

        hamburger.addEventListener('click', toggleMenu);
        overlay.addEventListener('click', toggleMenu);
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

    // --- GEODESIC SIMULATION SCRIPT ---
    const canvas = document.getElementById('simulationCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        const slider = document.getElementById('paramSlider');
        const input = document.getElementById('paramInput');
        const lightlikeBtn = document.getElementById('lightlikeBtn');
        const timelikeBtn = document.getElementById('timelikeBtn');
        const parameterLabel = document.getElementById('parameterLabel');
        const pathLegendLine = document.getElementById('path-legend-line');
        const pathLegendText = document.getElementById('path-legend-text');

        let geodesicMode = 'lightlike';
        const M = 1.0;
        const SCHWARZSCHILD_RADIUS = 2 * M;
        const PHOTON_SPHERE_RADIUS = 3 * M;
        const ISCO_RADIUS = 6 * M;
        const B_CRITICAL = 3 * Math.sqrt(3) * M;
        const L_ISCO = 2 * Math.sqrt(3) * M;
        const E_TIMELIKE_SCATTER = 1.05;
        
        let scale = 20;
        let centerX, centerY;

        function photonGeodesicSystem(u, params) {
            const d2u_dphi2 = 3 * params.M * u[0]**2 - u[0];
            return [u[1], d2u_dphi2];
        }
        
        function timelikeGeodesicSystem(u, params) {
            if (!params.L || params.L === 0) return [u[1], -u[0]];
            const d2u_dphi2 = params.M / (params.L**2) + 3 * params.M * u[0]**2 - u[0];
            return [u[1], d2u_dphi2];
        }

        function rk4Step(func, y, h, params) {
            const k1 = func(y, params).map(val => h * val);
            const k2 = func(y.map((val, i) => val + 0.5 * k1[i]), params).map(val => h * val);
            const k3 = func(y.map((val, i) => val + 0.5 * k2[i]), params).map(val => h * val);
            const k4 = func(y.map((val, i) => val + k3[i]), params).map(val => h * val);
            return y.map((val, i) => val + (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6);
        }

        function draw() {
            const size = 300;
            canvas.width = size;
            canvas.height = size;
            centerX = canvas.width / 2;
            centerY = canvas.height / 2;
            scale = canvas.width / 30; 
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw shadow, photon sphere, ISCO, and black hole
            ctx.beginPath();
            ctx.fillStyle = 'rgba(128, 128, 128, 0.3)';
            ctx.arc(centerX, centerY, B_CRITICAL * scale, 0, 2 * Math.PI);
            ctx.fill();
            ctx.beginPath();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = 'rgb(255, 208, 0)';
            ctx.lineWidth = 1.5;
            ctx.arc(centerX, centerY, PHOTON_SPHERE_RADIUS * scale, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.beginPath();
            ctx.setLineDash([8, 8]);
            ctx.strokeStyle = 'rgb(0, 224, 157)';
            ctx.lineWidth = 1.5;
            ctx.arc(centerX, centerY, ISCO_RADIUS * scale, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.beginPath();
            ctx.setLineDash([]);
            ctx.fillStyle = 'black';
            ctx.arc(centerX, centerY, SCHWARZSCHILD_RADIUS * scale, 0, 2 * Math.PI);
            ctx.fill();

            const value = parseFloat(input.value);
            let systemFunc, params, pathStyle, b_geom;

            if (geodesicMode === 'lightlike') {
                pathStyle = getComputedStyle(document.documentElement).getPropertyValue('--orange-accent');
                if (Math.abs(value - B_CRITICAL) < 0.0001) {
                    ctx.beginPath();
                    ctx.strokeStyle = pathStyle;
                    ctx.lineWidth = 2.5;
                    ctx.arc(centerX, centerY, PHOTON_SPHERE_RADIUS * scale, 0, 2 * Math.PI);
                    ctx.stroke();
                    return;
                }
                systemFunc = photonGeodesicSystem;
                b_geom = value;
                params = { M: M };
            } else { 
                pathStyle = getComputedStyle(document.documentElement).getPropertyValue('--slate-accent');
                 if (Math.abs(value - L_ISCO) < 0.01) {
                    ctx.beginPath();
                    ctx.strokeStyle = pathStyle;
                    ctx.lineWidth = 2.5;
                    ctx.arc(centerX, centerY, ISCO_RADIUS * scale, 0, 2 * Math.PI);
                    ctx.stroke();
                    return;
                }
                if (value === 0) {
                    ctx.beginPath();
                    ctx.strokeStyle = pathStyle;
                    ctx.lineWidth = 2.5;
                    ctx.moveTo(centerX + 25 * scale, centerY);
                    ctx.lineTo(centerX + SCHWARZSCHILD_RADIUS * scale, centerY);
                    ctx.stroke();
                    return;
                }
                systemFunc = timelikeGeodesicSystem;
                const L = value;
                const p_inf = Math.sqrt(E_TIMELIKE_SCATTER**2 - 1);
                b_geom = L / p_inf;
                params = { M: M, L: L };
            }

            if (b_geom < 0) return;
            const D_initial = 25.0;
            const phi_initial = Math.atan2(b_geom, -D_initial);
            if (Math.sin(phi_initial) === 0) return;
            
            const r_initial = Math.sqrt(D_initial**2 + b_geom**2);
            let u = 1.0 / r_initial;
            let du_dphi = u * (1.0 / Math.tan(phi_initial));
            let y = [u, du_dphi];
            let phi = phi_initial;
            const h = -0.005;
            const num_steps = 3000;

            ctx.beginPath();
            ctx.strokeStyle = pathStyle;
            ctx.lineWidth = 2.5;
            
            let r = 1 / y[0];
            ctx.moveTo(centerX + r * Math.cos(phi) * scale, centerY - r * Math.sin(phi) * scale);

            for (let i = 0; i < num_steps; i++) {
                y = rk4Step(systemFunc, y, h, params);
                phi += h;
                r = 1 / y[0];
                if (r <= SCHWARZSCHILD_RADIUS || r > 50) break;
                ctx.lineTo(centerX + r * Math.cos(phi) * scale, centerY - r * Math.sin(phi) * scale);
            }
            ctx.stroke();
        }

        function setupModeSwitcher() {
            lightlikeBtn.addEventListener('click', () => switchMode('lightlike'));
            timelikeBtn.addEventListener('click', () => switchMode('timelike'));
        }

        function switchMode(mode) {
            geodesicMode = mode;
            lightlikeBtn.classList.toggle('active', mode === 'lightlike');
            timelikeBtn.classList.toggle('active', mode !== 'lightlike');
            input.classList.toggle('lightlike-active', mode === 'lightlike');
            input.classList.toggle('timelike-active', mode !== 'lightlike');
            slider.classList.toggle('lightlike-active', mode === 'lightlike');
            slider.classList.toggle('timelike-active', mode !== 'lightlike');

            if (mode === 'lightlike') {
                parameterLabel.textContent = 'Impact Parameter (b):';
                slider.min = 0;
                slider.max = 10;
                slider.step = 0.0001;
                slider.value = B_CRITICAL;
                pathLegendLine.style.backgroundColor = 'var(--orange-accent)';
                pathLegendText.textContent = 'Photon Path';
            } else {
                parameterLabel.textContent = 'Angular Momentum (L/M):';
                slider.min = 0;
                slider.max = 8;
                slider.step = 0.0001;
                slider.value = L_ISCO;
                pathLegendLine.style.backgroundColor = 'var(--slate-accent)';
                pathLegendText.textContent = 'Particle Path';
            }
            updateFromSlider();
        }

        function updateFromSlider() {
            input.value = parseFloat(slider.value).toFixed(4);
            draw();
        }

        function updateFromInput() {
            let value = parseFloat(input.value);
            if (isNaN(value)) return;
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            if (value < min) value = min;
            if (value > max) value = max;
            input.value = value.toFixed(4);
            slider.value = value;
            draw();
        }
        
        slider.addEventListener('input', updateFromSlider);
        input.addEventListener('change', updateFromInput);
        
        setupModeSwitcher();
        // Set initial state and draw
        switchMode('lightlike');
    }
});
