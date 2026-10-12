/*
 * Itinere — Web Components.
 *
 * Vanilla custom elements. Sin Shadow DOM para que hereden los tokens
 * CSS y el resto de la app pueda estilarlos. Pensados para usarse desde
 * HTML, no como builder JS.
 *
 * Uso:
 *   <script src="https://itinere.pro/js/components.js" defer></script>
 *
 * Disponibles:
 *   <itinere-card …>        — Tarjeta de ruta
 *   <itinere-stat …>        — Medidor grande (velocidad, distancia, …)
 *   <itinere-tabbar items…> — Barra inferior con icono central CTA
 *   <itinere-otp length=6>  — Input de código de 1 cifra por casilla
 *   <itinere-toast/>        — Mensajes flotantes (api global Toast.show)
 *   <itinere-sheet>         — Bottom sheet con handle
 *
 * Iconos usados (Lucide-style inline SVG).
 */

const ICONS = {
    home:      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>',
    map:       '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3,6 9,3 15,6 21,3 21,18 15,21 9,18 3,21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>',
    plus:      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    activity:  '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>',
    user:      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    search:    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    x:         '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    clock:     '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>',
    mountain:  '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>',
    ruler:     '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 8.7 8.7 21.3a2.4 2.4 0 0 1-3.4-3.4L17.9 5.3a2.4 2.4 0 0 1 3.4 3.4z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg>',
};

function icon(name, size) {
    const svg = ICONS[name] || '';
    if (!svg) return '';
    const wrapped = svg.replace('<svg ', `<svg width="${size || 24}" height="${size || 24}" `);
    return wrapped;
}

// ============== itinere-card ==============
class ItinereCard extends HTMLElement {
    connectedCallback() {
        const nombre    = this.getAttribute('nombre')    || '';
        const tipo      = this.getAttribute('tipo')      || '';
        const distancia = this.getAttribute('distancia') || '';
        const desnivel  = this.getAttribute('desnivel')  || '';
        const tiempo    = this.getAttribute('tiempo')    || '';
        const thumb     = this.getAttribute('thumb')     || '';
        const href      = this.getAttribute('href')      || '#';

        this.innerHTML = `
            <a class="card" href="${escapeAttr(href)}">
                <div class="card__media">
                    ${thumb ? `<img src="${escapeAttr(thumb)}" alt="" loading="lazy"/>` : ''}
                    ${tipo ? `<span class="card__badge">${escapeHtml(tipo)}</span>` : ''}
                </div>
                <div class="card__body">
                    <h3 class="card__title">${escapeHtml(nombre)}</h3>
                    <div class="card__stats">
                        <div class="card__stat"><strong>${escapeHtml(distancia)}</strong><span data-i18n="ruta.distanciaCorta">km</span></div>
                        <div class="card__stat"><strong>${escapeHtml(desnivel)}</strong><span data-i18n="ruta.desnivel">desnivel</span></div>
                        <div class="card__stat"><strong>${escapeHtml(tiempo)}</strong><span data-i18n="ruta.tiempo">tiempo</span></div>
                    </div>
                </div>
            </a>
        `;
    }
}
customElements.define('itinere-card', ItinereCard);

// ============== itinere-stat ==============
class ItinereStat extends HTMLElement {
    connectedCallback() {
        const value = this.getAttribute('value') || '0';
        const unit  = this.getAttribute('unit')  || '';
        const label = this.getAttribute('label') || '';
        this.innerHTML = `
            <div class="stat">
                <div class="stat__value">${escapeHtml(value)} <span class="stat__unit">${escapeHtml(unit)}</span></div>
                ${label ? `<div class="stat__label">${escapeHtml(label)}</div>` : ''}
            </div>
        `;
    }
}
customElements.define('itinere-stat', ItinereStat);

