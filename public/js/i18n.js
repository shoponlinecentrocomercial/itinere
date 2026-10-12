/**
 * i18n minimalista para Itinere.
 *
 * Uso en HTML:
 *   <span data-i18n="nav.acceder">Acceder</span>
 *   <input data-i18n-placeholder="forms.email" placeholder="Email" />
 *   <button data-i18n-title="nav.menu" title="Menu">…</button>
 *
 * Carga: añadir <script src="https://itinere.pro/js/i18n.js" defer></script>
 * en el <head>. El módulo se autoinvoca al DOMContentLoaded y reemplaza
 * los nodos marcados.
 *
 * Selección de idioma:
 *   1. Query string `?lang=es|en`
 *   2. localStorage 'itinere.lang'
 *   3. navigator.language
 *   4. Fallback 'es'.
 *
 * Los JSON se sirven desde https://itinere.pro/i18n/{lang}.json
 * (carpeta `public/i18n/`).
 */
(function () {
    const SUPPORTED = ['es', 'en'];
    const FALLBACK  = 'es';
    const STORAGE_KEY = 'itinere.lang';

    function detectarIdioma() {
        const qs = new URLSearchParams(window.location.search).get('lang');
        if (qs && SUPPORTED.includes(qs)) {
            localStorage.setItem(STORAGE_KEY, qs);
            return qs;
        }
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && SUPPORTED.includes(stored)) return stored;

        const nav = (navigator.language || navigator.userLanguage || FALLBACK).slice(0, 2).toLowerCase();
        return SUPPORTED.includes(nav) ? nav : FALLBACK;
    }

    function obtenerTraduccion(dict, clave) {
        return clave.split('.').reduce((acc, p) => (acc && acc[p] !== undefined) ? acc[p] : null, dict);
    }

    function aplicarTraducciones(dict) {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const v = obtenerTraduccion(dict, el.dataset.i18n);
            if (v === null) return;
            // Si el elemento NO tiene hijos elemento, basta con textContent.
            if (el.children.length === 0) {
                el.textContent = v;
                return;
            }
            // Si tiene hijos (típicamente <span id="..."> con valores
            // dinámicos), reemplazar SÓLO el primer text node con
            // contenido y vaciar los demás, sin tocar los elementos hijos.
            // Esto evita romper IDs internos (bug donde i18n eliminaba
            // <span id="unidadAsc"> etc.).
            let replaced = false;
            for (const node of Array.from(el.childNodes)) {
                if (node.nodeType !== Node.TEXT_NODE) continue;
                if (!replaced && node.textContent.trim()) {
                    node.textContent = v + ' ';
                    replaced = true;
                } else {
                    node.textContent = '';
                }
            }
            if (!replaced) {
                el.insertBefore(document.createTextNode(v + ' '), el.firstChild);
            }
        });
        ['placeholder', 'title', 'value', 'alt', 'aria-label'].forEach(attr => {
            const dsKey = 'i18n' + attr.charAt(0).toUpperCase() + attr.slice(1).replace(/-/g, '');
            document.querySelectorAll(`[data-${'i18n-' + attr}]`).forEach(el => {
                const clave = el.getAttribute('data-i18n-' + attr);
                const v = obtenerTraduccion(dict, clave);
                if (v !== null) el.setAttribute(attr, v);
            });
        });
        document.documentElement.lang = window.Itinere?.lang || FALLBACK;
    }

    async function cargarIdioma(lang) {
        try {
            const r = await fetch('https://itinere.pro/i18n/' + lang + '.json', { credentials: 'omit' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const dict = await r.json();
            window.Itinere = Object.assign({}, window.Itinere, { lang, dict, t: clave => obtenerTraduccion(dict, clave) ?? clave });
            aplicarTraducciones(dict);
        } catch (e) {
            console.error('i18n: no se pudo cargar', lang, e);
            if (lang !== FALLBACK) await cargarIdioma(FALLBACK);
        }
    }

    function init() {
        const lang = detectarIdioma();
        cargarIdioma(lang);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Cambio explícito de idioma (para selector futuro)
    window.setIdioma = function (lang) {
        if (!SUPPORTED.includes(lang)) return;
        localStorage.setItem(STORAGE_KEY, lang);
        cargarIdioma(lang);
    };
})();
