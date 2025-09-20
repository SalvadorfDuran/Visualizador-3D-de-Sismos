

import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';

let scene, camera, renderer, controls, globe;
// Clock para animaciones
let _clock = new THREE.Clock();
// Halos activos (animaciones de selección)
window.activeHalos = [];
// Ripples activos (anillos expandiéndose)
window.activeRipples = [];
// Playback / timeline state
window.playbackRunning = false;
window.playbackSpeed = 10.0; // will be computed from target duration
// target total playback duration in seconds (default 60s = 1 minute)
// load saved target duration (minutes) from localStorage if present
const _savedMinutes = (function(){ try { return Number(localStorage.getItem('playback_target_minutes')); } catch(e) { return null; } })();
window.playbackTargetDurationSec = (_savedMinutes && !isNaN(_savedMinutes)) ? Math.max(6, _savedMinutes * 60) : 60; // min 6s if saved
window.playbackStartMillis = 0;
window.playbackEndMillis = 0;
window.playbackTimeSec = 0; // seconds since start
window.playbackDurationSec = 0;
window.playbackOrdered = []; // array of {globalIdx, time}
window.playbackNextPtr = 0;
window.playbackPlayed = new Set();
// whether the user has performed a search during this session
window.hasRunSearch = false;
// texture layers registry: {id: {mesh, url, name, visible, opacity}}
window.textureLayers = {};

// Cached drop shadow texture for markers
window._gdv_dropShadowTex = null;
function getDropShadowTexture() {
    if (window._gdv_dropShadowTex) return window._gdv_dropShadowTex;
    const size = 128;
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size/2, cy = size/2, r = size/2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.3, 'rgba(0,0,0,0.35)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    window._gdv_dropShadowTex = tex;
    return tex;
}


// Inicialización diferida para asegurar que el DOM esté listo
window.addEventListener('DOMContentLoaded', () => {
    agregarFormularioFiltros();
    createPlaybackControls();
    init();
    setupPanelToggles();
    // Ensure the resultados banner is hidden and empty on initial load (avoid stale messages)
    try {
        const resultadosDiv = document.getElementById('resultados-count');
        if (resultadosDiv) { resultadosDiv.style.display = 'none'; resultadosDiv.innerHTML = ''; }
    } catch (e) {}
    // Ocultar spinner al inicio
    showLoading(false);
    animate();
    // initial download buttons state
    try { if (typeof updateDownloadButtons === 'function') updateDownloadButtons(); } catch(e) {}
    // auto-refresh deshabilitado por ahora
});

// Panel collapse/expand handlers
function setupPanelToggles() {
    const left = document.getElementById('left-panel');
    const info = document.getElementById('info-panel');
    const leftBtn = document.getElementById('left-toggle');
    const leftMiniBtn = document.getElementById('left-mini-toggle');
    const infoBtn = document.getElementById('info-toggle');
    const infoMiniBtn = document.getElementById('info-mini-toggle');
    const light = document.getElementById('light-control-ui');
    const lightBtn = document.getElementById('light-toggle');
    const lightMiniBtn = document.getElementById('light-mini-toggle');
    try {
        // restore state
        const leftCollapsed = localStorage.getItem('leftPanelCollapsed') === '1';
        const infoCollapsed = localStorage.getItem('infoPanelCollapsed') === '1';
        const lightCollapsed = localStorage.getItem('lightPanelCollapsed') === '1';
        if (left && leftCollapsed) left.classList.add('collapsed');
        if (info && infoCollapsed) info.classList.add('collapsed');
        if (light && lightCollapsed) light.classList.add('collapsed');
    } catch (e) {}
    // initialize button labels and aria
    if (leftBtn && left) {
        const isCollapsed = left.classList.contains('collapsed');
        leftBtn.textContent = isCollapsed ? '+' : '−';
        leftBtn.setAttribute('aria-expanded', String(!isCollapsed));
        leftBtn.title = isCollapsed ? 'Expandir panel' : 'Minimizar panel';
        leftBtn.addEventListener('click', () => {
            left.classList.toggle('collapsed');
            const collapsed = left.classList.contains('collapsed');
            leftBtn.textContent = collapsed ? '+' : '−';
            if (leftMiniBtn) leftMiniBtn.setAttribute('aria-expanded', String(!collapsed));
            if (leftMiniBtn) leftMiniBtn.textContent = collapsed ? '+' : '−';
            leftBtn.setAttribute('aria-expanded', String(!collapsed));
            leftBtn.title = collapsed ? 'Expandir panel' : 'Minimizar panel';
            try { localStorage.setItem('leftPanelCollapsed', collapsed ? '1' : '0'); } catch(e){}
            // Only show resultados banner if a search has been executed in this session
            try {
                const resultadosDiv = document.getElementById('resultados-count');
                if (resultadosDiv) {
                    const hasData = (window.earthquakeData && window.earthquakeData.length > 0) || (window.playbackOrdered && window.playbackOrdered.length > 0);
                    if (!collapsed && window.hasRunSearch && hasData) {
                        resultadosDiv.style.display = 'block';
                    } else {
                        resultadosDiv.style.display = 'none';
                        resultadosDiv.innerHTML = '';
                    }
                }
            } catch (e) {}
        });
    }

    // mini-toggle: visible only when collapsed; clicking will toggle expand
    if (leftMiniBtn && left) {
        const isCollapsed = left.classList.contains('collapsed');
        leftMiniBtn.style.display = isCollapsed ? 'inline-flex' : '';
        leftMiniBtn.textContent = isCollapsed ? '+' : '−';
        leftMiniBtn.setAttribute('aria-expanded', String(!isCollapsed));
        leftMiniBtn.addEventListener('click', () => {
            left.classList.toggle('collapsed');
            const collapsed = left.classList.contains('collapsed');
            // sync main toggle if present
            if (leftBtn) leftBtn.textContent = collapsed ? '+' : '−';
            leftMiniBtn.textContent = collapsed ? '+' : '−';
            try { localStorage.setItem('leftPanelCollapsed', collapsed ? '1' : '0'); } catch(e){}
            // Only show resultados banner if a search has been executed in this session
            try {
                const resultadosDiv = document.getElementById('resultados-count');
                if (resultadosDiv) {
                    const hasData = (window.earthquakeData && window.earthquakeData.length > 0) || (window.playbackOrdered && window.playbackOrdered.length > 0);
                    if (!collapsed && window.hasRunSearch && hasData) {
                        resultadosDiv.style.display = 'block';
                    } else {
                        resultadosDiv.style.display = 'none';
                        resultadosDiv.innerHTML = '';
                    }
                }
            } catch (e) {}
        });
    }

    // info panel mini-toggle: mirror behavior of left mini-toggle
    if (infoMiniBtn && info) {
        const isCollapsed = info.classList.contains('collapsed');
        infoMiniBtn.style.display = isCollapsed ? 'inline-flex' : '';
        infoMiniBtn.textContent = isCollapsed ? '+' : '−';
        infoMiniBtn.setAttribute('aria-expanded', String(!isCollapsed));
        infoMiniBtn.addEventListener('click', () => {
            info.classList.toggle('collapsed');
            const collapsed = info.classList.contains('collapsed');
            // sync main toggle if present
            if (infoBtn) infoBtn.textContent = collapsed ? '+' : '−';
            infoMiniBtn.textContent = collapsed ? '+' : '−';
            try { localStorage.setItem('infoPanelCollapsed', collapsed ? '1' : '0'); } catch(e){}
        });
    }

    if (infoBtn && info) {
        const isCollapsed = info.classList.contains('collapsed');
        infoBtn.textContent = isCollapsed ? '+' : '−';
        infoBtn.setAttribute('aria-expanded', String(!isCollapsed));
        infoBtn.title = isCollapsed ? 'Expandir panel' : 'Minimizar panel';
        infoBtn.addEventListener('click', () => {
            info.classList.toggle('collapsed');
            const collapsed = info.classList.contains('collapsed');
            infoBtn.textContent = collapsed ? '+' : '−';
            infoBtn.setAttribute('aria-expanded', String(!collapsed));
            infoBtn.title = collapsed ? 'Expandir panel' : 'Minimizar panel';
            try { localStorage.setItem('infoPanelCollapsed', collapsed ? '1' : '0'); } catch(e){}
        });
    }
    // light panel toggle wiring (created dynamically by createLightControlUI)
    if (lightBtn && light) {
        const isCollapsed = light.classList.contains('collapsed');
        lightBtn.textContent = isCollapsed ? '+' : '−';
        lightBtn.setAttribute('aria-expanded', String(!isCollapsed));
        lightBtn.title = isCollapsed ? 'Expandir panel' : 'Minimizar panel';
        lightBtn.addEventListener('click', () => {
            light.classList.toggle('collapsed');
            const collapsed = light.classList.contains('collapsed');
            lightBtn.textContent = collapsed ? '+' : '−';
            lightBtn.setAttribute('aria-expanded', String(!collapsed));
            lightBtn.title = collapsed ? 'Expandir panel' : 'Minimizar panel';
            try { localStorage.setItem('lightPanelCollapsed', collapsed ? '1' : '0'); } catch(e){}
        });
    }
    if (lightMiniBtn && light) {
        const isCollapsed = light.classList.contains('collapsed');
        lightMiniBtn.style.display = isCollapsed ? 'inline-flex' : '';
        lightMiniBtn.textContent = isCollapsed ? '+' : '−';
        lightMiniBtn.setAttribute('aria-expanded', String(!isCollapsed));
        lightMiniBtn.addEventListener('click', () => {
            light.classList.toggle('collapsed');
            const collapsed = light.classList.contains('collapsed');
            if (lightBtn) lightBtn.textContent = collapsed ? '+' : '−';
            lightMiniBtn.textContent = collapsed ? '+' : '−';
            try { localStorage.setItem('lightPanelCollapsed', collapsed ? '1' : '0'); } catch(e){}
        });
    }
    // Final sync: enforce mini-toggle visuals based on actual collapsed classes
    try {
        if (left && leftMiniBtn) {
            leftMiniBtn.textContent = left.classList.contains('collapsed') ? '+' : '−';
            leftMiniBtn.setAttribute('aria-expanded', String(!left.classList.contains('collapsed')));
            leftMiniBtn.style.display = left.classList.contains('collapsed') ? 'inline-flex' : '';
        }
        if (info && infoMiniBtn) {
            infoMiniBtn.textContent = info.classList.contains('collapsed') ? '+' : '−';
            infoMiniBtn.setAttribute('aria-expanded', String(!info.classList.contains('collapsed')));
            infoMiniBtn.style.display = info.classList.contains('collapsed') ? 'inline-flex' : '';
        }
        if (light && lightMiniBtn) {
            lightMiniBtn.textContent = light.classList.contains('collapsed') ? '+' : '−';
            lightMiniBtn.setAttribute('aria-expanded', String(!light.classList.contains('collapsed')));
            lightMiniBtn.style.display = light.classList.contains('collapsed') ? 'inline-flex' : '';
        }
    } catch (e) {}
}

// --- Export helpers: download current earthquakeData as JSON or CSV ---
function safeFilename(prefix, ext) {
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-');
    return `${prefix}_${ts}.${ext}`;
}