// ============== itinere-tabbar ==============
// Define la barra inferior fija con 4 items + CTA central.
//   <itinere-tabbar active="home"></itinere-tabbar>
class ItinereTabbar extends HTMLElement {
    connectedCallback() {
        const active = this.getAttribute('active') || '';
        const items = [
            // "Rutas" e "Inicio" comparten endpoint hasta que tengamos una
            // página /buscar.html dedicada con filtros avanzados.
            { id: 'home',  href: '/index.html',  label: 'Inicio',     icon: 'home',     i18n: 'nav.home' },
            { id: 'rutas', href: '/index.html',  label: 'Rutas',      icon: 'map',      i18n: 'nav.rutas' },
            { id: 'cta',   href: '#nueva',       label: '',           icon: 'plus',     cta: true },
            { id: 'mias',  href: '/usuario.html?vista=mias', label: 'Mías', icon: 'activity', i18n: 'nav.mias' },
            { id: 'perfil',href: '/usuario.html',label: 'Perfil',     icon: 'user',     i18n: 'nav.perfil' },
        ];
        const html = items.map(it => {
            if (it.cta) {
                return `
                    <button class="tabbar__item tabbar__cta" type="button" data-cta>
                        <span class="tabbar__bubble">${icon(it.icon, 28)}</span>
                    </button>`;
            }
            const cur = it.id === active ? ' aria-current="page"' : '';
            return `
                <a class="tabbar__item" href="${escapeAttr(it.href)}"${cur}>
                    ${icon(it.icon, 26)}
                    <span ${it.i18n ? `data-i18n="${it.i18n}"` : ''}>${escapeHtml(it.label)}</span>
                </a>`;
        }).join('');

        this.innerHTML = `<nav class="tabbar" role="navigation" aria-label="Principal">${html}</nav>`;
        this.querySelector('[data-cta]')?.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('itinere:cta', { bubbles: true }));
        });
    }
}
customElements.define('itinere-tabbar', ItinereTabbar);

