/**
 * php-compat.js — Migración 1:1 de los endpoints PHP a Express.
 *
 * Mantiene las MISMAS URLs (`/info.php`, `/foto.php`, `/usuario.php`, …)
 * para que el frontend siga funcionando sin cambios. Permite eliminar
 * por completo el servidor PHP+Apache de la arquitectura.
 *
 * Uso desde server.js:
 *
 *   const registerPhpCompat = require('./php-compat');
 *   registerPhpCompat(app, dbPool, {
 *     uploadsDir: '/var/www/itinere.pro',  // donde guardar fotos y rutas
 *     baseUrl:    'https://itinere.pro/',
 *   });
 *
 * Dependencias:
 *   npm install multer nodemailer
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

let multer;
try { multer = require('multer'); } catch { /* opcional */ }

let nodemailer;
try { nodemailer = require('nodemailer'); } catch { /* opcional */ }

// ============================================================
//  Helpers
// ============================================================

function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}
const h = escapeHtml;

function esIdValido(v) {
    return v !== undefined && v !== null && /^\d+$/.test(String(v));
}

function quitarAcentos(t) {
    const map = {
        'á':'a','é':'e','í':'i','ó':'o','ú':'u',
        'à':'a','è':'e','ì':'i','ò':'o','ù':'u',
        'Á':'A','É':'E','Í':'I','Ó':'O','Ú':'U',
        'À':'A','È':'E','Ì':'I','Ò':'O','Ù':'U',
        'ä':'a','ë':'e','ï':'i','ö':'o','ü':'u',
        'Ä':'A','Ë':'E','Ï':'I','Ö':'O','Ü':'U',
        'â':'a','ê':'e','î':'i','ô':'o','û':'u',
        'Â':'A','Ê':'E','Î':'I','Ô':'O','Û':'U',
        'ñ':'n','Ñ':'N','Ç':'S','ç':'s',"'":'-'
    };
    return String(t).replace(/[áéíóúàèìòùÁÉÍÓÚÀÈÌÒÙäëïöüÄËÏÖÜâêîôûÂÊÎÔÛñÑÇç']/g, c => map[c] || c);
}

function generarSeoURL(titulo) {
    const sin = quitarAcentos(String(titulo).toLowerCase());
    return sin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function usuarioActual(req) {
    return req.signedCookies?.usuario || null;
}
function exigirUsuario(req, res) {
    const id = usuarioActual(req);
    if (!id) {
        res.status(401).json({ error: 'No autenticado' });
        return null;
    }
    return id;
}

// Tarjeta HTML de ruta (sustituye al renderTarjetaRuta de helpers.php).
function renderTarjetaRuta(r, base) {
    const id = parseInt(r.id);
    const pico = parseFloat(r.pico || 0);
    const baseAlt = parseFloat(r.base || 0);
    const imgUrl = base /* :2053 eliminado; ahora Express sirve /rutas/ y /usuarios/ */ + `rutas/${id}/ruta_${id}.png`;
    const detUrl = base + 'info/' + generarSeoURL(r.nombre || '') + '/' + id;
    const fecha  = String(r.fecha || '');
    const fechaFmt = fecha.length >= 10
        ? `${fecha.substring(8,10)}/${fecha.substring(5,7)}/${fecha.substring(0,4)}`
        : '';
    return `
    <div style="float:left;position:relative;width:calc(100% - 26px);padding:10px;margin-top:10px;margin-bottom:10px;border:#F5C55F 3px solid;border-radius:5px;background:#FFE1B3;">
        <div style="float:left;position:relative;width:50%;">
            <img src="${h(imgUrl)}" style="width:100%;" alt="" />
        </div>
        <div style="float:left;position:relative;width:calc(50% - 20px);padding-left:20px;">
            <span style="font-size:14px;font-weight:bold;"><a href="${h(detUrl)}">${h(r.nombre)}</a></span><br />
            ${r.tipo ? `<span style="font-weight:bold;">${h(r.tipo)}</span><br />` : ''}
            ${h(fechaFmt)}<br />
            Tiempo: ${h(r.tiempo)}<br />
            Distancia: ${h(r.distancia)} metros<br />
            Desnivel: ${h(pico - baseAlt)} metros<br />
        </div>
    </div>`;
}

// ============================================================
//  Email (sustituye email.php)
// ============================================================
function crearTransporter() {
    if (!nodemailer) return null;
    // 1) SMTP autenticado si hay credenciales en env
    if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            } : undefined,
        });
    }
    // 2) Sendmail local (si está instalado)
    return nodemailer.createTransport({
        sendmail: true,
        newline: 'unix',
        path: process.env.SENDMAIL_PATH || '/usr/sbin/sendmail',
    });
}

async function enviarEmail({ to, subject, text }) {
    const t = crearTransporter();
    if (!t) throw new Error('nodemailer no instalado');
    const from = process.env.MAIL_FROM || 'Itinere <no-reply@itinere.pro>';
    return await t.sendMail({ from, to, subject, text });
}

// Pending email changes: userId → { email, code, expiresAt }.
// In-memory: si el server reinicia, el usuario tendrá que volver a pedir el código.
const pendingEmailChanges = new Map();
const EMAIL_CHANGE_TTL_MS = 15 * 60 * 1000; // 15 minutos

function purgePendingEmailChanges() {
    const now = Date.now();
    for (const [uid, entry] of pendingEmailChanges) {
        if (entry.expiresAt < now) pendingEmailChanges.delete(uid);
    }
}