function downloadObjectAsJson(obj, filename) {
    const dataStr = JSON.stringify(obj, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function toCSV(records) {
    if (!Array.isArray(records) || records.length === 0) return '';
    // pick a standard set of columns: time, place, mag, depth, lon, lat, any properties JSON
    const cols = ['time_iso', 'time_unix', 'place', 'mag', 'depth', 'longitude', 'latitude', 'properties'];
    const lines = [cols.join(',')];
    for (const r of records) {
        const timeIso = (typeof r.time === 'number') ? new Date(r.time).toISOString() : (r.time || '');
        const timeUnix = typeof r.time === 'number' ? r.time : '';
        const place = (`${r.place || ''}`).replace(/"/g, '""');
        const mag = (typeof r.mag !== 'undefined') ? r.mag : (r.properties && r.properties.mag ? r.properties.mag : '');
        const depth = (typeof r.depth !== 'undefined') ? r.depth : (r.properties && r.properties.depth ? r.properties.depth : '');
        const lon = (r.properties && r.properties.coords && r.properties.coords[0] != null) ? r.properties.coords[0] : (r.longitude || '');
        const lat = (r.properties && r.properties.coords && r.properties.coords[1] != null) ? r.properties.coords[1] : (r.latitude || '');
        const props = r.properties ? JSON.stringify(r.properties).replace(/"/g, '""') : '';
        const row = [timeIso, timeUnix, `"${place}"`, mag, depth, lon, lat, `"${props}"`];
        lines.push(row.join(','));
    }
    return lines.join("\n");
}

function downloadCSV(records, filename) {
    const csv = toCSV(records);
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Wire the download buttons if present
window.addEventListener('DOMContentLoaded', () => {
    // select any download buttons present (prefer left-panel ids but include any with .download-btn)
    const btnJson = document.getElementById('download-json-left') || document.getElementById('download-json');
    const btnCsv = document.getElementById('download-csv-left') || document.getElementById('download-csv');
    const allDownloadBtns = Array.from(document.querySelectorAll('.download-btn'));
    function updateDownloadButtons() {
        try {
            const has = (window.earthquakeData && window.earthquakeData.length > 0);
            allDownloadBtns.forEach(b => { try { b.disabled = !has; } catch (e) {} });
        } catch (e) {}
    }
    if (btnJson) {
        btnJson.addEventListener('click', () => {
            const data = (window.earthquakeData && window.earthquakeData.length > 0) ? window.earthquakeData : [];
            const filename = safeFilename('sismos', 'json');
            downloadObjectAsJson(data, filename);
        });
    }
    if (btnCsv) {
        btnCsv.addEventListener('click', () => {
            const data = (window.earthquakeData && window.earthquakeData.length > 0) ? window.earthquakeData : [];
            const filename = safeFilename('sismos', 'csv');
            downloadCSV(data, filename);
        });
    }
    // expose helper globally for other code to call when data changes
    window.updateDownloadButtons = updateDownloadButtons;
    // initial run
    try { updateDownloadButtons(); } catch (e) {}
});

function init() {
    // Escena
    scene = new THREE.Scene();
    // fondo más oscuro, tono muy profundo para look espacial minimal
    scene.background = new THREE.Color(0x02030a);

    // Crear nebula/procedural background y fondo estelar distante (Points)
    createNebulaBackground();
    createStarfield();

    // Obtener el contenedor primero para calcular aspect correctamente
    const globeDiv = document.getElementById('globe-container');
    const initialWidth = (globeDiv && globeDiv.clientWidth) || Math.floor(window.innerWidth * 0.75);
    const initialHeight = (globeDiv && globeDiv.clientHeight) || window.innerHeight;

    // Cámara
    camera = new THREE.PerspectiveCamera(60, initialWidth / initialHeight, 0.1, 1000);
    camera.position.set(0, 0, 4);

    // Renderizador
    renderer = new THREE.WebGLRenderer({ antialias: true });
    // Soporte HiDPI
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    // Usar el tamaño del contenedor
    renderer.setSize(initialWidth, initialHeight);
    // Mejor tone mapping/contraste para materiales PBR
    try {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.outputEncoding = THREE.sRGBEncoding;
    } catch (e) {}
    globeDiv.appendChild(renderer.domElement);
    // Evitar gestos táctiles que disparen scroll mientras se orbita
    renderer.domElement.style.touchAction = 'none';

    // Construir un envMap (PMREM) representativo del fondo para PBR
    try {
        const pmremGen = new THREE.PMREMGenerator(renderer);
        pmremGen.compileEquirectangularShader();
        // si createNebulaBackground creó nebulaMesh, usarlo para fromScene; si no hay, dejar null
        if (typeof nebulaMesh !== 'undefined' && nebulaMesh) {
            const pmrem = pmremGen.fromScene(nebulaMesh, 0.04);
            window.sceneEnvMap = pmrem && pmrem.texture ? pmrem.texture : null;
        } else {
            window.sceneEnvMap = null;
        }
        window._pmremGenerator = pmremGen;
    } catch (e) { window.sceneEnvMap = null; }

    // Controles de órbita
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    // Luz: exponer las luces globalmente para control desde UI
    window.sceneLight = new THREE.DirectionalLight(0xffffff, 1);
    window.sceneLight.position.set(5, 3, 5);
    scene.add(window.sceneLight);
    window.ambientLight = new THREE.AmbientLight(0x888888);
    scene.add(window.ambientLight);

    // Esfera (Tierra) con textura pública
    const geometry = new THREE.SphereGeometry(1, 64, 64);
    // Create the globe base without a map; textures will be added as separate layers
    const material = new THREE.MeshPhongMaterial({ color: 0x081018 });
    globe = new THREE.Mesh(geometry, material);
    globe.rotation.y = Math.PI; // Corrige la alineación de la textura
    scene.add(globe);

    // Configure camera zoom limits so user cannot go inside the atmosphere or far outside the starfield.
    // Compute a safe minimum distance slightly larger than the outer glow sphere radius (1.06)
    // and a maximum distance slightly smaller than the starfield outer radius.
    try {
        const atmosphereOuter = 1.06; // matches glowSphere radius
        const safeMin = atmosphereOuter + 0.05; // a small margin outside the atmosphere
        // prefer a dynamic starfield radius if available, otherwise fall back to a sensible default
        const starfieldRadius = (window.starfieldOuterRadius && Number(window.starfieldOuterRadius)) ? Number(window.starfieldOuterRadius) : 44;
        const safeMax = Math.max(safeMin + 10, starfieldRadius - 2);
        if (controls) {
            controls.minDistance = safeMin;
            controls.maxDistance = safeMax;
        }
    } catch (e) { /* non-fatal */ }

    // Atmosfera: doble capa para rim + outer glow con límites muy difusos
    // 1) Rim (capa interna, define el borde)
    const rimUniforms = {
        rimColor: { value: new THREE.Color(0x66aaff) },
        // ampliar el rango para un borde más difuso
        rimEdge0: { value: 0.2 },
        rimEdge1: { value: 0.9 },
        // usar potencia < 1 para suavizar la curva
        rimPower: { value: 0.8 },
        rimOpacity: { value: 0.12 }
    };

    const commonVertex = `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `;

    const rimFragment = `
        uniform vec3 rimColor;
        uniform float rimEdge0;
        uniform float rimEdge1;
        uniform float rimPower;
        uniform float rimOpacity;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float ndv = dot(vNormal, viewDir);
            // fresnel-like (0 at facing, 1 at grazing)
            float f = clamp(1.0 - ndv, 0.0, 1.0);
            // suavizado y control de curva: usar un smoothstep amplio y una segunda suavización
            float s = smoothstep(rimEdge0, rimEdge1, f);
            // segunda pasada para atenuar cualquier transición dura
            float soft = smoothstep(0.0, 1.0, s);
            float intensity = pow(soft, rimPower);
            // mezcla de color con opacidad controlada por intensity
            vec3 col = rimColor * intensity;
            gl_FragColor = vec4(col, intensity * rimOpacity);
        }
    `;

    const rimMaterial = new THREE.ShaderMaterial({
        uniforms: rimUniforms,
        vertexShader: commonVertex,
        fragmentShader: rimFragment,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false
    });

    const rimSphere = new THREE.Mesh(new THREE.SphereGeometry(1.03, 64, 64), rimMaterial);
    rimSphere.name = 'atmosphere_rim';
    scene.add(rimSphere);

    // 2) Outer glow (capa externa, muy difusa, expansión suave usando exponencial)
    const glowUniforms = {
        glowColor: { value: new THREE.Color(0x66aaff) },
        glowIntensity: { value: 0.7 },
        glowFalloff: { value: 5.0 },
        glowOpacity: { value: 0.06 }
    };

    const glowFragment = `
        uniform vec3 glowColor;
        uniform float glowIntensity;
        uniform float glowFalloff;
        uniform float glowOpacity;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float ndv = dot(vNormal, viewDir);
            float f = clamp(1.0 - ndv, 0.0, 1.0);
            // usar una caída exponencial para un halo muy suave
            float intensity = glowIntensity * exp(-pow(f * glowFalloff, 2.0));
            // bajar intensidad cerca del frente para que no opaque la superficie
            intensity *= smoothstep(0.0, 1.0, f);
            vec3 col = glowColor * intensity;
            gl_FragColor = vec4(col, intensity * glowOpacity);
        }
    `;

    const glowMaterial = new THREE.ShaderMaterial({
        uniforms: glowUniforms,
        vertexShader: commonVertex,
        fragmentShader: glowFragment,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false
    });

    const glowSphere = new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 64), glowMaterial);
    glowSphere.name = 'atmosphere_glow';
    scene.add(glowSphere);

    // Responsive
    window.addEventListener('resize', onWindowResize, false);

    // Cargar sismos
    // Nota: no cargar sismos por defecto. El usuario debe realizar una búsqueda desde el formulario.
    // Los controles de playback se mostrarán, pero estarán deshabilitados hasta que haya datos.
    setPlaybackControlsEnabled(false);

    // Load texture manifest (if present) and build texture controls in the filters form
    // This will create one layer per texture and allow toggling multiple simultaneous layers.
    loadTextureManifest().then(list => {
        try { buildTextureControls(list); } catch (e) { console.warn('texture controls init failed', e); }
    }).catch(() => {
        try { buildTextureControls([]); } catch (e) {}
    });

    // Interacción
    renderer.domElement.addEventListener('pointerdown', onPointerDown, false);
    // Crear controles de luz (UI)
    try { createLightControlUI(); } catch (e) { console.warn('createLightControlUI failed', e); }
}

// UI para controlar la luz direccional y ambiental (posición, colores, intensidades)
function createLightControlUI() {
    if (!document.body) return;
    // contenedor (mover a la esquina inferior izquierda, con cabecera y soporte de colapsado)
    const wrap = document.createElement('div');
    wrap.id = 'light-control-ui';
    wrap.className = 'light-panel';
    wrap.style.cssText = 'position:absolute;right:20px;bottom:20px;z-index:40;background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));padding:12px;border-radius:10px;color:#eaf6ff;font-family:Arial, sans-serif;display:flex;flex-direction:column;align-items:center;gap:8px;min-width:160px;box-shadow:0 6px 28px rgba(2,6,23,0.7);';

    // header with title and toggle
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.style.cssText = 'width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const title = document.createElement('h2');
    title.textContent = 'Luz';
    title.style.cssText = 'font-size:0.95rem;margin:0;color:#e6eef6;';
    const actions = document.createElement('div'); actions.className = 'panel-actions';
    const lightToggle = document.createElement('button'); lightToggle.type = 'button'; lightToggle.id = 'light-toggle'; lightToggle.className = 'toggle-btn'; lightToggle.setAttribute('aria-expanded', 'true'); lightToggle.textContent = '−';
    const lightMini = document.createElement('button'); lightMini.type = 'button'; lightMini.id = 'light-mini-toggle'; lightMini.className = 'toggle-btn light-mini-toggle'; lightMini.setAttribute('aria-expanded', 'false'); lightMini.textContent = '+';
    actions.appendChild(lightToggle);
    header.appendChild(title);
    header.appendChild(actions);
    wrap.appendChild(header);
    // add mini-toggle (visible when collapsed) inside wrap for symmetry with CSS selectors
    wrap.appendChild(lightMini);

    // content wrapper so collapse can animate like other panels
    const content = document.createElement('div');
    content.className = 'light-content';
    content.style.cssText = 'width:100%;display:flex;flex-direction:column;align-items:center;gap:8px;';


    // intensity slider for directional light
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:100%;gap:6px;';
    const label = document.createElement('div');
    label.textContent = 'Intensidad';
    label.style.cssText = 'font-size:0.8rem;color:#cde8ff;';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '2';
    input.step = '0.01';
    input.value = String((window.sceneLight && window.sceneLight.intensity) ? window.sceneLight.intensity : 1);
    input.style.cssText = 'width:112px;';
    row.appendChild(label);
    row.appendChild(input);
    content.appendChild(row);

    // info line removed (description hidden as requested)

    // additional controls: color pickers and ambient intensity
    const controlsRow = document.createElement('div');
    controlsRow.style.cssText = 'display:flex;flex-direction:column;gap:6px;align-items:center;width:100%;margin-top:6px;';

    const dirLabel = document.createElement('div'); dirLabel.textContent = 'Color luz'; dirLabel.style.cssText='font-size:0.75rem;color:#cde8ff;';
    const dirColor = document.createElement('input'); dirColor.type = 'color'; dirColor.style.cssText = 'width:48px;height:28px;border-radius:6px;border:0;padding:0;';

    const ambLabel = document.createElement('div'); ambLabel.textContent = 'Ambient'; ambLabel.style.cssText='font-size:0.75rem;color:#cde8ff;';
    const ambColor = document.createElement('input'); ambColor.type = 'color'; ambColor.style.cssText = 'width:48px;height:28px;border-radius:6px;border:0;padding:0;';
    const ambRow = document.createElement('div'); ambRow.style.cssText='display:flex;gap:6px;align-items:center;';
    const ambIntensity = document.createElement('input'); ambIntensity.type='range'; ambIntensity.min='0'; ambIntensity.max='2'; ambIntensity.step='0.01'; ambIntensity.style.cssText='width:96px;';
    ambRow.appendChild(ambIntensity);

    const resetBtn = document.createElement('button'); resetBtn.textContent='Reset'; resetBtn.style.cssText='padding:6px 8px;border-radius:6px;border:0;background:#223344;color:#dfefff;cursor:pointer;';

    // build layout in requested order:
    // 1) intensity already appended
    // 2) ambient (with label)
    const ambControl = document.createElement('div');
    ambControl.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:100%;gap:6px;';
    const ambLabelEl = document.createElement('div'); ambLabelEl.textContent = 'Ambient'; ambLabelEl.style.cssText = 'font-size:0.8rem;color:#cde8ff;';
    ambControl.appendChild(ambLabelEl);
    const ambInner = document.createElement('div'); ambInner.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;';
    ambInner.appendChild(ambIntensity);
    ambControl.appendChild(ambInner);
    content.appendChild(ambControl);

    // 3) two color pickers on same row without labels
    const colorRow = document.createElement('div');
    colorRow.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:center;width:100%;';
    colorRow.appendChild(dirColor);
    colorRow.appendChild(ambColor);
    content.appendChild(colorRow);

    // 4) reset button centered
    const resetWrap = document.createElement('div'); resetWrap.style.cssText = 'width:100%;display:flex;justify-content:center;';
    resetWrap.appendChild(resetBtn);
    content.appendChild(resetWrap);

    // sliders for precise light direction
    const sliderBlock = document.createElement('div');
    sliderBlock.style.cssText = 'display:flex;flex-direction:column;gap:6px;align-items:center;width:100%;margin-top:6px;';

    const makeRow = (labelText) => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;justify-content:space-between;';
        const lab = document.createElement('div'); lab.textContent = labelText; lab.style.cssText = 'font-size:0.75rem;color:#cde8ff;min-width:56px;';
        const input = document.createElement('input'); input.type = 'range'; input.style.cssText = 'flex:1;';
        const val = document.createElement('div'); val.style.cssText = 'width:44px;text-align:right;color:#bcdff9;font-size:0.78rem;';
        r.appendChild(lab); r.appendChild(input); r.appendChild(val);
        return { row: r, input, val };
    };

    const az = makeRow('Azim'); az.input.min = '-180'; az.input.max = '180'; az.input.step = '1'; az.val.textContent = '0°';
    const el = makeRow('Elev'); el.input.min = '-89'; el.input.max = '89'; el.input.step = '1'; el.val.textContent = '0°';
    sliderBlock.appendChild(az.row); sliderBlock.appendChild(el.row);
    controlsRow.appendChild(sliderBlock);
    content.appendChild(controlsRow);
    wrap.appendChild(content);

    document.body.appendChild(wrap);
    // initialize collapse state from localStorage to match other panels
    try {
        const lightCollapsed = localStorage.getItem('lightPanelCollapsed') === '1';
        if (lightCollapsed) wrap.classList.add('collapsed');
        // ensure mini-toggle visibility consistent
        const mini = document.getElementById('light-mini-toggle');
        if (mini) mini.style.display = wrap.classList.contains('collapsed') ? 'inline-flex' : '';
    } catch (e) {}

    // spherical helpers for light position
    const light = window.sceneLight;
    if (!light) return;
    const r = light.position.length() || 8;
    const getSpherical = (pos) => {
        const x = pos.x, y = pos.y, z = pos.z;
        const radius = Math.sqrt(x*x + y*y + z*z) || r;
        const elev = Math.asin(y / radius);
        const azim = Math.atan2(x, z);
        return { radius, elev, azim };
    };
    let sph = getSpherical(light.position);

    function applySpherical(s) {
        const rad = s.radius;
        const phi = s.elev;
        const theta = s.azim;
        const x = rad * Math.cos(phi) * Math.sin(theta);
        const y = rad * Math.sin(phi);
        const z = rad * Math.cos(phi) * Math.cos(theta);
        if (window.sceneLight) window.sceneLight.position.set(x, y, z);
    const intensity = (window.sceneLight && typeof window.sceneLight.intensity === 'number') ? window.sceneLight.intensity : 0;
        // sync sliders if present
        try {
            if (typeof az !== 'undefined' && az.input) {
                az.input.value = String((theta * 180 / Math.PI).toFixed(0));
                az.val.textContent = `${(theta * 180 / Math.PI).toFixed(0)}°`;
            }
            if (typeof el !== 'undefined' && el.input) {
                el.input.value = String((phi * 180 / Math.PI).toFixed(0));
                el.val.textContent = `${(phi * 180 / Math.PI).toFixed(0)}°`;
            }
            // distance slider removed; radius is applied directly to the light position
        } catch (e) {}
    }

    applySpherical(sph);

    // knob removed: light direction is controlled via Azim/Elev sliders

    // persistence
    const LS_KEY = 'gdv_light_settings_v1';
    function loadSaved() { try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch(e){ return null; } }
    function saveSettings(obj) { try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch(e){} }
    const saved = loadSaved();
    if (saved && saved.dirColor) dirColor.value = saved.dirColor; else dirColor.value = '#ffffff';
    if (saved && typeof saved.ambIntensity === 'number') ambIntensity.value = String(saved.ambIntensity);
    else ambIntensity.value = String((window.ambientLight && window.ambientLight.intensity) ? window.ambientLight.intensity : 0.888);
    if (saved && saved.ambColor) ambColor.value = saved.ambColor; else ambColor.value = '#888888';
    if (saved && typeof saved.az === 'number') az.input.value = String(Math.round(saved.az));
    if (saved && typeof saved.el === 'number') el.input.value = String(Math.round(saved.el));
    // distance control removed; saved.dist is ignored
    try { if (window.sceneLight) window.sceneLight.color.set(dirColor.value); } catch(e){}
    try { if (window.ambientLight) { window.ambientLight.color.set(ambColor.value); window.ambientLight.intensity = Number(ambIntensity.value); } } catch(e){}

    input.addEventListener('input', () => {
        const v = Number(input.value);
        if (window.sceneLight) window.sceneLight.intensity = v;
        try { applySpherical(sph); } catch(e){}
        saveSettings({ dirColor: dirColor.value, ambColor: ambColor.value, ambIntensity: Number(ambIntensity.value) });
    });
    // sliders behavior
    az.input.addEventListener('input', () => {
        const deg = Number(az.input.value);
        az.val.textContent = `${deg}°`;
        sph.azim = deg * Math.PI / 180;
        applySpherical(sph);
        saveSettings({ dirColor: dirColor.value, ambColor: ambColor.value, ambIntensity: Number(ambIntensity.value), az: deg, el: Number(el.input.value) });
    });
    el.input.addEventListener('input', () => {
        const deg = Number(el.input.value);
        el.val.textContent = `${deg}°`;
        sph.elev = deg * Math.PI / 180;
        applySpherical(sph);
        saveSettings({ dirColor: dirColor.value, ambColor: ambColor.value, ambIntensity: Number(ambIntensity.value), az: Number(az.input.value), el: deg });
    });
    dirColor.addEventListener('input', () => { try { if (window.sceneLight) window.sceneLight.color.set(dirColor.value); } catch(e){}; saveSettings({ dirColor: dirColor.value, ambColor: ambColor.value, ambIntensity: Number(ambIntensity.value) }); });
    ambColor.addEventListener('input', () => { try { if (window.ambientLight) window.ambientLight.color.set(ambColor.value); } catch(e){}; saveSettings({ dirColor: dirColor.value, ambColor: ambColor.value, ambIntensity: Number(ambIntensity.value) }); });
    ambIntensity.addEventListener('input', () => { try { if (window.ambientLight) window.ambientLight.intensity = Number(ambIntensity.value); } catch(e){}; saveSettings({ dirColor: dirColor.value, ambColor: ambColor.value, ambIntensity: Number(ambIntensity.value) }); try { applySpherical(sph); } catch(e){} });
    resetBtn.addEventListener('click', () => {
        dirColor.value = '#ffffff'; ambColor.value = '#888888'; ambIntensity.value = '0.888';
        if (window.sceneLight) { window.sceneLight.color.set(dirColor.value); }
        if (window.ambientLight) { window.ambientLight.color.set(ambColor.value); window.ambientLight.intensity = Number(ambIntensity.value); }
        // reset spherical to defaults
        sph = { radius: 5, elev: 0.4, azim: Math.PI / 3 };
        applySpherical(sph);
    saveSettings({ dirColor: dirColor.value, ambColor: ambColor.value, ambIntensity: Number(ambIntensity.value), az: Math.round(sph.azim * 180 / Math.PI), el: Math.round(sph.elev * 180 / Math.PI) });
        try { applySpherical(sph); } catch(e){}
    });

    // apply saved spherical values if present
    try {
        if (saved) {
            const sAz = (typeof saved.az === 'number') ? saved.az * Math.PI / 180 : null;
            const sEl = (typeof saved.el === 'number') ? saved.el * Math.PI / 180 : null;
            if (sAz !== null) sph.azim = sAz;
            if (sEl !== null) sph.elev = sEl;
            applySpherical(sph);
        }
    } catch (e) {}
}

function onWindowResize() {
    const globeDiv = document.getElementById('globe-container');
    const width = globeDiv.clientWidth;
    const height = globeDiv.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

function animate() {
    requestAnimationFrame(animate);
    const delta = _clock.getDelta();
    controls.update();

    // Enforce camera distance limits relative to controls.target to avoid penetrating the globe
    try {
        const tgt = (controls && controls.target) ? controls.target : new THREE.Vector3(0, 0, 0);
        const camToTarget = camera.position.clone().sub(tgt);
        const len = camToTarget.length();
        const minD = (controls && typeof controls.minDistance === 'number') ? controls.minDistance : 1.08;
        const maxD = (controls && typeof controls.maxDistance === 'number') ? controls.maxDistance : 44;
        // small epsilon to avoid jitter
        const eps = 0.0001;
        if (len < minD - eps) {
            camToTarget.setLength(minD);
            camera.position.copy(tgt).add(camToTarget);
        } else if (len > maxD + eps) {
            camToTarget.setLength(maxD);
            camera.position.copy(tgt).add(camToTarget);
        }
    } catch (e) { /* non-fatal */ }

    // Parallax/animación de estrellas
    updateStars(delta);

    // Animación de pulso para instancia seleccionada
    if (window.selectedInstance && window.selectedInstance.mesh) {
        const sel = window.selectedInstance;
        const mesh = sel.mesh;
        sel.elapsed = (sel.elapsed || 0) + delta;
        const duration = 0.9; // segundos
        const t = Math.min(1, sel.elapsed / duration);
        const scaleFactor = 1 + 0.6 * (1 - Math.pow(1 - t, 3));
        const localId = sel.localId;
        const baseMat = mesh.userData && mesh.userData.baseMatrices && mesh.userData.baseMatrices[localId];
        if (baseMat) {
            const tmpObj = new THREE.Object3D();
            tmpObj.matrix.copy(baseMat);
            tmpObj.matrix.decompose(tmpObj.position, tmpObj.quaternion, tmpObj.scale);
            tmpObj.scale.multiplyScalar(scaleFactor);
            tmpObj.updateMatrix();
            mesh.setMatrixAt(localId, tmpObj.matrix);
            mesh.instanceMatrix.needsUpdate = true;
        }
        if (t >= 1) {
            if (baseMat) {
                mesh.setMatrixAt(localId, baseMat);
                mesh.instanceMatrix.needsUpdate = true;
            }
            window.selectedInstance = null;
        }
    }

    // Animar halos
    animateHalos(delta);
    // Animar ripples (anillos)
    updateRipples(delta);
    // Animar playback (timeline)
    updatePlayback(delta);

    renderer.render(scene, camera);
}

// Crea un halo (sprite) en la posición de una instancia y lo anima
function createHaloFromInstanced(inst, localId, colorHex) {
    if (!inst || typeof localId !== 'number') return;
    // obtener matriz base
    const baseMat = inst.userData && inst.userData.baseMatrices && inst.userData.baseMatrices[localId];
    if (!baseMat) return;
    const tmpObj = new THREE.Object3D();
    tmpObj.matrix.copy(baseMat);
    tmpObj.matrix.decompose(tmpObj.position, tmpObj.quaternion, tmpObj.scale);
    // Crear textura circular en canvas (radial gradient) para el halo, tintada con colorHex
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    // convertir colorHex a rgba
    let r = 255, g = 255, b = 0;
    if (typeof colorHex === 'number') {
        r = (colorHex >> 16) & 255;
        g = (colorHex >> 8) & 255;
        b = colorHex & 255;
    }
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
    // colores: centro tintado, borde transparente
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(0.25, `rgba(${r},${g},${b},0.85)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},0.45)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;

    // Create a small plane (tangent to the surface) with the circular texture so the halo is tangent and slightly above the surface
    const planeGeom = new THREE.PlaneGeometry(1, 1);
    const planeMat = new THREE.MeshBasicMaterial({
        map: tex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.2,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(planeGeom, planeMat);
    // posicionar ligeramente por encima de la superficie en dirección radial
    const pos = tmpObj.position.clone();
    const normal = pos.clone().normalize();
    const instanceScale = (tmpObj.scale && tmpObj.scale.x) ? tmpObj.scale.x : 0;
    const baseOffset = 0.008; // un poco más separado para evitar intersección visual
    const scaleOffset = Math.min(0.03, instanceScale * 0.6);
    const nudged = pos.clone().add(normal.clone().multiplyScalar(baseOffset + scaleOffset));
    plane.position.copy(nudged);
    // orientar el plano para que su normal (0,0,1) coincida con la normal de la superficie
    const planeNormal = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(planeNormal, normal.clone().normalize());
    plane.quaternion.copy(q);
    // tamaño inicial relativo (escalar para verse bien sobre el globo)
    const baseScale = (tmpObj.scale.x || 0.005) * 10;
    plane.scale.set(baseScale, baseScale, 1);
    scene.add(plane);
    // guardar halo para animación: fade out y scale up (usamos 'object' key)
    window.activeHalos.push({ object: plane, age: 0, life: 1.0, baseScale, tex });
}

// Animar halos en el loop
function animateHalos(delta) {
    if (!window.activeHalos || window.activeHalos.length === 0) return;
    for (let i = window.activeHalos.length - 1; i >= 0; i--) {
        const h = window.activeHalos[i];
        h.age += delta;
        const t = h.age / h.life;
        if (t >= 1) {
            // remover
            if (h.object) {
                scene.remove(h.object);
                if (h.object.geometry) h.object.geometry.dispose();
                if (h.object.material) h.object.material.dispose();
            }
            if (h.tex) { h.tex.dispose && h.tex.dispose(); }
            window.activeHalos.splice(i, 1);
            continue;
        }
        // scale up y fade out
        const scale = h.baseScale * (1 + t * 1.8);
        if (h.object) {
            h.object.scale.set(scale, scale, 1);
            if (h.object.material) h.object.material.opacity = 0.9 * (1 - t);
        }
    }
}

// --- Ripple / Ring effect functions ---
function createRipple(position, colorHex = 0xffffff) {
    if (!position) return;
    // allow optional magnitude by passing as third arg via arguments
    const mag = (arguments.length >= 3 && typeof arguments[2] === 'number') ? arguments[2] : null;
    // Plane geometry with UVs; shader will draw a soft ring
    const geom = new THREE.PlaneGeometry(1, 1);
    const uniforms = {
        uColor: { value: new THREE.Color(colorHex) },
        uProgress: { value: 0.0 },
        uOpacity: { value: 1.0 },
        uThickness: { value: 0.06 }
    };
    const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWorldPos;
            void main() {
                vUv = uv;
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPos = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uProgress;
            uniform float uOpacity;
            uniform float uThickness;
            varying vec2 vUv;
            void main() {
                vec2 c = vUv - vec2(0.5);
                float dist = length(c);
                // radius grows via mesh scale; shader only controls ring softness and alpha
                float radius = 0.5;
                float edge = uThickness * (1.0 - uProgress*0.9);
                float a = 1.0 - smoothstep(radius - edge, radius + edge, dist);
                // fade out with progress
                float fade = 1.0 - uProgress;
                float alpha = a * fade * uOpacity;
                if (alpha <= 0.0001) discard;
                gl_FragColor = vec4(uColor * alpha, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geom, mat);
    // position slightly above surface
    const normal = position.clone().normalize();
    mesh.position.copy(position.clone().add(normal.multiplyScalar(0.004)));
    // align plane normal (0,0,1) to surface normal
    const planeNormal = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(planeNormal, normal.clone().normalize());
    mesh.quaternion.copy(q);

    // size depends on magnitude (if provided)
    const baseTarget = mag ? THREE.MathUtils.lerp(0.06, 0.18, Math.min(1, (mag - 1) / 6)) : 0.12;
    mesh.scale.setScalar(0.001);
    mesh.userData = { age: 0, life: 1.2, targetScale: baseTarget, uniforms };
    scene.add(mesh);
    window.activeRipples.push(mesh);
}

function updateRipples(delta) {
    const arr = window.activeRipples;
    if (!arr || arr.length === 0) return;
    for (let i = arr.length - 1; i >= 0; i--) {
        const r = arr[i];
        r.userData.age += delta;
        const t = Math.min(1, r.userData.age / r.userData.life);
        // ease out for scale
        const ease = 1 - Math.pow(1 - t, 2);
        const target = r.userData.targetScale || 0.12;
        const scale = THREE.MathUtils.lerp(0.001, target, ease);
        r.scale.setScalar(scale);
        // update shader progress uniform for soft fade
        if (r.material && r.material.uniforms && r.material.uniforms.uProgress) {
            r.material.uniforms.uProgress.value = t;
            // reduce overall opacity over life
            r.material.uniforms.uOpacity.value = THREE.MathUtils.lerp(1.0, 0.0, t);
        } else if (r.material) {
            r.material.opacity = THREE.MathUtils.lerp(0.9, 0, t);
        }
        if (t >= 1) {
            scene.remove(r);
            if (r.geometry) r.geometry.dispose();
            if (r.material) r.material.dispose();
            arr.splice(i, 1);
        }
    }
}

// --- Starfield & parallax subtle movement ---
let starFieldObj = null;
function createStarfield() {
    // Two layers: many faint small stars + few brighter stars
    // aumentar densidad para fondo más denso
    const smallCount = 20200;
    const bigCount = 10000;
    const smallDist = 45;
    const bigDist = 50;
    // small stars with subtle color variation via vertex colors
    const smallPos = new Float32Array(smallCount * 3);
    const smallColors = new Float32Array(smallCount * 3);
    for (let i = 0; i < smallCount; i++) {
        const u = Math.random();
        const theta = Math.acos(1 - 2 * u);
        const phi = Math.random() * Math.PI * 2;
        const r = smallDist * (1 + (Math.random() - 0.5) * 0.12);
        const x = r * Math.sin(theta) * Math.cos(phi);
        const y = r * Math.cos(theta);
        const z = r * Math.sin(theta) * Math.sin(phi);
        smallPos[i * 3] = x;
        smallPos[i * 3 + 1] = y;
        smallPos[i * 3 + 2] = z;
        // subtle bluish-white to faint amber variation
        const col = new THREE.Color().setHSL(0.58 + Math.random() * 0.06, 0.6, 0.6 + Math.random() * 0.15);
        smallColors[i * 3] = col.r;
        smallColors[i * 3 + 1] = col.g;
        smallColors[i * 3 + 2] = col.b;
    }
    const smallGeom = new THREE.BufferGeometry();
    smallGeom.setAttribute('position', new THREE.BufferAttribute(smallPos, 3));
    smallGeom.setAttribute('color', new THREE.BufferAttribute(smallColors, 3));
    const smallMat = new THREE.PointsMaterial({ vertexColors: true, size: 0.045, sizeAttenuation: true, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending });
    const smallPoints = new THREE.Points(smallGeom, smallMat);
    smallPoints.name = 'stars_small';
    scene.add(smallPoints);

    const bigPos = new Float32Array(bigCount * 3);
    for (let i = 0; i < bigCount; i++) {
        const u = Math.random();
        const theta = Math.acos(1 - 2 * u);
        const phi = Math.random() * Math.PI * 2;
        const r = bigDist * (1 + (Math.random() - 0.5) * 0.08);
        const x = r * Math.sin(theta) * Math.cos(phi);
        const y = r * Math.cos(theta);
        const z = r * Math.sin(theta) * Math.sin(phi);
        bigPos[i * 3] = x;
        bigPos[i * 3 + 1] = y;
        bigPos[i * 3 + 2] = z;
    }
    const bigGeom = new THREE.BufferGeometry();
    bigGeom.setAttribute('position', new THREE.BufferAttribute(bigPos, 3));
    const bigMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, sizeAttenuation: true, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending });
    const bigPoints = new THREE.Points(bigGeom, bigMat);
    bigPoints.name = 'stars_big';
    scene.add(bigPoints);

    // faint dust layer to add depth (very subtle)
    const dustCount = 5000;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
        const u = Math.random();
        const theta = Math.acos(1 - 2 * u);
        const phi = Math.random() * Math.PI * 2;
        const r = (smallDist + 4) * (1 + (Math.random() - 0.5) * 0.08);
        const x = r * Math.sin(theta) * Math.cos(phi);
        const y = r * Math.cos(theta);
        const z = r * Math.sin(theta) * Math.sin(phi);
        dustPos[i * 3] = x;
        dustPos[i * 3 + 1] = y;
        dustPos[i * 3 + 2] = z;
    }
    const dustGeom = new THREE.BufferGeometry();
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ color: 0x7aa3c9, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.06 });
    const dustPoints = new THREE.Points(dustGeom, dustMat);
    dustPoints.name = 'stars_dust';
    scene.add(dustPoints);

    // expose an approximate outer radius for the starfield so other systems (camera limits)
    // can compute safe bounds. bigDist is the largest radius used for the star positions.
    window.starfieldOuterRadius = bigDist;
    starFieldObj = { small: smallPoints, big: bigPoints, time: 0 };
}

// Procedural nebula background (simple fullscreen shader as skybox substitute)
let nebulaMesh = null;
function createNebulaBackground() {
    // create a large inverted sphere with a shader for subtle gradient / band
    const geom = new THREE.SphereGeometry(200, 32, 32);
    const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
        uniforms: {
            uTime: { value: 0 },
            uColorA: { value: new THREE.Color(0x030417) },
            uColorB: { value: new THREE.Color(0x081229) },
            uBandColor: { value: new THREE.Color(0x0b2540) }
        },
        vertexShader: `
            varying vec3 vPos;
            void main(){
                vPos = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uColorA;
            uniform vec3 uColorB;
            uniform vec3 uBandColor;
            varying vec3 vPos;
            // simple noise replacement using sin for soft banding
            void main(){
                float theta = atan(vPos.z, vPos.x);
                float lat = vPos.y / 200.0;
                float band = smoothstep(-0.15, 0.15, sin(theta * 3.0 + uTime * 0.02) * 0.6 + lat * 1.2);
                vec3 col = mix(uColorA, uColorB, 0.5 + 0.5 * lat);
                // fortalecer banda y mezclar un poco más para densidad
                col = mix(col, uBandColor, band * 0.85);
                // sutil vignetting para oscurecer bordes
                float vign = smoothstep(1.0, 0.3, length(vPos.xy) / 200.0);
                col *= 0.5 + 0.5 * vign;
                gl_FragColor = vec4(col, 1.0);
            }
        `
    });
    nebulaMesh = new THREE.Mesh(geom, mat);
    nebulaMesh.name = 'nebula_bg';
    scene.add(nebulaMesh);
}

function updateStars(delta) {
    if (!starFieldObj) return;
    starFieldObj.time += delta;
    // rotaciones muy sutiles para dar vida
    starFieldObj.small.rotation.y += delta * 0.004;
    starFieldObj.big.rotation.y += delta * 0.0025;
    // parallax: desplazar ligeramente según movimiento de la cámara (muy tenue)
    const cam = camera.position.clone().multiplyScalar(0.0002);
    starFieldObj.small.position.lerp(cam, 0.015);
    starFieldObj.big.position.lerp(cam, 0.01);
    // pequeño twinkle (no por estrella, para mantener performance)
    if (starFieldObj.small.material) starFieldObj.small.material.opacity = 0.22 + 0.06 * Math.sin(starFieldObj.time * 1.1);
    if (starFieldObj.big.material) starFieldObj.big.material.opacity = 0.55 + 0.08 * Math.sin(starFieldObj.time * 0.6 + 1.2);
}

// --- Obtener y mostrar sismos ---
// fetchEarthquakes now requires an explicit flag (options.explicit=true) to run.
// This prevents accidental automatic searches on load or from other code paths.
function fetchEarthquakes(filtros = {}, options = { explicit: false }) {
    if (!options || !options.explicit) {
        // silently ignore non-explicit calls to avoid unwanted searches
        console.debug('fetchEarthquakes ignored: explicit flag not set');
        return;
    }
    // mark that a search was initiated by the user
    window.hasRunSearch = true;
    showLoading(true);
    // Mostrar cartel de resultados (si existe)
    const resultadosDiv = document.getElementById('resultados-count');
    if (resultadosDiv) {
        resultadosDiv.style.display = 'none';
        resultadosDiv.innerHTML = '';
    }
    // Depth display removed: always show markers on the surface
    window.mostrarProfundidadSismos = false;
    // Guardar rango de playback si el usuario lo especificó en el formulario
    if (filtros.starttime) {
        // starttime comes as YYYY-MM-DD -> start of that day
        const s = new Date(filtros.starttime + 'T00:00:00Z');
        window.playbackFilterStartMillis = s.getTime();
    } else {
        window.playbackFilterStartMillis = null;
    }
    if (filtros.endtime) {
        // end of day
        const e = new Date(filtros.endtime + 'T23:59:59Z');
        window.playbackFilterEndMillis = e.getTime();
    } else {
        window.playbackFilterEndMillis = null;
    }
    // Guardar filtros de magnitud si existen
    window.playbackFilterMinMag = (typeof filtros.minmagnitude !== 'undefined' && filtros.minmagnitude !== null && filtros.minmagnitude !== '') ? Number(filtros.minmagnitude) : null;
    window.playbackFilterMaxMag = (typeof filtros.maxmagnitude !== 'undefined' && filtros.maxmagnitude !== null && filtros.maxmagnitude !== '') ? Number(filtros.maxmagnitude) : null;
    // Limpiar marcadores anteriores
    if (window.earthquakeMarkers) {
        window.earthquakeMarkers.forEach(m => scene.remove(m));
        window.earthquakeMarkers = [];
    
    }

    // Construir URL con filtros
    // request results ordered by magnitude desc so we can pick the strongest within the time window
    let url = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=magnitude';
    if (filtros.starttime) url += `&starttime=${filtros.starttime}`;
    if (filtros.endtime) url += `&endtime=${filtros.endtime}`;
    if (filtros.minmagnitude) url += `&minmagnitude=${filtros.minmagnitude}`;
    if (filtros.maxmagnitude) url += `&maxmagnitude=${filtros.maxmagnitude}`;
    url += '&limit=3000'; // máximo permitido por la app

    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (!data.features || data.features.length === 0) {
                if (resultadosDiv) {
                    resultadosDiv.style.display = 'block';
                    resultadosDiv.innerHTML = 'No se encontraron sismos con esos filtros.';
                }
                // disclaimer removed; nothing to toggle
                showLoading(false);
                setPlaybackControlsEnabled(false);
                return;
            }
            if (resultadosDiv) {
                resultadosDiv.style.display = 'block';
                // If the API returned the maximum allowed, clarify we show the strongest 3000
                if (data.features.length >= 3000) {
                    resultadosDiv.innerHTML = `Mostrando <b>3000</b> sismos (los más intensos dentro del rango seleccionado).`;
                } else {
                    resultadosDiv.innerHTML = `Mostrando <b>${data.features.length}</b> sismos en el globo.`;
                }
            }
            // Usar InstancedMesh para rendimiento si hay muchos sismos
            setupInstancedMarkers(data.features);
            // store a cleaned array for exports (preserve important fields)
            try {
                window.earthquakeData = data.features.map(f => {
                    const props = f.properties || {};
                    const coords = (f.geometry && f.geometry.coordinates) ? f.geometry.coordinates : [];
                    return { mag: props.mag, place: props.place, time: props.time, depth: props.depth || props.depthKm || null, properties: props, longitude: coords[0], latitude: coords[1] };
                });
                // also keep a stable snapshot of the full search results so the Info panel shows totals
                try { window._gdv_lastSearchResults = window.earthquakeData.slice(); } catch(e) { window._gdv_lastSearchResults = window.earthquakeData; }
            } catch (e) { window.earthquakeData = []; window._gdv_lastSearchResults = []; }
            try { if (typeof updateDownloadButtons === 'function') updateDownloadButtons(); } catch(e) {}
            // preparar playback usando los datos retornados y filtros actuales
            try { preparePlaybackFromData(); } catch (e) { /* no crítico */ }
            // habilitar controles de playback ahora que hay datos
            setPlaybackControlsEnabled(true);
            showLoading(false);
        })
        .catch(() => {
            if (resultadosDiv) {
                resultadosDiv.style.display = 'block';
                resultadosDiv.innerHTML = 'Error al consultar la API de USGS.';
            }
            // disclaimer removed; nothing to toggle
            showLoading(false);
            setPlaybackControlsEnabled(false);
        });
}
// --- Formulario de filtros ---
function agregarFormularioFiltros() {
    const contenedor = document.getElementById('filtros-container') || document.body;
    const form = document.createElement('form');
    form.id = 'form-filtros';
    form.className = 'filter-form';
    // styling handled via CSS to keep the form compact and card-like
    form.style = 'margin: 6px 0; color: #fff;';
    // disclaimer removed per UI simplification

    // Cartel de cantidad de resultados
    const resultadosDiv = document.createElement('div');
    resultadosDiv.id = 'resultados-count';
    resultadosDiv.style = 'width:100%;color:#fff;background:#333;padding:6px 10px;margin-bottom:6px;border-radius:6px;font-size:0.95em;display:none;';

    form.innerHTML = `
        <div class="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#ffb300"/>
                <circle cx="12" cy="9" r="2.2" fill="#081018" />
            </svg>
            Filtros
            <button type="button" id="left-toggle" class="toggle-btn" aria-expanded="true" aria-label="Minimizar panel">−</button>
        </div>
        <div class="field-row">
            <div class="field-label">Desde</div>
            <input class="field-input" type="date" name="starttime" required>
        </div>
        <div class="field-row">
            <div class="field-label">Hasta</div>
            <input class="field-input" type="date" name="endtime" required>
        </div>
        <div class="field-row mag-row">
            <label>Mag. mín:<input class="small-input" type="number" name="minmagnitude" min="0" max="10" step="0.1" value="0"></label>
            <label>Mag. máx:<input class="small-input" type="number" name="maxmagnitude" min="0" max="10" step="0.1" value="10"></label>
        </div>
        <div class="field-row">
            <button type="submit">Buscar</button>
        </div>
        <div class="filters-download-inline" style="margin-top:10px;padding-top:8px;border-top:1px dashed rgba(255,255,255,0.02);display:flex;flex-direction:column;gap:6px;align-items:center;">
            <div style="font-size:0.85rem;color:var(--muted);text-align:center;">Exporta los sismos de la consulta actual para análisis offline (JSON o CSV).</div>
            <div style="display:flex;gap:8px;margin-top:6px;">
                <button type="button" id="download-json-left" class="toggle-btn download-btn" title="Descargar resultados (JSON)">JSON</button>
                <button type="button" id="download-csv-left" class="toggle-btn download-btn" title="Descargar resultados (CSV)">CSV</button>
            </div>
        </div>
    `;
    // Insertar cartel y formulario (disclaimer eliminado)
    if (contenedor.id === 'filtros-container') {
        contenedor.appendChild(resultadosDiv);
        contenedor.appendChild(form);
    } else {
        document.body.insertBefore(resultadosDiv, document.body.firstChild);
        document.body.insertBefore(form, resultadosDiv.nextSibling);
    }
    // Valores por defecto: últimas 24h (start = ayer, end = hoy)
    const hoyDate = new Date();
    const ayerDate = new Date(hoyDate.getTime() - 24 * 60 * 60 * 1000);
    form.starttime.value = ayerDate.toISOString().slice(0, 10);
    form.endtime.value = hoyDate.toISOString().slice(0, 10);
    form.addEventListener('submit', e => {
        e.preventDefault();
        const filtros = {
            starttime: form.starttime.value,
            endtime: form.endtime.value,
            minmagnitude: form.minmagnitude.value ? Number(form.minmagnitude.value) : undefined,
            maxmagnitude: form.maxmagnitude.value ? Number(form.maxmagnitude.value) : undefined
        };
        // Explicit user-initiated search
        fetchEarthquakes(filtros, { explicit: true });
    });
    // Mostrar todos los sismos en superficie por defecto (profundidad OUT por ahora)
    window.mostrarProfundidadSismos = false;
}

    // download buttons now embedded inline in the form (see form.innerHTML)

// Load textures by multiple strategies:
// 1) Try textures/manifest.json (preferred)
// 2) Try fetching the directory listing at textures/ and parse <a href> links (works with Live Server)
// 3) Fallback to checking textures/earth_texture.jpg
async function loadTextureManifest() {
    // 1) manifest.json
    try {
        const res = await fetch('textures/manifest.json');
        if (res && res.ok) {
            const list = await res.json();
            return Array.isArray(list) ? list.map((it, idx) => ({ id: it.id || `layer${idx}`, file: it.file, name: it.name || it.file, opacity: it.opacity })) : [];
        }
    } catch (e) {
        // ignore and continue to next strategy
    }

    // 2) directory listing parse (if server returns an index HTML)
    try {
        const txt = await fetch('textures/').then(r => r.text());
        // find hrefs
        const files = [];
        const re = /href=["']?([^"' >]+)["']?/gi;
        let m;
        while ((m = re.exec(txt)) !== null) {
            const href = decodeURIComponent(m[1]);
            // ignore parent links
            if (href === '../' || href === './') continue;
            // extract filename from href
            const parts = href.split('/');
            const fname = parts[parts.length - 1];
            if (!fname) continue;
            // accept image files that include _texture in their name
            if (/_texture\.(jpg|jpeg|png|webp|gif)$/i.test(fname)) {
                files.push(fname);
            }
        }
        if (files.length > 0) {
            // map to entries with id and friendly name (text before _texture)
            return files.map((f, i) => {
                const base = f.replace(/_texture\.[^.]+$/i, '');
                const name = base.replace(/[_-]+/g, ' ').replace(/(^|\s)\S/g, s => s.toUpperCase());
                return { id: `layer${i}`, file: f, name };
            });
        }
    } catch (e) {
        // continue to fallback
    }

    // 3) fallback check for earth_texture.jpg
    const fallback = [];
    try {
        const r2 = await fetch('textures/earth_texture.jpg', { method: 'HEAD' });
        if (r2 && (r2.ok || r2.status === 200)) fallback.push({ id: 'earth', file: 'earth_texture.jpg', name: 'Base (Earth)' });
    } catch (e) {}
    return fallback;
}

// Create a texture layer mesh (slightly above the globe surface) and register it
function createTextureLayer(entry) {
    if (!entry || !entry.file) return null;
    const loader = new THREE.TextureLoader();
    const tex = loader.load(`textures/${entry.file}`);
    tex.encoding = THREE.sRGBEncoding;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshPhongMaterial({ map: tex, transparent: true, opacity: (typeof entry.opacity === 'number' ? entry.opacity : 1.0) });
    const geom = new THREE.SphereGeometry(1.001 + (entry.offset || 0.001), 64, 64);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.y = Math.PI;
    mesh.visible = !!entry.visible;
    scene.add(mesh);
    window.textureLayers[entry.id] = { mesh, url: `textures/${entry.file}`, name: entry.name || entry.file, visible: !!entry.visible, opacity: mat.opacity };
    return window.textureLayers[entry.id];
}

function setTextureLayerVisibility(id, visible) {
    const t = window.textureLayers[id];
    if (!t) return;
    t.visible = !!visible;
    if (t.mesh) t.mesh.visible = !!visible;
}

function setTextureLayerOpacity(id, opacity) {
    const t = window.textureLayers[id];
    if (!t) return;
    t.opacity = Math.max(0, Math.min(1, Number(opacity) || 0));
    if (t.mesh && t.mesh.material) t.mesh.material.opacity = t.opacity;
}

// Build UI controls for textures inside the filters form
function buildTextureControls(list) {
    const cont = document.getElementById('filtros-container');
    if (!cont) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'field-row texture-controls';
    const title = document.createElement('div');
    title.className = 'field-label';
    title.textContent = 'Capas de textura';
    wrapper.appendChild(title);

    const box = document.createElement('div');
    box.style = 'display:flex;flex-direction:column;gap:6px;align-items:center;';

    // If no entries, show a helper message
    if (!list || list.length === 0) {
        const helper = document.createElement('div');
        helper.style = 'color:var(--muted);font-size:0.9rem;';
        helper.textContent = 'No hay capas en /textures. Coloca imágenes (ej. PNG con transparencia) y añade textures/manifest.json para listarlas.';
        box.appendChild(helper);
        wrapper.appendChild(box);
        cont.appendChild(wrapper);
        return;
    }

    // Build a single-select dropdown for base textures (only one active at a time)
    const selectWrapper = document.createElement('div');
    selectWrapper.className = 'texture-select-wrapper';
    const select = document.createElement('select');
    select.className = 'texture-select';
    select.id = 'texture-select';

    // determine default: prefer id === 'earth' if present, otherwise first entry
    let defaultId = null;
    if (list.some(l => l.id === 'earth')) defaultId = 'earth';
    else if (list.length > 0) defaultId = list[0].id || list[0].file;

    list.forEach((entry) => {
        const id = entry.id || entry.file;
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = entry.name || entry.file;
        select.appendChild(opt);
        const visible = (id === defaultId);
        // create layers now; the visible flag ensures only the selected one is shown
        createTextureLayer({ id, file: entry.file, name: entry.name, visible: visible, opacity: 1.0 });
    });

    if (defaultId) select.value = defaultId;
    select.addEventListener('change', () => {
        activateBaseTexture(select.value);
    });

    selectWrapper.appendChild(select);
    box.appendChild(selectWrapper);
    wrapper.appendChild(box);
    cont.appendChild(wrapper);
}

// Activate a single base texture and hide all other texture layers
function activateBaseTexture(id) {
    Object.keys(window.textureLayers || {}).forEach(key => {
        const t = window.textureLayers[key];
        if (!t) return;
        const should = (key === id);
        t.visible = should;
        if (t.mesh) t.mesh.visible = should;
    });
}

// --- Playback / Timeline UI & Engine ---
function createPlaybackControls() {
    const container = document.getElementById('playback-container') || document.createElement('div');
    container.id = 'playback-container';
    container.style = 'position: absolute; left: 12px; bottom: 14px; background: rgba(8,8,12,0.6); color: #fff; padding: 8px; border-radius: 8px; display:flex; gap:8px; align-items:center; z-index:9999;';
    // play/pause
    const btn = document.createElement('button');
    btn.id = 'playback-play';
    btn.textContent = 'Play';
    btn.style.padding = '6px 10px';
    btn.addEventListener('click', () => {
        if (window.playbackRunning) pausePlayback();
        else startPlayback();
    });
    // slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'playback-slider';
    slider.min = 0;
    slider.max = 1000;
    slider.value = 0;
    slider.style.width = '360px';
    slider.addEventListener('input', () => {
        const v = Number(slider.value) / 1000;
        seekPlayback(v * window.playbackDurationSec);
    });
    
    // Más info button will be appended to the container after the duration input
    const moreBtn = document.createElement('button');
    moreBtn.id = 'more-info-btn';
    moreBtn.textContent = 'Más info';
    moreBtn.style.padding = '6px 10px;cursor:pointer;background:#29455a;color:#eaf6ff;border-radius:6px;border:0;';
    moreBtn.title = 'Mostrar estadísticas y gráficos de la búsqueda';
    moreBtn.addEventListener('click', () => { toggleInfoPanel(); });
    // total duration input (minutes) -> compute multiplier automatically
    const durWrapper = document.createElement('div');
    durWrapper.style = 'display:flex;flex-direction:column;align-items:flex-start;gap:4px;';
    const durLabel = document.createElement('label');
    durLabel.style.fontSize = '0.85em';
    durLabel.textContent = 'Duración (min):';
    const durInput = document.createElement('input');
    durInput.type = 'number';
    durInput.id = 'playback-target-minutes';
    durInput.min = '0.1';
    durInput.step = '0.1';
    // initialize from saved minutes if present
    const initMin = (function(){ try { return Number(localStorage.getItem('playback_target_minutes')); } catch(e) { return null; } })();
    durInput.value = String(initMin && !isNaN(initMin) ? Math.max(0.1, initMin) : Math.max(0.1, Math.round((window.playbackTargetDurationSec/60)*10)/10));
    durInput.style.width = '64px';
    durInput.addEventListener('change', () => {
        const mins = Math.max(0.1, Number(durInput.value) || 0.1);
        window.playbackTargetDurationSec = mins * 60;
    try { localStorage.setItem('playback_target_minutes', String(mins)); } catch(e){}
        computePlaybackSpeed();
    });
    durWrapper.appendChild(durLabel);
    durWrapper.appendChild(durInput);
    container.appendChild(btn);
    container.appendChild(slider);
    container.appendChild(durWrapper);
    // append the More Info button after the duration control
    container.appendChild(moreBtn);

    // small HUD: current playback timestamp and shown event count
    const hud = document.createElement('div');
    hud.id = 'playback-hud';
    hud.style = 'margin-left:8px; font-family:monospace; font-size:0.9em; color:#dfefff; background: rgba(0,0,0,0.18); padding:6px 8px; border-radius:6px; min-width:200px;';
    hud.innerHTML = '<div id="playback-hud-time">--</div><div id="playback-hud-count">Eventos: 0</div>';
    container.appendChild(hud);

    if (!document.getElementById('playback-container')) document.body.appendChild(container);
}

// Helper to enable/disable playback controls (Play button, slider, speed)
function setPlaybackControlsEnabled(enabled) {
    const btn = document.getElementById('playback-play');
    const slider = document.getElementById('playback-slider');
    const speed = document.querySelector('#playback-container select');
    if (btn) btn.disabled = !enabled;
    if (slider) slider.disabled = !enabled;
    if (speed) speed.disabled = !enabled;
    const hud = document.getElementById('playback-hud');
    if (hud) hud.style.display = enabled ? 'block' : 'none';
}

// Update the on-screen playback HUD (time + shown event count)
function updatePlaybackHUD() {
    const hudTime = document.getElementById('playback-hud-time');
    const hudCount = document.getElementById('playback-hud-count');
    if (!hudTime || !hudCount) return;
    if (!window.playbackStartMillis || !window.playbackDurationSec) {
        hudTime.textContent = '--';
        hudCount.textContent = 'Eventos: 0';
        return;
    }
    const targetMillis = window.playbackStartMillis + (window.playbackTimeSec || 0) * 1000;
    const dt = new Date(targetMillis);
    hudTime.textContent = `Tiempo: ${dt.toLocaleString()}`;
    // compute count of revealed events (playbackOrdered may be large but it's OK)
    let shown = 0;
    if (Array.isArray(window.playbackOrdered)) {
        for (let i = 0; i < window.playbackOrdered.length; i++) {
            if (window.playbackOrdered[i].time <= targetMillis) shown++; else break;
        }
    }
    hudCount.textContent = `Eventos: ${shown} / ${(window.playbackOrdered||[]).length}`;
}

function preparePlaybackFromData() {
    if (!window.earthquakeData || window.earthquakeData.length === 0) return;
    // ordena por tiempo asc
    const arr = [];
    for (let i = 0; i < window.earthquakeData.length; i++) {
        const d = window.earthquakeData[i];
        if (!d || !d.time) continue;
    // apply playback filter bounds if present
    const t = d.time;
    if (window.playbackFilterStartMillis && t < window.playbackFilterStartMillis) continue;
    if (window.playbackFilterEndMillis && t > window.playbackFilterEndMillis) continue;
    // apply magnitude filters if present
    const mag = typeof d.mag === 'number' ? d.mag : (d.properties && typeof d.properties.mag === 'number' ? d.properties.mag : null);
    if (window.playbackFilterMinMag !== null && mag !== null && mag < window.playbackFilterMinMag) continue;
    if (window.playbackFilterMaxMag !== null && mag !== null && mag > window.playbackFilterMaxMag) continue;
    arr.push({ globalIdx: i, time: t });
    }
    arr.sort((a,b) => a.time - b.time);
    window.playbackOrdered = arr;
    // set bounds: prefer explicit filter bounds if provided
    if (window.playbackFilterStartMillis) window.playbackStartMillis = window.playbackFilterStartMillis;
    else window.playbackStartMillis = arr[0] ? arr[0].time : 0;
    if (window.playbackFilterEndMillis) window.playbackEndMillis = window.playbackFilterEndMillis;
    else window.playbackEndMillis = arr[arr.length-1] ? arr[arr.length-1].time : window.playbackStartMillis;
    window.playbackDurationSec = Math.max(1, (window.playbackEndMillis - window.playbackStartMillis) / 1000);
    window.playbackTimeSec = 0;
    window.playbackNextPtr = 0;
    window.playbackPlayed = new Set();
    // update slider range if exists
    const slider = document.getElementById('playback-slider');
    if (slider) { slider.min = 0; slider.max = 1000; slider.value = 0; }
    // build mapping of instances
    buildPlaybackInstanceMap();
    // Do not auto-hide instances here; leave markers visible after a search.
    // Playback will reset to empty when the user explicitly starts it.
    // compute multiplier according to user's chosen target duration
    try { computePlaybackSpeed(); } catch(e) {}
}

// Compute playback multiplier so the entire playbackDurationSec fits into playbackTargetDurationSec
function computePlaybackSpeed() {
    if (!window.playbackDurationSec || window.playbackDurationSec <= 0) {
        window.playbackSpeed = 1.0;
    } else {
        const target = Math.max(0.1, window.playbackTargetDurationSec || 60);
    window.playbackSpeed = window.playbackDurationSec / target;
    }
    // update HUD
    try { updatePlaybackHUD(); } catch(e){}
}

function buildPlaybackInstanceMap() {
    window.playbackInstanceMap = {};
    if (!window.earthquakeInstanced || !window.earthquakeInstanced.meshes) return;
    for (const mesh of window.earthquakeInstanced.meshes) {
        if (!mesh.userData || !mesh.userData.globalIndexMap) continue;
        for (const localKey of Object.keys(mesh.userData.globalIndexMap)) {
            const local = Number(localKey);
            const globalIdx = mesh.userData.globalIndexMap[local];
            const baseMat = mesh.userData.baseMatrices && mesh.userData.baseMatrices[local] ? mesh.userData.baseMatrices[local].clone() : null;
            window.playbackInstanceMap[globalIdx] = { mesh, local, baseMat };
        }
    }
}

function applyPlaybackState(seconds) {
    if (!window.playbackOrdered || !window.playbackInstanceMap) return;
    const targetMillis = window.playbackStartMillis + seconds * 1000;
    // For performance, iterate playbackOrdered and set instance matrices
    for (let i = 0; i < window.playbackOrdered.length; i++) {
        const ev = window.playbackOrdered[i];
        const mapEntry = window.playbackInstanceMap[ev.globalIdx];
        if (!mapEntry) continue;
        const { mesh, local, baseMat } = mapEntry;
        if (!baseMat || !mesh) continue;
        const shouldShow = ev.time <= targetMillis;
        const tmpObj = new THREE.Object3D();
        tmpObj.matrix.copy(baseMat);
        tmpObj.matrix.decompose(tmpObj.position, tmpObj.quaternion, tmpObj.scale);
        if (!shouldShow) tmpObj.scale.setScalar(1e-6);
        tmpObj.updateMatrix();
        mesh.setMatrixAt(local, tmpObj.matrix);
        mesh.instanceMatrix.needsUpdate = true;
    }
}

function startPlayback() {
    if (!window.playbackOrdered || window.playbackOrdered.length === 0) preparePlaybackFromData();
    // Reset to start (empty globe) before playing so playback reveals events chronologically
    try {
        applyPlaybackState(0);
    } catch(e) {}
    window.playbackNextPtr = 0;
    window.playbackTimeSec = 0;
    window.playbackRunning = true;
    const btn = document.getElementById('playback-play'); if (btn) btn.textContent = 'Pause';
    // debug
    try { console.debug('[playback] startPlayback -> running:', window.playbackRunning, 'timeSec:', window.playbackTimeSec, 'duration:', window.playbackDurationSec, 'orderedLen:', (window.playbackOrdered||[]).length); } catch(e){}
    // update HUD immediately
    try { updatePlaybackHUD(); } catch(e){}
}

function pausePlayback() {
    window.playbackRunning = false;
    const btn = document.getElementById('playback-play');
    if (btn) btn.textContent = 'Play';
    try { console.debug('[playback] pausePlayback -> running:', window.playbackRunning); } catch(e){}
}

function seekPlayback(seconds) {
    // seconds relative to duration start
    window.playbackTimeSec = Math.max(0, Math.min(window.playbackDurationSec, seconds));
    // find next pointer
    const targetMillis = window.playbackStartMillis + window.playbackTimeSec * 1000;
    let ptr = 0;
    while (ptr < window.playbackOrdered.length && window.playbackOrdered[ptr].time <= targetMillis) ptr++;
    window.playbackNextPtr = ptr;
    // update slider UI
    const slider = document.getElementById('playback-slider');
    if (slider) slider.value = Math.floor((window.playbackTimeSec / window.playbackDurationSec) * 1000);
    // apply state immediately
    applyPlaybackState(window.playbackTimeSec);
    try { updatePlaybackHUD(); } catch(e){}
}

function updatePlayback(delta) {
    if (!window.playbackRunning) return;
    // debug: confirm updatePlayback is being called while running
    if (window._playbackDebugCount === undefined) window._playbackDebugCount = 0;
    window._playbackDebugCount++;
    if (window._playbackDebugCount % 60 === 0) {
        try { console.debug('[playback] updatePlayback tick', window._playbackDebugCount, 'delta:', delta, 'timeSec:', window.playbackTimeSec, 'running:', window.playbackRunning); } catch(e){}
    }
    // If playback wasn't prepared (e.g. user pressed Play before data prepared), try to prepare now
    if (!window.playbackOrdered || window.playbackOrdered.length === 0) {
        try { preparePlaybackFromData(); } catch (e) { /* non-critical */ }
        if (!window.playbackOrdered || window.playbackOrdered.length === 0) return;
    }
    // Ensure instance map exists (in case it was not built or was cleared)
    if (!window.playbackInstanceMap) {
        try { buildPlaybackInstanceMap(); } catch (e) { /* non-critical */ }
    }
    // advance time by delta * speed
    window.playbackTimeSec += delta * window.playbackSpeed;
    if (window.playbackTimeSec > window.playbackDurationSec) {
        // stop at end
        window.playbackTimeSec = window.playbackDurationSec;
        pausePlayback();
    }
    const targetMillis = window.playbackStartMillis + window.playbackTimeSec * 1000;
    // play events up to targetMillis
    while (window.playbackNextPtr < window.playbackOrdered.length && window.playbackOrdered[window.playbackNextPtr].time <= targetMillis) {
        const ev = window.playbackOrdered[window.playbackNextPtr];
        const d = window.earthquakeData[ev.globalIdx];
        if (d) {
            // faster: use playbackInstanceMap built earlier to find mesh/local/baseMat
            const mapEntry = window.playbackInstanceMap && window.playbackInstanceMap[ev.globalIdx];
            if (mapEntry) {
                const { mesh, local, baseMat } = mapEntry;
                // reveal instance by restoring base matrix
                try {
                    if (baseMat && mesh) {
                        mesh.setMatrixAt(local, baseMat);
                        mesh.instanceMatrix.needsUpdate = true;
                    }
                } catch (e) { /* non-blocking */ }
                // create halo + ripple using baseMat position
                try { createHaloFromInstanced(mesh, local, mesh.material.color.getHex()); } catch(e){}
                try {
                    if (baseMat) {
                        const tmp = new THREE.Object3D();
                        tmp.matrix.copy(baseMat);
                        tmp.matrix.decompose(tmp.position, tmp.quaternion, tmp.scale);
                        createRipple(tmp.position, mesh.material.color.getHex(), d.mag);
                    }
                } catch(e){}
            }
        }
        window.playbackNextPtr++;
    }
    // update slider UI
    const slider = document.getElementById('playback-slider');
    if (slider && window.playbackDurationSec > 0) slider.value = Math.floor((window.playbackTimeSec / window.playbackDurationSec) * 1000);
    try { updatePlaybackHUD(); } catch(e){}
}

function addEarthquakeMarker(coords, mag, place, time, properties) {
    // coords: [long, lat, depth]
    const [lon, lat, depth] = coords;
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (-lon + 180) * (Math.PI / 180); // Invertir signo de longitud
    // Mostrar todos los sismos en la superficie (ignoramos profundidad por ahora)
    const r = 1;
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.sin(theta);

    // Nueva categorización en 5 clases:
    // Blanco  : 0.0  - 2.9
    // Verde   : 3.0  - 5.9
    // Amarillo: 6.0  - 6.9
    // Naranja : 7.0  - 7.9
    // Rojo    : 8.0  - 10.0+
    let color;
    if (typeof mag !== 'number') mag = Number(mag);
    if (mag < 3.0) {
        color = 0xffffff; // blanco
    } else if (mag < 6.0) {
        color = 0x2ecc40; // verde
    } else if (mag < 7.0) {
        color = 0xffe066; // amarillo
    } else if (mag < 8.0) {
        color = 0xff9900; // naranja
    } else {
        color = 0xff3333; // rojo
    }

    // Tamaño proporcional por categoría (5 grupos)
    // indices: 0: <3, 1: 3-5.9, 2: 6-6.9, 3: 7-7.9, 4: >=8
    const sizeByGroup = [0.0026, 0.0040, 0.0060, 0.0085, 0.0115];
    let gi = 0;
    if (mag >= 8.0) gi = 4;
    else if (mag >= 7.0) gi = 3;
    else if (mag >= 6.0) gi = 2;
    else if (mag >= 3.0) gi = 1;
    else gi = 0;
    const size = sizeByGroup[gi];
    // Mantener API legacy: crear mesh individual si no usamos instancing
    // usar más segmentos para suavizar la esfera y desactivar flatShading
    const markerGeometry = new THREE.SphereGeometry(size, 24, 24);
    // Usar material PBR para integración visual
    const brightMat = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.04,
        roughness: 0.48,
        envMap: window.sceneEnvMap || null,
        envMapIntensity: window.sceneEnvMap ? 0.9 : 0.0,
        emissive: new THREE.Color(color).multiplyScalar(0.04),
        emissiveIntensity: 0.6,
        clearcoat: 0.18,
        clearcoatRoughness: 0.15,
        transparent: true,
        opacity: 0.98,
        flatShading: false
    });
    // Fresnel rim temporarily disabled (onBeforeCompile removed) to avoid shader inconsistencies on some devices.
    const marker = new THREE.Mesh(markerGeometry, brightMat);
    marker.position.set(x, y, z);
    marker.userData = { mag, place, time, depth, properties };
    scene.add(marker);
    // Drop shadow: small sprite plane tangent to globe slightly beneath the marker
    try {
        const shadowTex = getDropShadowTexture();
        const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.85 });
        const shadowGeom = new THREE.PlaneGeometry(size * 6, size * 6);
        const shadow = new THREE.Mesh(shadowGeom, shadowMat);
        // place slightly above surface toward center
        const normal = new THREE.Vector3(x, y, z).normalize();
        shadow.position.copy(new THREE.Vector3(x, y, z).addScaledVector(normal, -0.0015));
        // orient to be flush with surface
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
        shadow.quaternion.copy(q);
        shadow.renderOrder = 1;
        scene.add(shadow);
        // keep reference so it can be removed together with the marker if needed
        marker.userData._shadow = shadow;
    } catch (e) {}

    // Interacción básica
    marker.callback = () => showEarthquakeDetails(marker.userData);
    if (!window.earthquakeMarkers) window.earthquakeMarkers = [];
    window.earthquakeMarkers.push(marker);
}

// --- Instanced markers implementation ---
function setupInstancedMarkers(features) {
    // limpiar instancias previas
    if (window.earthquakeInstanced && Array.isArray(window.earthquakeInstanced.meshes)) {
        window.earthquakeInstanced.meshes.forEach(m => scene.remove(m));
        window.earthquakeInstanced = null;
    }
    // almacenar datos en paralelo para lookup por globalInstanceIndex
    window.earthquakeData = [];

    const count = features.length;
    // crear 5 grupos de instanced meshes (por rango de magnitud)
    const groups = [
        { min: -Infinity, max: 3.0, color: 0xffffff, items: [] }, // Blanco 0.0 - 2.9
        { min: 3.0, max: 6.0, color: 0x2ecc40, items: [] },       // Verde 3.0 - 5.9
        { min: 6.0, max: 7.0, color: 0xffe066, items: [] },       // Amarillo 6.0 - 6.9
        { min: 7.0, max: 8.0, color: 0xff9900, items: [] },       // Naranja 7.0 - 7.9
        { min: 8.0, max: Infinity, color: 0xff3333, items: [] }   // Rojo 8.0+
    ];

    // Clasificar features por grupo
    for (let i = 0; i < count; i++) {
        const eq = features[i];
        const mag = eq.properties && typeof eq.properties.mag === 'number' ? eq.properties.mag : Number(eq.properties.mag);
        let assigned = false;
        for (let gi = 0; gi < groups.length; gi++) {
            const g = groups[gi];
            if (mag >= g.min && mag < g.max) {
                g.items.push({ eq, originalIndex: i });
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            // fallback al último grupo
            groups[groups.length - 1].items.push({ eq, originalIndex: i });
        }
    }

    const meshes = [];
    // base geometry for instanced markers: increase segments to smooth appearance
    const baseGeom = new THREE.SphereGeometry(1, 24, 24);

    // globalInstanceIndex maps to { groupIndex, localIndex }
    let globalIndex = 0;

    // tamaños por grupo (5 valores)
    const sizeByGroup = [0.0026, 0.0040, 0.0060, 0.0085, 0.0115];

    for (let g = 0; g < groups.length; g++) {
        const grp = groups[g];
        const n = grp.items.length;
        if (n === 0) continue;
        // Material PBR para instanced markers: mejor integración, menos apariencia 'globo'
        const mat = new THREE.MeshStandardMaterial({
            color: grp.color,
            metalness: 0.06,
            roughness: 0.44,
            envMap: window.sceneEnvMap || null,
            envMapIntensity: window.sceneEnvMap ? 0.85 : 0.0,
            emissive: new THREE.Color(grp.color).multiplyScalar(0.03),
            emissiveIntensity: 0.55,
            clearcoat: 0.18,
            clearcoatRoughness: 0.12,
            flatShading: false
        });
        // add a lightweight fresnel rim to instanced markers as well
    // Fresnel onBeforeCompile disabled to avoid shader compile issues on some GPUs/browsers.
        
    const inst = new THREE.InstancedMesh(baseGeom, mat, n);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dummy = new THREE.Object3D();
    // Instanced contact shadows (one instanced plane per marker group)
    const planeGeom = new THREE.PlaneGeometry(1,1);
    const shadowTex = getDropShadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.9, side: THREE.DoubleSide });
    const shadowInst = new THREE.InstancedMesh(planeGeom, shadowMat, n);
    shadowInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shadowInst.renderOrder = 1;
    const shadowDummy = new THREE.Object3D();

    inst.userData.baseMatrices = {};
    inst.userData.globalIndexMap = {};
    // store per-instance data to avoid relying solely on globalIndexMap (may desync)
    inst.userData.records = {};
        for (let i = 0; i < n; i++) {
            const eq = grp.items[i].eq;
            const coords = eq.geometry.coordinates;
            const mag = eq.properties.mag;
            const place = eq.properties.place;
            const time = eq.properties.time;
            const depth = coords[2];

            const lon = coords[0];
            const lat = coords[1];
            const phi = (90 - lat) * (Math.PI / 180);
            const theta = (-lon + 180) * (Math.PI / 180);
            // Ignore depth and place all instances on the surface
            const r = 1;
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.cos(phi);
            const z = r * Math.sin(phi) * Math.sin(theta);

            // tamaño según grupo g
            const size = sizeByGroup[g] || sizeByGroup[sizeByGroup.length - 1];

            dummy.position.set(x, y, z);
            dummy.scale.setScalar(size);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
            // guardar matriz base y tamaño por instancia
            inst.userData.baseMatrices[i] = dummy.matrix.clone();
            // compute and set shadow instance transform: slightly inset along normal
            try {
                const normal = new THREE.Vector3(x, y, z).normalize();
                shadowDummy.position.copy(new THREE.Vector3(x, y, z).addScaledVector(normal, -0.0018));
                // orient plane to surface normal
                const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
                shadowDummy.quaternion.copy(q);
                // scale shadow relative to marker size (wider than marker)
                const shadowScale = size * 6.0;
                shadowDummy.scale.set(shadowScale, shadowScale, 1);
                shadowDummy.updateMatrix();
                shadowInst.setMatrixAt(i, shadowDummy.matrix);
            } catch(e) {}

            // Guardar en earthquakeData con globalIndex
            const rec = { mag, place, time, depth, size, properties: eq.properties };
            window.earthquakeData[globalIndex] = rec;
            // also store per-instance record directly on the instanced mesh
            inst.userData.records[i] = rec;
            // store mapping for reverse lookup if needed
            inst.userData.globalIndexMap[i] = globalIndex;
            globalIndex++;
        }

        inst.name = `earthquakeInstanced_${g}`;
    scene.add(inst);
    // add instanced shadow mesh below the instanced markers
    try { shadowInst.instanceMatrix.needsUpdate = true; scene.add(shadowInst); } catch(e) {}
    meshes.push(inst);
    }

    window.earthquakeInstanced = { meshes };

    // VERIFY/REPAIR: ensure globalIndexMap entries point to valid earthquakeData indices
    (function validateAndRepairMappings() {
        try {
            const totalInstances = globalIndex;
            let needRepair = false;
            for (const mesh of meshes) {
                const gmap = mesh.userData && mesh.userData.globalIndexMap ? mesh.userData.globalIndexMap : {};
                for (const k of Object.keys(gmap)) {
                    const idx = gmap[k];
                    if (typeof idx !== 'number' || idx < 0 || idx >= totalInstances) { needRepair = true; break; }
                }
                if (needRepair) break;
            }
            if (!needRepair) return;
            // Rebuild earthquakeData compactly in the same order instances were added and reindex maps
            const newData = [];
            let newIdx = 0;
            for (const mesh of meshes) {
                const oldMap = mesh.userData && mesh.userData.globalIndexMap ? mesh.userData.globalIndexMap : {};
                const newMap = {};
                const localKeys = Object.keys(oldMap).map(k=>Number(k)).sort((a,b)=>a-b);
                for (const local of localKeys) {
                    const oldGlobal = oldMap[local];
                    const rec = (window.earthquakeData && window.earthquakeData[oldGlobal]) ? window.earthquakeData[oldGlobal] : null;
                    newMap[local] = newIdx;
                    newData[newIdx] = rec || { mag:null, place:'', time:0, depth:null, size:null, properties:null };
                    newIdx++;
                }
                mesh.userData.globalIndexMap = newMap;
            }
            window.earthquakeData = newData;
            console.warn('setupInstancedMarkers: repaired earthquakeData/globalIndexMap mappings (reindexed).');
        } catch (e) {
            console.error('validateAndRepairMappings error', e);
        }
    })();
}

// Raycaster para interacción con marcadores
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onPointerDown(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    // Primero comprobar instanced mesh(s) — raycastear todas y seleccionar la intersección más cercana
    if (window.earthquakeInstanced && (window.earthquakeInstanced.meshes || window.earthquakeInstanced.mesh)) {
        const meshes = window.earthquakeInstanced.meshes || (window.earthquakeInstanced.mesh ? [window.earthquakeInstanced.mesh] : []);
        const intersectsAll = raycaster.intersectObjects(meshes, true);
        if (intersectsAll.length > 0) {
            const it = intersectsAll[0]; // el más cercano
            const inst = it.object;
            const instanceId = it.instanceId;
            let globalIdx = null;
            if (typeof instanceId === 'number' && inst.userData && inst.userData.globalIndexMap) {
                globalIdx = inst.userData.globalIndexMap[instanceId];
            }
            // Fallback: si no se obtuvo un globalIdx válido, intentar buscar la instancia por posición
            if ((typeof globalIdx !== 'number' || !window.earthquakeData || !window.earthquakeData[globalIdx]) && it.point) {
                try {
                    let best = { dist: Infinity, gidx: null, mesh: null, local: null };
                    const clickPos = it.point.clone();
                    for (const mesh of meshes) {
                        if (!mesh.userData || !mesh.userData.globalIndexMap) continue;
                        const baseMatrices = mesh.userData.baseMatrices || {};
                        for (const localKey of Object.keys(mesh.userData.globalIndexMap)) {
                            const local = Number(localKey);
                            const gIdx = mesh.userData.globalIndexMap[local];
                            const mat = baseMatrices[local];
                            if (!mat) continue;
                            const tmp = new THREE.Object3D();
                            tmp.matrix.copy(mat);
                            tmp.matrix.decompose(tmp.position, tmp.quaternion, tmp.scale);
                            const d = tmp.position.distanceTo(clickPos);
                            if (d < best.dist) { best.dist = d; best.gidx = gIdx; best.mesh = mesh; best.local = local; }
                        }
                    }
                    // aceptar solo si distancia razonable (tolerancia), evitar colisiones lejanas
                    if (best.gidx !== null && best.dist < 0.05) {
                        globalIdx = best.gidx;
                        // set inst and instanceId to the matching mesh/local so visuals align
                        inst = best.mesh || inst;
                        instanceId = (typeof best.local === 'number') ? best.local : instanceId;
                    }
                } catch (e) { /* non-blocking */ }
            }
            let record = null;
            if (inst && typeof instanceId === 'number' && inst.userData && inst.userData.records && inst.userData.records[instanceId]) {
                record = inst.userData.records[instanceId];
            }
            if (!record && typeof globalIdx === 'number' && window.earthquakeData && window.earthquakeData[globalIdx]) {
                record = window.earthquakeData[globalIdx];
            }
            if (record) {
                // Optional debug logging to help trace mapping issues
                try {
                    if (window.debugPick) {
                        console.log('pick-debug:', { meshName: inst.name || inst.uuid, instanceId, globalIdx, data: window.earthquakeData[globalIdx] });
                        if (it.point) console.log('pick-debug-point:', it.point);
                        // show nearby base matrices distances (first few)
                        const base = inst.userData && inst.userData.baseMatrices ? inst.userData.baseMatrices : null;
                        if (base) {
                            const sample = Object.keys(base).slice(0,5);
                            const tmp = new THREE.Object3D();
                            const clickPos = it.point ? it.point.clone() : null;
                            for (const k of sample) {
                                try {
                                    const m = base[k];
                                    tmp.matrix.copy(m);
                                    tmp.matrix.decompose(tmp.position, tmp.quaternion, tmp.scale);
                                    console.log('pick-debug-base', k, tmp.position.toArray(), clickPos ? tmp.position.distanceTo(clickPos) : null);
                                } catch(e) {}
                            }
                        }
                    }
                } catch(e) {}
                showEarthquakeDetails(record);
                    // registrar selección para animación (pulso)
                    window.selectedInstance = { mesh: inst, localId: instanceId, globalId: globalIdx, elapsed: 0 };
                    // crear halo visual en la posición de la instancia
                    const haloColor = inst.material && inst.material.color ? inst.material.color.getHex() : 0xffee66;
                    createHaloFromInstanced(inst, instanceId, haloColor);
                    // crear ripple (anillo) en la misma posición
                    try {
                        const baseMat = inst.userData && inst.userData.baseMatrices && inst.userData.baseMatrices[instanceId];
                        if (baseMat) {
                            const tmp = new THREE.Object3D();
                            tmp.matrix.copy(baseMat);
                            tmp.matrix.decompose(tmp.position, tmp.quaternion, tmp.scale);
                            const pos = tmp.position.clone();
                            const mag = (window.earthquakeData && window.earthquakeData[globalIdx]) ? window.earthquakeData[globalIdx].mag : null;
                            createRipple(pos, haloColor, mag);
                        }
                    } catch (e) {
                        // no crítico
                    }
                    return;
                }
            }
        }
    // Fallback a meshes individuales
    const intersects = raycaster.intersectObjects(window.earthquakeMarkers || []);
    if (intersects.length > 0) {
        const marker = intersects[0].object;
        if (marker.callback) marker.callback();
        return;
    }
}

// Small UI helpers: panel open/close
try {
    const panelOpenHandler = () => {
        const panel = document.getElementById('info-panel');
        if (panel) panel.style.display = '';
    };
    // Attach logo click to open info panel (optional friendly shortcut)
    window.addEventListener('DOMContentLoaded', () => {
        const logo = document.querySelector('.brand .logo');
        if (logo) logo.addEventListener('click', panelOpenHandler);
    });
} catch (e) { /* non-critical */ }

// Spinner helpers
function showLoading(show) {
    const spinner = document.getElementById('loading-spinner');
    if (!spinner) return;
    if (show) spinner.classList.remove('hidden');
    else spinner.classList.add('hidden');

}

// --- Más info panel: stats + histogram ---
function toggleInfoPanel() {
    let panel = document.getElementById('more-info-panel');
    if (!panel) panel = createInfoPanelUI();
    const isOpen = panel.style.display === 'block';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) populateInfoPanel();
}

function createInfoPanelUI() {
    const panel = document.createElement('div');
    panel.id = 'more-info-panel';
    panel.style.cssText = 'position: absolute; right: 12px; top: 12px; width: 420px; height: 62vh; background: rgba(6,10,16,0.94); color: #eaf6ff; border-radius:10px; padding:12px; z-index:9999; overflow:auto; display:none; box-shadow:0 10px 40px rgba(0,0,0,0.6);';
    panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <strong style="font-size:1rem;">Más información</strong>
            <button id="more-info-close" style="background:transparent;border:0;color:#dfefff;font-size:1rem;cursor:pointer;">✕</button>
        </div>
        <div id="info-stats" style="font-size:0.9rem;color:#cfe9ff;line-height:1.5;margin-bottom:8px;">
            <div>Total eventos: <span id="info-total">—</span></div>
            <div>Máx / Media / Mediana: <span id="info-max">—</span> / <span id="info-avg">—</span> / <span id="info-med">—</span></div>
        </div>
        <div style="margin-bottom:8px;"><canvas id="mag-histogram" width="380" height="220" style="width:100%;height:220px;background:transparent;border-radius:6px;"></canvas></div>
        <div id="info-notes" style="font-size:0.8rem;color:#9fbfe0;">Histograma por rango de magnitud (bin 0.5)</div>
    `;
    document.body.appendChild(panel);
    const close = panel.querySelector('#more-info-close');
    if (close) close.addEventListener('click', () => { panel.style.display = 'none'; });
    return panel;
}

function ensureChartJsLoaded(cb) {
    if (window.Chart) return cb();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    s.onload = () => cb();
    s.onerror = () => { console.warn('Chart.js no pudo cargarse desde CDN'); cb(); };
    document.head.appendChild(s);
}

function computeMagnitudeHistogram(records, binSize = 0.5, rangeStart = null, rangeEnd = null) {
    const mags = (records || []).map(r => (typeof r.mag === 'number') ? r.mag : (r.properties && typeof r.properties.mag === 'number' ? r.properties.mag : null)).filter(m => m !== null && !isNaN(m));
    // default fixed range 0..10 when requested by caller (pass 0,10) or if no data
    const useFixed = (typeof rangeStart === 'number' && typeof rangeEnd === 'number');
    const minVal = useFixed ? rangeStart : (mags.length ? Math.floor(Math.min(...mags)) : 0);
    const maxVal = useFixed ? rangeEnd : (mags.length ? Math.ceil(Math.max(...mags)) : minVal + binSize);
    // build bins from minVal to maxVal (inclusive of maxVal)
    const bins = [];
    const labels = [];
    const centers = [];
    for (let b = minVal; b < maxVal + 1e-9; b += binSize) {
        bins.push(0);
        const hi = +(b + binSize).toFixed(2);
        labels.push(`${b.toFixed(1)}–${hi.toFixed(1)}`);
        centers.push(b + binSize / 2);
    }
    // populate counts
    for (const m of mags) {
        // ignore values outside fixed range when using fixed
        if (useFixed && (m < minVal || m > maxVal)) continue;
        const idx = Math.floor((m - minVal) / binSize);
        if (idx >= 0 && idx < bins.length) bins[idx]++;
    }
    return { labels, counts: bins, centers };
}

function populateInfoPanel() {
    const panel = document.getElementById('more-info-panel');
    if (!panel) return;
    // prefer the stable snapshot of the last search; fall back to current earthquakeData
    const recs = Array.isArray(window._gdv_lastSearchResults) && window._gdv_lastSearchResults.length > 0 ? window._gdv_lastSearchResults : (Array.isArray(window.earthquakeData) ? window.earthquakeData : []);
    const total = recs.length;
    const mags = recs.map(r => (typeof r.mag === 'number') ? r.mag : (r.properties && typeof r.properties.mag === 'number' ? r.properties.mag : null)).filter(x => x !== null);
    const max = mags.length ? Math.max(...mags).toFixed(2) : '—';
    const avg = mags.length ? (mags.reduce((s,v)=>s+v,0)/mags.length).toFixed(2) : '—';
    const med = mags.length ? (function(a){ a = a.slice().sort((x,y)=>x-y); const mid = Math.floor(a.length/2); return (a.length%2 ? a[mid] : ((a[mid-1]+a[mid])/2)).toFixed(2);} )(mags) : '—';
    const elTotal = panel.querySelector('#info-total'); if (elTotal) elTotal.textContent = total;
    const elMax = panel.querySelector('#info-max'); if (elMax) elMax.textContent = max;
    const elAvg = panel.querySelector('#info-avg'); if (elAvg) elAvg.textContent = avg;
    const elMed = panel.querySelector('#info-med'); if (elMed) elMed.textContent = med;

    const canvas = panel.querySelector('#mag-histogram');
    if (!canvas) return;
    // compute histogram over fixed range 0..10
    const hist = computeMagnitudeHistogram(recs, 0.5, 0, 10);
    ensureChartJsLoaded(() => {
        try {
            if (window._gdv_magChart) { try { window._gdv_magChart.destroy(); } catch(e) {} window._gdv_magChart = null; }
            if (typeof Chart === 'undefined') {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0,0,canvas.width,canvas.height);
                const labels = hist.labels || [];
                const counts = hist.counts || [];
                const maxC = counts.length ? Math.max(...counts) : 1;
                // map bins linearly across 0..10
                const centers = hist.centers || [];
                const minX = 0, maxX = 10;
                const chartW = canvas.width - 12; // padding
                for (let i=0;i<centers.length;i++){
                    const h = (counts[i] / Math.max(1, maxC)) * (canvas.height - 20);
                    const norm = (centers[i] - minX) / (maxX - minX);
                    const x = 6 + norm * chartW - (chartW / centers.length) / 2;
                    const y = canvas.height - h - 6;
                    const barW = Math.max(6, (chartW / Math.max(1, centers.length)) - 6);
                    ctx.fillStyle = 'rgba(100,180,255,0.9)';
                    ctx.fillRect(x, y, barW, h);
                }
                return;
            }
            const ctx = canvas.getContext('2d');
            window._gdv_magChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: hist.labels,
                    datasets: [{
                        label: 'Eventos',
                        data: hist.counts.map((c, i) => ({ x: hist.centers[i], y: c })),
                        backgroundColor: hist.counts.map(c => 'rgba(100,180,255,0.9)'),
                        borderColor: 'rgba(100,180,255,1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { type: 'linear', min: 0, max: 10, ticks: { color: '#dfefff' }, grid: { display: false } },
                        y: { beginAtZero: true, ticks: { color: '#dfefff' }, grid: { color: 'rgba(255,255,255,0.03)' } }
                    }
                }
            });
        } catch (e) { console.warn('populateInfoPanel chart error', e); }
    });
}

// Auto-refresh removed

function showEarthquakeDetails(data) {
    const date = new Date(data.time);
    document.getElementById('quake-details').innerHTML = `
        <strong>Lugar:</strong> ${data.place}<br>
        <strong>Magnitud:</strong> ${data.mag}<br>
        <strong>Fecha:</strong> ${date.toLocaleString()}<br>
    <strong>Profundidad:</strong> ${typeof data.depth !== 'undefined' ? data.depth + ' km' : (data.properties && data.properties.depth ? data.properties.depth + ' km' : 'N/A')}<br>
    <a href="${(data.properties && data.properties.url) || '#'}" target="_blank">Más información</a>
    `;
}