// ============== itinere-otp ==============
// <itinere-otp length=6 name="clave"></itinere-otp>
// Emite "itinere:otp" cuando completa todas las casillas.
class ItinereOtp extends HTMLElement {
    connectedCallback() {
        const len = Number(this.getAttribute('length') || 6);
        this.innerHTML = `<div class="otp">${
            Array.from({ length: len }, (_, i) =>
                `<input type="text" inputmode="numeric" pattern="\\d*" maxlength="1" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Cifra ${i+1}"/>`
            ).join('')
        }</div>`;
        const inputs = Array.from(this.querySelectorAll('input'));
        inputs.forEach((input, idx) => {
            input.addEventListener('input', () => {
                input.value = input.value.replace(/\D/g, '').slice(0, 1);
                if (input.value && idx < inputs.length - 1) inputs[idx + 1].focus();
                if (inputs.every(i => i.value)) {
                    const code = inputs.map(i => i.value).join('');
                    this.dispatchEvent(new CustomEvent('itinere:otp', { bubbles: true, detail: { code } }));
                }
            });
            input.addEventListener('keydown', e => {
                if (e.key === 'Backspace' && !input.value && idx > 0) inputs[idx - 1].focus();
            });
            input.addEventListener('paste', e => {
                const data = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, len);
                if (!data) return;
                e.preventDefault();
                data.split('').forEach((d, i) => { if (inputs[i]) inputs[i].value = d; });
                (inputs[Math.min(data.length, len - 1)] || inputs[0]).focus();
                if (inputs.every(i => i.value)) {
                    const code = inputs.map(i => i.value).join('');
                    this.dispatchEvent(new CustomEvent('itinere:otp', { bubbles: true, detail: { code } }));
                }
            });
        });
    }
    get value() { return Array.from(this.querySelectorAll('input')).map(i => i.value).join(''); }
    focus()    { this.querySelector('input')?.focus(); }
}
customElements.define('itinere-otp', ItinereOtp);

// ============== itinere-sheet ==============
// Bottom sheet con handle drag y backdrop. API:
//   <itinere-sheet id="x" peek="120">contenido</itinere-sheet>
//   document.getElementById('x').open();
//   document.getElementById('x').close();
// Atributo `peek` = altura visible en estado plegado (sin abrir).
class ItinereSheet extends HTMLElement {
    connectedCallback() {
        const peek = Number(this.getAttribute('peek') || 0);
        const content = this.innerHTML;
        this.innerHTML = `
            <div class="sheet-backdrop"></div>
            <aside class="sheet" role="dialog" aria-modal="true">
                <div class="sheet__handle"></div>
                <div class="sheet__body">${content}</div>
            </aside>
        `;
        this._backdrop = this.querySelector('.sheet-backdrop');
        this._sheet    = this.querySelector('.sheet');
        this._handle   = this.querySelector('.sheet__handle');
        this._backdrop.addEventListener('click', () => this.close());

        if (peek > 0) {
            this.classList.add('itinere-sheet--peek');
            this._sheet.style.transform = `translateY(calc(100% - ${peek}px))`;
            this._sheet.style.transition = 'transform var(--t-slow)';
            this._handle.style.cursor = 'grab';
            this._handle.addEventListener('click', () => this.toggle());
        }

        this._isOpen = false;
    }
    open() {
        this._isOpen = true;
        this._backdrop.classList.add('is-open');
        this._sheet.classList.add('is-open');
        this._sheet.style.transform = '';
        this.dispatchEvent(new CustomEvent('itinere:sheet:open'));
    }
    close() {
        this._isOpen = false;
        this._backdrop.classList.remove('is-open');
        this._sheet.classList.remove('is-open');
        const peek = Number(this.getAttribute('peek') || 0);
        if (peek > 0) this._sheet.style.transform = `translateY(calc(100% - ${peek}px))`;
        this.dispatchEvent(new CustomEvent('itinere:sheet:close'));
    }
    toggle() { this._isOpen ? this.close() : this.open(); }
}
customElements.define('itinere-sheet', ItinereSheet);

// ============== itinere-gps-chip ==============
// Chip flotante que muestra calidad de GPS.
//   <itinere-gps-chip status="ok|weak|none"></itinere-gps-chip>
//   chip.setAttribute('status', 'weak'); // actualiza en vivo
class ItinereGpsChip extends HTMLElement {
    static get observedAttributes() { return ['status']; }
    connectedCallback() { this._render(); }
    attributeChangedCallback() { this._render(); }
    _render() {
        const status = this.getAttribute('status') || 'ok';
        const palette = {
            ok:   { bg: 'var(--c-success)',  txt: '#fff', label: 'GPS' },
            weak: { bg: 'var(--c-warning)',  txt: '#000', label: 'GPS débil' },
            none: { bg: 'var(--c-danger)',   txt: '#fff', label: 'Sin GPS' },
        }[status] || { bg: 'var(--c-success)', txt: '#fff', label: 'GPS' };
        this.innerHTML = `
            <span style="
                display:inline-flex; align-items:center; gap:6px;
                padding:6px 12px;
                background:${palette.bg}; color:${palette.txt};
                border-radius:var(--r-pill);
                font-size:var(--fs-xs); font-weight:var(--fw-bold);
                box-shadow:var(--shadow-md);
                pointer-events:none;
            ">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                ${palette.label}
            </span>
        `;
    }
}
customElements.define('itinere-gps-chip', ItinereGpsChip);

// ============== itinere-progress ==============
// <itinere-progress value="42" max="100"></itinere-progress>
class ItinereProgress extends HTMLElement {
    static get observedAttributes() { return ['value', 'max']; }
    connectedCallback() { this._render(); }
    attributeChangedCallback() { this._render(); }
    _render() {
        const value = Number(this.getAttribute('value') || 0);
        const max   = Number(this.getAttribute('max')   || 100);
        const pct   = Math.max(0, Math.min(100, (value / max) * 100));
        this.innerHTML = `
            <div style="
                width:100%; height:6px;
                background:var(--c-border);
                border-radius:var(--r-pill);
                overflow:hidden;
            " role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="${max}">
                <div style="
                    width:${pct.toFixed(1)}%; height:100%;
                    background:linear-gradient(90deg, var(--c-accent), var(--c-primary));
                    border-radius:var(--r-pill);
                    transition: width var(--t-base);
                "></div>
            </div>
        `;
    }
}
customElements.define('itinere-progress', ItinereProgress);

// ============== Toast (API global) ==============
window.Toast = {
    show(msg, opts = {}) {
        let el = document.querySelector('.toast');
        if (!el) {
            el = document.createElement('div');
            el.className = 'toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.toggle('toast--error', !!opts.error);
        // forzar reflow
        void el.offsetHeight;
        el.classList.add('is-open');
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('is-open'), opts.duration || 3000);
    },
    error(msg) { this.show(msg, { error: true }); },
};

// ============== Helpers ==============
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