// ============================================================
//  Registro de endpoints en la app Express
// ============================================================

module.exports = function register(app, dbPool, opts = {}) {
    const uploadsDir = opts.uploadsDir || '/var/www/itinere.pro';
    const baseUrl    = opts.baseUrl    || 'https://itinere.pro/';
    const MAX_FOTO   = 8 * 1024 * 1024;

    if (!fs.existsSync(uploadsDir)) {
        console.warn(`⚠️  php-compat: el directorio de uploads ${uploadsDir} no existe. Créalo y dale permisos al usuario que corre Node.`);
    }

    // ----- infoUsuario.php -----
    app.get('/infoUsuario.php', async (req, res) => {
        res.set('Content-Type', 'application/json; charset=utf-8');
        const id = req.query.id;
        if (!esIdValido(id)) return res.status(400).json({ status: 'error', message: 'id inválido' });
        try {
            const [rows] = await dbPool.execute(
                'SELECT id, nombre, email, created_at FROM usuarios WHERE id = ? LIMIT 1', [id]
            );
            res.json({ status: 'success', data: rows });
        } catch (e) {
            console.error('infoUsuario:', e);
            res.status(500).json({ status: 'error', message: 'Error de base de datos' });
        }
    });

    // ----- info.php -----
    app.get('/info.php', async (req, res) => {
        res.set('Content-Type', 'application/json; charset=utf-8');
        const id = req.query.id;
        if (!esIdValido(id)) return res.status(400).json({ status: 'error', message: 'id inválido' });
        try {
            const [rows] = await dbPool.execute('SELECT * FROM rutas WHERE id = ? LIMIT 1', [id]);
            res.json({ status: 'success', data: rows });
        } catch (e) {
            console.error('info:', e);
            res.status(500).json({ status: 'error', message: 'Error de base de datos' });
        }
    });

    // ----- email.php -----
    app.post('/email.php', express.json(), async (req, res) => {
        res.set('Content-Type', 'application/json; charset=utf-8');
        const email = String(req.body?.email || '').trim();
        const clave = String(req.body?.clave || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
            return res.status(400).json({ status: 'error', mensaje: 'Email inválido' });
        }
        if (!/^[A-Za-z0-9._\-+@!#%]{1,128}$/.test(clave)) {
            return res.status(400).json({ status: 'error', mensaje: 'Clave inválida' });
        }
        try {
            await enviarEmail({
                to: email,
                subject: 'Acceso a Itinere',
                text: `Usa esta clave para acceder a tu cuenta en itinere.pro:\n\n${clave}\n`,
            });
            res.json({ status: 'success', mensaje: 'Email enviado' });
        } catch (e) {
            console.error('email:', e);
            res.status(500).json({ status: 'error', mensaje: 'No se pudo enviar el email' });
        }
    });

    // ----- foto.php -----
    // POST raw PNG body. Query: ?nFoto=...&[dir=temp|idRuta=N]
    const rawPng = require('express').raw({ type: ['application/octet-stream', 'image/png', 'application/x-www-form-urlencoded'], limit: '8mb' });
    app.post('/foto.php', rawPng, async (req, res) => {
        const user = exigirUsuario(req, res);
        if (!user) return;

        const buffer = req.body;
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            return res.status(400).send('No se recibió imagen');
        }
        if (buffer.length > MAX_FOTO) {
            return res.status(413).send('Imagen demasiado grande');
        }
        // Magic bytes PNG
        const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        if (!buffer.slice(0, 8).equals(PNG_MAGIC)) {
            return res.status(415).send('El fichero no es un PNG válido');
        }

        const nFoto = String(req.query.nFoto || '');
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(nFoto)) {
            return res.status(400).send('Nombre de archivo inválido');
        }

        try {
            if ('dir' in req.query) {
                // Modo temporal: foto antes de crear la ruta.
                if (!nFoto.startsWith(user + '_')) {
                    return res.status(403).send('No autorizado');
                }
                const destino = path.join(uploadsDir, 'temp', nFoto + '.png');
                await fsp.writeFile(destino, buffer);
                return res.send('ok');
            }

            // Modo definitivo: ruta ya creada.
            const idRuta = req.query.idRuta;
            if (!esIdValido(idRuta)) return res.status(400).send('idRuta inválido');

            const [rows] = await dbPool.execute('SELECT usuario FROM rutas WHERE id = ? LIMIT 1', [idRuta]);
            if (rows.length === 0) return res.status(404).send('Ruta no encontrada');
            if (String(rows[0].usuario) !== String(user)) return res.status(403).send('No autorizado');

            const dir = path.join(uploadsDir, 'rutas', String(parseInt(idRuta)));
            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(path.join(dir, nFoto + '.png'), buffer);
            await dbPool.execute('UPDATE rutas SET fotos = fotos + 1 WHERE id = ?', [idRuta]);
            res.send('ok');
        } catch (e) {
            console.error('foto:', e);
            res.status(500).send('error');
        }
    });

    // ----- usuario.php -----
    // 3 modos:
    //  1) multipart FormData con `selfie` (file) y `id` → upload foto
    //  2) form-urlencoded con `nombre` y `id` → update nombre
    //  3) JSON con {token} o {puntero,id,tabla} → HTML del perfil / paginación
    if (multer) {
        const upload = multer({
            storage: multer.memoryStorage(),
            limits: { fileSize: 8 * 1024 * 1024 },
        });

        app.post('/usuario.php',
            (req, res, next) => {
                const ct = req.headers['content-type'] || '';
                if (ct.includes('multipart/form-data')) {
                    return upload.single('selfie')(req, res, next);
                }
                if (ct.includes('application/x-www-form-urlencoded')) {
                    return require('express').urlencoded({ extended: false })(req, res, next);
                }
                if (ct.includes('application/json')) {
                    return require('express').json()(req, res, next);
                }
                next();
            },
            async (req, res) => {
                // Modo 1: selfie
                if (req.file) {
                    const user = exigirUsuario(req, res);
                    if (!user) return;
                    if (req.body?.id !== user) return res.status(403).send('No autorizado');
                    const mimes = ['image/png', 'image/jpeg'];
                    if (!mimes.includes(req.file.mimetype)) return res.status(415).send('Tipo no admitido');
                    const ext = req.file.mimetype === 'image/jpeg' ? 'jpg' : 'png';
                    const dir = path.join(uploadsDir, 'usuarios', String(parseInt(user)));
                    try {
                        await fsp.mkdir(dir, { recursive: true });
                        await fsp.writeFile(path.join(dir, parseInt(user) + '.' + ext), req.file.buffer);
                        return res.send('ok');
                    } catch (e) {
                        console.error('selfie:', e);
                        return res.status(500).send('error');
                    }
                }

                // Modo 2: update nombre
                if (req.body?.nombre !== undefined && !req.body?.token && !req.body?.puntero) {
                    res.set('Content-Type', 'application/json; charset=utf-8');
                    const user = exigirUsuario(req, res);
                    if (!user) return;
                    const id = String(req.body.id || '');
                    const nuevoNombre = String(req.body.nombre || '').trim();
                    if (!esIdValido(id) || id !== user) {
                        return res.status(403).json({ error: 'No autorizado' });
                    }
                    if (!nuevoNombre || nuevoNombre.length > 50) {
                        return res.status(400).json({ error: 'Nombre inválido' });
                    }
                    try {
                        await dbPool.execute('UPDATE usuarios SET nombre = ? WHERE id = ?', [nuevoNombre, id]);
                        return res.json({ success: true });
                    } catch (e) {
                        console.error('update nombre:', e);
                        return res.status(500).json({ error: 'Error de base de datos' });
                    }
                }

                // Modo cambio de email - paso 1: pedir cambio (envía código al nuevo email)
                if (req.body?.email !== undefined && req.body?.codigoEmail === undefined && req.body?.token === undefined) {
                    res.set('Content-Type', 'application/json; charset=utf-8');
                    const user = exigirUsuario(req, res);
                    if (!user) return;
                    const idData = String(req.body.id || '');
                    if (!esIdValido(idData) || idData !== user) {
                        return res.status(403).json({ error: 'No autorizado' });
                    }
                    const nuevoEmail = String(req.body.email || '').trim().toLowerCase();
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevoEmail) || nuevoEmail.length > 100) {
                        return res.status(400).json({ error: 'Email inválido' });
                    }
                    try {
                        const [dup] = await dbPool.execute(
                            'SELECT id FROM usuarios WHERE email = ? AND id != ? LIMIT 1',
                            [nuevoEmail, user]
                        );
                        if (dup.length) {
                            return res.status(409).json({ error: 'Email ya en uso' });
                        }
                        const codigo = String(crypto.randomInt(100000, 1000000));
                        purgePendingEmailChanges();
                        pendingEmailChanges.set(String(user), {
                            email: nuevoEmail,
                            code: codigo,
                            expiresAt: Date.now() + EMAIL_CHANGE_TTL_MS,
                        });
                        await enviarEmail({
                            to: nuevoEmail,
                            subject: 'Cambio de email en Itinere',
                            text: `Confirma el cambio de email en tu cuenta de Itinere introduciendo este código en la app:\n\n${codigo}\n\nEl código caduca en 15 minutos.\nSi no has solicitado este cambio, puedes ignorar este mensaje.\n`,
                        });
                        return res.json({ status: 'pending' });
                    } catch (e) {
                        console.error('cambio email (paso 1):', e);
                        return res.status(500).json({ error: 'No se pudo enviar el código' });
                    }
                }

                // Modo cambio de email - paso 2: confirmar con código
                if (req.body?.codigoEmail !== undefined) {
                    res.set('Content-Type', 'application/json; charset=utf-8');
                    const user = exigirUsuario(req, res);
                    if (!user) return;
                    const idData = String(req.body.id || '');
                    if (!esIdValido(idData) || idData !== user) {
                        return res.status(403).json({ error: 'No autorizado' });
                    }
                    purgePendingEmailChanges();
                    const entry = pendingEmailChanges.get(String(user));
                    if (!entry) {
                        return res.status(400).json({ error: 'No hay cambio de email pendiente o ha caducado' });
                    }
                    if (String(req.body.codigoEmail).trim() !== entry.code) {
                        return res.status(400).json({ error: 'Código incorrecto' });
                    }
                    try {
                        const [dup] = await dbPool.execute(
                            'SELECT id FROM usuarios WHERE email = ? AND id != ? LIMIT 1',
                            [entry.email, user]
                        );
                        if (dup.length) {
                            pendingEmailChanges.delete(String(user));
                            return res.status(409).json({ error: 'Email ya en uso' });
                        }
                        await dbPool.execute('UPDATE usuarios SET email = ? WHERE id = ?', [entry.email, user]);
                        pendingEmailChanges.delete(String(user));
                        return res.json({ success: true, email: entry.email });
                    } catch (e) {
                        console.error('cambio email (paso 2):', e);
                        return res.status(500).json({ error: 'Error de base de datos' });
                    }
                }

                // Modo 3a: perfil (POST JSON {token})
                if (req.body?.token !== undefined) {
                    const user = exigirUsuario(req, res);
                    if (!user) return;
                    const token = String(req.body.token);
                    if (!esIdValido(token) || token !== user) return res.status(403).send('No autorizado');
                    return await pintarPerfil(req, res, token);
                }

                // Modo 3b: paginación (POST JSON {puntero, id, tabla})
                if (req.body?.puntero !== undefined) {
                    const user = exigirUsuario(req, res);
                    if (!user) return;
                    const idData = String(req.body.id || '');
                    if (!esIdValido(idData) || idData !== user) return res.status(403).send('No autorizado');
                    const puntero = parseInt(req.body.puntero) + 5;
                    const tabla   = parseInt(req.body.tabla);
                    return await pintarPaginacion(req, res, idData, puntero, tabla);
                }

                res.status(400).send('Petición no reconocida');
            }
        );
    } else {
        app.post('/usuario.php', (req, res) =>
            res.status(500).send('Instala `multer` en este servidor: npm install multer'));
    }

    async function pintarPerfil(req, res, token) {
        res.set('Content-Type', 'text/html; charset=UTF-8');
        try {
            const [reg] = await dbPool.execute('SELECT id, nombre, email FROM usuarios WHERE id = ? LIMIT 1', [token]);
            if (!reg.length) return res.status(404).send('No encontrado');
            const r = reg[0];

            const [km]  = await dbPool.execute('SELECT COALESCE(SUM(distancia), 0) AS km FROM actividad WHERE usuario = ?', [token]);
            const [rec] = await dbPool.execute(
                `SELECT COUNT(DISTINCT rutas.id) AS n FROM rutas
                 INNER JOIN actividad ON rutas.id = actividad.ruta WHERE actividad.usuario = ?`, [token]
            );
            const [cre] = await dbPool.execute('SELECT COUNT(id) AS n FROM rutas WHERE usuario = ?', [token]);
            const [creadas] = await dbPool.execute(
                'SELECT * FROM rutas WHERE usuario = ? ORDER BY fecha DESC LIMIT 5', [token]
            );
            const [recorridas] = await dbPool.execute(
                `SELECT DISTINCT rutas.* FROM rutas
                 INNER JOIN actividad ON rutas.id = actividad.ruta
                 WHERE actividad.usuario = ? ORDER BY rutas.fecha DESC LIMIT 5`, [token]
            );

            const totalCre = parseInt(cre[0].n);
            const totalRec = parseInt(rec[0].n);
            const sumKm    = parseFloat(km[0].km) || 0;

            const html = `
            <div id="cabecera" style="float:left;position:fixed;top:0px;left:0px;height:60px;overflow:hidden;width:calc(100% - 40px);padding-left:20px;padding-right:20px;background:linear-gradient(to bottom, rgba(255, 255, 255, 1), rgba(255, 217, 138, 1));transition:height 500ms;padding-top:10px;z-index:100;">
                <div id="usuario" style="display:flex;align-items:center;">
                    <a href="javascript:fotoUsuario();"><img id="btn-selfie" src="https://itinere.pro/usuario.png" style="height:40px;" alt=""></a>
                    <input type="text" placeholder="Nombre" id="nombre" style="background:transparent;width:calc(100% - 120px);font-size:28px;margin-left:10px;font-weight:bold;color:#C46A00;border:none;" readonly value="${h(r.nombre)}">
                </div>
                <div id="logo" style="float:right;position:fixed;right:10px;top:10px;width:40px;"><a href="https://itinere.pro"><img src="https://itinere.pro/logo.png" style="float:right;height:35px;" alt=""></a></div>
            </div>
            <div id="contenidos" style="float:left;position:relative;width:calc(100% - 40px);padding-left:20px;margin-top:70px;padding-right:20px;z-index:90;">
                <input type="text" id="email" placeholder="Email" style="background:transparent;width:calc(100% - 20px);font-size:28px;margin-bottom:10px;margin-left:10px;margin-right:10px;font-weight:bold;color:#C46A00;border:none;" readonly value="${h(r.email || '')}">
                <div style="float:left;position:relative;width:calc(33% - 22px);display:flex;align-items:center;justify-content:center;border:#C46A00 1px solid;padding:10px;">
                    <div style="width:80%;font-weight:bold;font-size:24px;">${h(Math.round((sumKm / 1000) * 100) / 100)}</div><div style="width:20%;font-size:12px;">Km.</div>
                </div>
                <div style="float:left;position:relative;width:calc(33% - 22px);display:flex;align-items:center;justify-content:center;border:#C46A00 1px solid;padding:10px;">
                    <div style="width:100%;font-weight:bold;font-size:24px;">${h(totalCre)}</div><div style="width:100%;font-size:12px;">Rutas creadas</div>
                </div>
                <div style="float:left;position:relative;width:calc(33% - 22px);display:flex;align-items:center;justify-content:center;border:#C46A00 1px solid;padding:10px;">
                    <div style="width:100%;font-weight:bold;font-size:24px;">${h(totalRec)}</div><div style="width:100%;font-size:12px;">Rutas recorridas</div>
                </div>
                <div style="float:left;position:relative;width:100%;margin-top:10px;"><h2>Mis rutas creadas</h2></div>
                <div id="misRutas" style="float:left;position:relative;width:100%;">
                    ${creadas.map(rt => renderTarjetaRuta(rt, baseUrl)).join('')}
                    ${totalCre > 5 ? `<div id="pag0" style="float:left;position:relative;width:100%;text-align:center;margin-top:20px;color:#C46A00;"><input type="button" onclick="verMas(0,0)" style="border:#C46A00 1px solid;font-size:21px;color:#C46A00;border-radius:5px;background:#ddd;padding:10px;" value="Ver mas"></div>` : ''}
                </div>
                <div style="float:left;position:relative;width:100%;margin-top:20px;">
                    <h2>Mis rutas recorridas</h2>
                    <div id="misRutasR" style="float:left;position:relative;width:100%;">
                        ${recorridas.map(rt => renderTarjetaRuta(rt, baseUrl)).join('')}
                        ${totalRec > 5 ? `<div id="Rpag0" style="float:left;position:relative;width:100%;text-align:center;margin-top:20px;color:#C46A00;"><input type="button" onclick="verMas(0,1)" style="border:#C46A00 1px solid;font-size:21px;color:#C46A00;border-radius:5px;background:#ddd;padding:10px;" value="Ver mas"></div>` : ''}
                    </div>
                </div>
            </div>
            <video id="video" autoplay playsinline style="display:none;"></video>
            <canvas id="canvas" width="50" height="50" style="display:none;"></canvas>`;
            res.send(html);
        } catch (e) {
            console.error('perfil:', e);
            res.status(500).send('error');
        }
    }

    async function pintarPaginacion(req, res, idData, puntero, tabla) {
        res.set('Content-Type', 'text/html; charset=UTF-8');
        try {
            let total = 0, rutas = [];
            if (tabla === 0) {
                const [t] = await dbPool.execute('SELECT COUNT(id) AS n FROM rutas WHERE usuario = ?', [idData]);
                total = parseInt(t[0].n);
                const [r] = await dbPool.execute(
                    'SELECT * FROM rutas WHERE usuario = ? ORDER BY fecha DESC LIMIT 5 OFFSET ?',
                    [idData, puntero]
                );
                rutas = r;
            } else {
                const [t] = await dbPool.execute(
                    `SELECT COUNT(DISTINCT rutas.id) AS n FROM rutas
                     INNER JOIN actividad ON rutas.id = actividad.ruta WHERE actividad.usuario = ?`, [idData]
                );
                total = parseInt(t[0].n);
                const [r] = await dbPool.execute(
                    `SELECT DISTINCT rutas.* FROM rutas
                     INNER JOIN actividad ON rutas.id = actividad.ruta
                     WHERE actividad.usuario = ? ORDER BY rutas.fecha DESC LIMIT 5 OFFSET ?`,
                    [idData, puntero]
                );
                rutas = r;
            }

            let html = rutas.map(r => renderTarjetaRuta(r, baseUrl)).join('');
            if (total > puntero) {
                const pref = tabla === 0 ? 'pag' : 'Rpag';
                html += `<div id="${pref}${puntero}" style="float:left;position:relative;width:100%;text-align:center;margin-top:20px;color:#C46A00;"><input type="button" onclick="verMas(${puntero},${tabla})" style="border:#C46A00 1px solid;font-size:21px;color:#C46A00;border-radius:5px;background:#ddd;padding:10px;" value="Ver mas"></div>`;
            }
            res.send(html);
        } catch (e) {
            console.error('paginación:', e);
            res.status(500).send('error');
        }
    }

    // ----- ruta.php -----
    app.get('/ruta.php', async (req, res) => {
        res.set('Content-Type', 'text/html; charset=UTF-8');
        const idRuta  = req.query.ruta;
        const seccion = req.query.seccion;
        if (!esIdValido(idRuta)) return res.status(400).send('ruta inválida');
        if (!['header','datos','fotos'].includes(seccion)) return res.status(400).send('sección inválida');

        try {
            const [rows] = await dbPool.execute('SELECT * FROM rutas WHERE id = ? LIMIT 1', [idRuta]);
            if (!rows.length) return res.status(404).send('No encontrada');
            const r = rows[0];

            if (parseInt(r.privado) === 1) {
                const u = usuarioActual(req);
                if (!u || String(r.usuario) !== String(u)) return res.status(403).send('No autorizado');
            }

            if (seccion === 'header') {
                return res.send(`
                <div style="float:left;position:relative;width:calc(100% - 20px);padding-left:20px;color:#C46A00;margin-bottom:10px;background:linear-gradient(to top, rgba(255, 255, 255, 1), rgba(255, 217, 138, 1));">
                    <h1>${h(r.nombre)}</h1>
                    <div style="float:left;position:relative;width:100%;height:20px;margin-bottom:10px;font-weight:bold;">${h(r.tipo)}</div>
                </div>`);
            }

            if (seccion === 'datos') {
                const rotAsc = 360 - parseFloat(r.gradAsc);
                const rotDes = parseFloat(r.gradDes);
                return res.send(`
                <div id="datos" style="float:left;position:relative;width:calc(100% - 20px);margin-top:20px;padding-left:20px;">
                    <div style="float:left;position:relative;width:50%;margin-bottom:3px;">Marcha: <span id="marcha_" style="margin-right:5px;font-weight:bold;">${h(r.marcha)}</span></div>
                    <div style="float:left;position:relative;width:50%;margin-bottom:3px;">Descanso: <span id="descanso_" style="margin-right:5px;font-weight:bold;">${h(r.descanso)}</span></div>
                    <div style="float:left;position:relative;width:50%;margin-bottom:3px;">Distancia: <span id="distancia_" style="margin-right:5px;font-weight:bold;">${h(r.distancia)}</span>m</div>
                    <div style="float:left;position:relative;width:50%;margin-bottom:3px;">Velocidad: <span id="velocidad_" style="margin-right:5px;font-weight:bold;">${h(r.velmedia)}</span>km/h</div>
                    <div style="float:left;position:relative;width:50%;margin-bottom:3px;">Alt. base: <span id="txtAlturaMin" style="margin-right:5px;font-weight:bold;">${h(r.base)}</span>m</div>
                    <div style="float:left;position:relative;width:50%;margin-bottom:3px;">Alt. pico: <span id="txtAlturaMax" style="margin-right:5px;font-weight:bold;">${h(r.pico)}</span>m</div>
                    <div style="float:left;position:relative;width:50%;margin-bottom:3px;">Desnivel sup.: <span id="desnivelSup" style="margin-right:5px;font-weight:bold;">${h(r.superior)}</span>m</div>
                    <div style="float:left;position:relative;width:50%;margin-bottom:3px;">Desnivel inf.: <span id="desnivelInf" style="margin-right:5px;font-weight:bold;">${h(r.inferior)}</span>m</div>
                    <div style="float:left;position:relative;width:50%;margin-bottom:10px;">Ascenso: <span id="ascenso" style="margin-right:5px;font-weight:bold;">${h(r.ascenso)}</span>m</div>
                    <div style="float:left;position:relative;width:50%;margin-bottom:10px;">Descenso: <span id="descenso" style="margin-right:5px;font-weight:bold;">${h(r.descenso)}</span>m</div>
                    <div style="float:left;position:relative;width:50%;">Pendiente asc. máx.</div>
                    <div style="float:left;position:relative;width:50%;">Pendiente desc. máx.</div>
                    <div style="float:left;position:relative;width:calc(50% - 10px);padding-left:10px;height:20px;">
                        <div style="float:left;position:relative;height:40px;text-align:right;padding-top:13px;"><div id="pendienteAsc" style="float:left;position:relative;font-weight:bold;text-align:right;">${h(r.porcAsc)}</div>%</div>
                        <div id="pendGradAsc" style="float:left;position:relative;margin-top:18px;margin-bottom:18px;margin-left:10px;margin-right:10px;max-width:36px;width:calc(25% - 2px);border:#F7D99C 1px solid;border-top:orange 2px solid;background:#F7D99C;height:2px;transform:rotate(${h(rotAsc)}deg);"></div>
                        <div style="float:left;position:relative;height:40px;width:15%;padding-top:13px;"><span id="txtGradAsc" style="margin-left:5px;font-weight:bold;">${h(r.gradAsc)}</span>°</div>
                    </div>
                    <div style="float:left;position:relative;width:calc(50% - 10px);padding-left:10px;height:20px;">
                        <div style="float:left;position:relative;height:40px;text-align:right;padding-top:13px;"><div id="pendienteDes" style="float:left;position:relative;font-weight:bold;text-align:right;">${h(r.porcDes)}</div>%</div>
                        <div id="pendGradDes" style="float:left;position:relative;margin-top:18px;margin-bottom:18px;margin-left:10px;margin-right:10px;max-width:36px;width:calc(25% - 2px);border:#F7D99C 1px solid;border-top:orange 2px solid;background:#F7D99C;height:2px;transform:rotate(${h(rotDes)}deg);"></div>
                        <div style="float:left;position:relative;height:40px;width:15%;padding-top:13px;"><span id="txtGradDes" style="margin-left:5px;font-weight:bold;">${h(r.gradDes)}</span>°</div>
                    </div>
                    <div style="float:left;position:relative;width:100%;margin-top:40px;">${h(r.descripcion)}</div>
                    <div id="impreciso" style="float:left;position:relative;width:100%;margin-bottom:3px;display:none;">Lecturas muy imprecisas: <span id="fallos" style="margin-right:5px;font-weight:bold;">0</span></div>
                </div>`);
            }

            if (seccion === 'fotos') {
                const fotos = parseInt(r.fotos) || 0;
                if (fotos === 0) return res.send('');
                const baseFotos = baseUrl;
                let out = '';
                for (let a = 0; a < fotos; a++) {
                    const url = baseFotos + `rutas/${parseInt(idRuta)}/foto_${a}.png`;
                    out += `
                    <div id="divfoto${a}" style="float:left;position:relative;width:100%;text-align:center;color:#C46A00;">
                        <img class="foto" id="foto_${a}" src="${h(url)}" style="float:left;position:relative;margin-left:15%;width:calc(70% - 6px);border:#F5C55F 3px solid;margin-right:15%;margin-top:20px;" alt=""><br>
                    </div>`;
                }
                return res.send(out);
            }
        } catch (e) {
            console.error('ruta:', e);
            res.status(500).send('error');
        }
    });

    // ----- index.php -----
    // GET: listado HTML últimas 20 públicas. POST: crear ruta / registrar actividad.
    // El cliente envía POST con FormData (multipart/form-data), así que
    // detectamos el content-type y pasamos el middleware adecuado:
    //  - multipart  → multer.any() (rellena req.body con los fields)
    //  - urlencoded → express.urlencoded
    const uploadAnyIndex = multer ? multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 20 * 1024 * 1024, fieldSize: 20 * 1024 * 1024 }
    }) : null;

    app.all('/index.php',
        (req, res, next) => {
            const ct = req.headers['content-type'] || '';
            if (ct.includes('multipart/form-data')) {
                if (!uploadAnyIndex) {
                    return res.status(500).send('Falta instalar `multer` en este servidor.');
                }
                return uploadAnyIndex.any()(req, res, next);
            }
            if (ct.includes('application/x-www-form-urlencoded')) {
                return require('express').urlencoded({ extended: false, limit: '20mb' })(req, res, next);
            }
            next();
        },
        async (req, res) => {

            // POST: crear ruta nueva
            if (req.method === 'POST' && req.body?.nombre) {
                const user = exigirUsuario(req, res);
                if (!user) return;
                if (!esIdValido(req.body.usuario) || req.body.usuario !== user) {
                    return res.status(403).send('No autorizado');
                }

                const fotosRaw = String(req.body.fotos || '');
                const fotosArr = fotosRaw === '' ? [] : fotosRaw.replace(/\[|\]/g, '').split(',');
                const nFotos = Math.floor(fotosArr.length / 3);

                let id;
                try {
                    const [result] = await dbPool.execute(`
                        INSERT INTO rutas (
                            usuario, nombre, categoria, dificultad, tipo, descripcion,
                            tiempo, marcha, descanso, distancia, velmedia, velmaxima,
                            base, pico, superior, inferior, ascenso, descenso,
                            porcAsc, porcDes, gradAsc, gradDes, latitud, longitud,
                            privado, fotos
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        user, req.body.nombre, req.body.categoria || '', req.body.dificultad || '',
                        req.body.tipo || '', req.body.descripcion || '',
                        req.body.tiempo || '00:00:00', req.body.marcha || '00:00:00', req.body.descanso || '00:00:00',
                        parseFloat(req.body.distancia) || 0, parseFloat(req.body.velocidad) || 0, parseFloat(req.body.velmax) || 0,
                        parseFloat(req.body.base) || 0, parseFloat(req.body.pico) || 0,
                        parseFloat(req.body.superior) || 0, parseFloat(req.body.inferior) || 0,
                        parseFloat(req.body.ascenso) || 0, parseFloat(req.body.descenso) || 0,
                        parseFloat(req.body.porcAsc) || 0, parseFloat(req.body.porcDes) || 0,
                        parseFloat(req.body.gradAsc) || 0, parseFloat(req.body.gradDes) || 0,
                        parseFloat(req.body.latitud) || 0, parseFloat(req.body.longitud) || 0,
                        parseInt(req.body.privado) || 0, nFotos
                    ]);
                    id = result.insertId;
                } catch (e) {
                    console.error('insert ruta:', e);
                    return res.status(500).send('ERROR: BD');
                }

                const dir = path.join(uploadsDir, 'rutas', String(id));
                try { await fsp.mkdir(dir, { recursive: true }); } catch {}

                // PNG del mapa
                const imgB64 = String(req.body.img || '');
                if (imgB64) {
                    try {
                        const data = Buffer.from(imgB64, 'base64');
                        const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
                        if (data.length > 0 && data.slice(0, 8).equals(PNG) && data.length < 10 * 1024 * 1024) {
                            await fsp.writeFile(path.join(dir, `ruta_${id}.png`), data);
                        }
                    } catch (e) { console.error('png base64:', e); }
                }

                // Notas geolocalizadas (post-it)
                let notas = [];
                try { notas = JSON.parse(String(req.body.notas || '[]')); if (!Array.isArray(notas)) notas = []; }
                catch { notas = []; }

                // GeoJSON (.js) y GPX
                const datosJson = String(req.body.datos || '');
                if (datosJson && datosJson.length < 5 * 1024 * 1024) {
                    let txt = `var geojson= {
"type": "FeatureCollection",
"features": [
{ "type": "Feature", "properties": { "Name": "Ruta_${id}", "description": null, "description_1": null, "recomendations": null }, "geometry": { "type": "LineString", "coordinates": [${datosJson}] }} ] }`;
                    const tieneExtras = nFotos > 0 || notas.length > 0;
                    if (tieneExtras) {
                        txt = txt.substring(0, txt.lastIndexOf(']') - 1);
                        for (let a = 0; a < fotosArr.length; a += 3) {
                            const desc = JSON.stringify(fotosArr[a + 2] || '');
                            const lon = parseFloat(fotosArr[a]) || 0;
                            const lat = parseFloat(fotosArr[a + 1]) || 0;
                            txt += ` , { "type": "Feature", "properties": { "Name": "Foto_${a}", "description": ${desc}, "description_1": null, "recomendations": null }, "geometry": { "type": "Point", "coordinates": [${lon},${lat}] }}`;
                        }
                        for (let n = 0; n < notas.length; n++) {
                            const desc = JSON.stringify(String(notas[n]?.texto || ''));
                            const lon = parseFloat(notas[n]?.lon) || 0;
                            const lat = parseFloat(notas[n]?.lat) || 0;
                            txt += ` , { "type": "Feature", "properties": { "Name": "Nota_${n}", "description": ${desc}, "kind": "note" }, "geometry": { "type": "Point", "coordinates": [${lon},${lat}] }}`;
                        }
                        txt += '] }';
                    }
                    try { await fsp.writeFile(path.join(dir, `ruta_${id}.js`), txt); } catch (e) { console.error('js:', e); }

                    // GPX
                    const gpx = generarGPX(datosJson, req.body.nombre);
                    if (gpx) { try { await fsp.writeFile(path.join(dir, `ruta_${id}.gpx`), gpx); } catch (e) { console.error('gpx:', e); } }
                }

                // Mover fotos temp del usuario a la carpeta de la ruta
                if (nFotos > 0) {
                    try {
                        const tempDir = path.join(uploadsDir, 'temp');
                        const files = await fsp.readdir(tempDir);
                        const prefijo = user + '_';
                        for (const f of files) {
                            if (!f.startsWith(prefijo)) continue;
                            const sufijo = f.substring(f.indexOf('_'));
                            const dest = path.join(dir, 'foto' + sufijo);
                            await fsp.rename(path.join(tempDir, f), dest).catch(() => {});
                        }
                    } catch (e) { console.error('mover temp:', e); }
                }

                return res.send(String(id));
            }

            // POST: registrar actividad
            if (req.method === 'POST' && req.body?.ruta) {
                const user = exigirUsuario(req, res);
                if (!user) return;
                if (!esIdValido(req.body.ruta) || !esIdValido(req.body.usuario) || req.body.usuario !== user) {
                    return res.status(403).send('No autorizado');
                }
                try {
                    const [result] = await dbPool.execute(`
                        INSERT INTO actividad (ruta, usuario, tiempo, distancia, velmedia, velmaxima, marcha, descanso)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        req.body.ruta, user,
                        req.body.tiempo || '00:00:00', parseFloat(req.body.distancia) || 0,
                        parseFloat(req.body.velmedia) || 0, parseFloat(req.body.velmaxima) || 0,
                        req.body.marcha || '00:00:00', req.body.descanso || '00:00:00',
                    ]);
                    return res.send(String(result.insertId));
                } catch (e) {
                    console.error('insert actividad:', e);
                    return res.status(500).send('ERROR: BD');
                }
            }

            // GET: listado últimas 20 públicas
            res.set('Content-Type', 'text/html; charset=UTF-8');
            try {
                const [rutas] = await dbPool.execute(
                    'SELECT * FROM rutas WHERE privado = 0 ORDER BY fecha DESC LIMIT 20'
                );
                const html = rutas.map(r => {
                    const id = parseInt(r.id);
                    const pico = parseFloat(r.pico || 0);
                    const baseAlt = parseFloat(r.base || 0);
                    var desnv = pico - baseAlt;
                    desnv = desnv.toFixed(2);
                    const imgUrl = baseUrl + `rutas/${id}/ruta_${id}.png`;
                    const detUrl = baseUrl + 'info/' + generarSeoURL(r.nombre || '') + '/' + id;
                    const fecha = String(r.fecha || '');
                    const fechaFmt = fecha.length >= 10
                        ? `${fecha.substring(4,15)}`
                        : '';
                    return `
                    <div style="float:left;position:relative;width:calc(100% - 46px);padding:10px;margin:10px;border:#F5C55F 3px solid;border-radius:5px;background:#FFE1B3;">
                        <div style="float:left;position:relative;width:50%;">
                            <img src="${h(imgUrl)}" style="width:100%;" alt="">
                        </div>
                        <div style="float:left;position:relative;width:calc(50% - 20px);padding-left:20px;">
                            <span style="font-size:14px;font-weight:bold;"><a href="${h(detUrl)}">${h(r.nombre)}</a></span><br>
                            ${r.tipo ? `<span style="font-weight:bold;">${h(r.tipo)}</span><br>` : ''}
                            ${h(fechaFmt)}<br>
                            <em>Tiempo</em>: ${h(r.tiempo)}<br>
                            <em>Distancia</em>: ${h(r.distancia)} metros<br>
                            <em>Desnivel</em>: ${h(desnv)} metros<br>
                        </div>
                    </div>`;
                }).join('');
                res.send(html);
            } catch (e) {
                console.error('list rutas:', e);
                res.status(500).send('error');
            }
        }
    );
};

// ============================================================
//  GPX generator (sustituye generarGPX de index.php)
// ============================================================
function generarGPX(jsonDatos, nombreRuta) {
    jsonDatos = String(jsonDatos).replace(/\\/g, '').trim().replace(/,$/, '');
    let puntos;
    try { puntos = JSON.parse(jsonDatos); }
    catch { try { puntos = JSON.parse('[' + jsonDatos + ']'); } catch { return null; } }
    if (!Array.isArray(puntos) || puntos.length === 0) return null;

    const esc = s => String(s).replace(/[<>&'"]/g, c =>
        ({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[c]));

    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    gpx += '<gpx version="1.1" creator="Itinere.pro" xmlns="http://www.topografix.com/GPX/1/1">\n';
    gpx += '  <trk>\n';
    gpx += `    <name>${esc(nombreRuta)}</name>\n`;
    gpx += '    <trkseg>\n';
    for (const p of puntos) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const lon = parseFloat(String(p[0]).replace(/\[|\]/g, '')) || 0;
        const lat = parseFloat(p[1]) || 0;
        const ele = parseFloat(p[2]) || 0;
        gpx += `      <trkpt lat="${lat}" lon="${lon}">\n        <ele>${ele}</ele>\n      </trkpt>\n`;
    }
    gpx += '    </trkseg>\n  </trk>\n</gpx>';
    return gpx;
}

// `express` no se requiere a nivel top porque ya está en el server.js.
// Pero los middlewares (raw, urlencoded, json) sí: lo cargamos perezosamente.
const express = require('express');
