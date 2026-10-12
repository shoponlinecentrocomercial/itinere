const { Resend } = require('resend');
const express = require('express');
const cookieParser = require('cookie-parser');
const https = require('https');
const cors = require('cors');
const fs = require('fs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const httpProxy = require('http-proxy');
const path = require('path');
const { 
    generateRegistrationOptions, 
    verifyRegistrationResponse, 
    generateAuthenticationOptions, 
    verifyAuthenticationResponse 
} = require('@simplewebauthn/server');

const required = ['MAPBOX_TOKEN', 'COOKIE_SECRET', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SSL_KEY_PATH', 'SSL_CERT_PATH'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
    console.error(`Faltan variables de entorno: ${missing.join(', ')}. Ejecuta el servidor con \`node --env-file=../../.env server.js\`.`);
    process.exit(1);
}
const token = process.env.MAPBOX_TOKEN;
const apiResend = process.env.RESEND_API_KEY;

const app = express();
const resend = new Resend(apiResend);
const proxy = httpProxy.createProxyServer({
  secure: true, // Validar el certificado SSL de Mapbox
  changeOrigin: true, // Cambiar el header 'host' a mapbox.com
});
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET));

// Cabeceras de seguridad por defecto en respuestas HTML
const CSP = [
    "default-src 'self' https://itinere.pro https://itinere.pro:2083",
    "connect-src 'self' https://itinere.pro https://itinere.pro:2083 wss://itinere.pro:2083",
    "script-src 'self' 'unsafe-inline' https://itinere.pro https://unpkg.com https://www.gstatic.com",
    // gstatic necesario para Google Charts (cargan CSS desde /charts/.../css/)
    "style-src 'self' 'unsafe-inline' https://itinere.pro https://www.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https://itinere.pro",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "frame-src https://itinere.pro:2083",
    "object-src 'none'",
].join('; ');

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    // CSP sólo se añade si la respuesta es HTML. express.static la envía como text/html.
    const orig = res.setHeader.bind(res);
    res.setHeader = (name, value) => {
        if (name.toLowerCase() === 'content-type' && String(value).startsWith('text/html')) {
            orig('Content-Security-Policy', CSP);
        }
        return orig(name, value);
    };
    next();
});

app.use(express.static('public'));

// =====================================================================
//  Servir uploads (sustituye al servidor PHP en :2053).
//  Las URLs públicas /rutas/{id}/... y /usuarios/{id}/... ahora van a
//  Express en vez de pasar por Apache+PHP.
// =====================================================================
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/var/www/itinere.pro';
app.use('/rutas',    express.static(path.join(UPLOADS_DIR, 'rutas'),    { maxAge: '7d', fallthrough: true }));
app.use('/usuarios', express.static(path.join(UPLOADS_DIR, 'usuarios'), { maxAge: '1d', fallthrough: true }));
app.use('/temp',     express.static(path.join(UPLOADS_DIR, 'temp'),     { maxAge: '1h', fallthrough: true }));

// CORS restringido a orígenes válidos. Para Cordova/WebView (origen "null" o file://),
// añadir aquí los esquemas correspondientes (capacitor://localhost, http://localhost, etc.).
const allowedOrigins = (process.env.CORS_ORIGINS || 'https://itinere.pro')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const corsOptions = {
    origin: function (origin, callback) {
        // Permitir same-origin (sin header Origin: peticiones server-server o curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origen no permitido por CORS: ' + origin));
    },
    optionsSuccessStatus: 200,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
};
app.use(cors(corsOptions));
// ==========================================
// CONFIGURACIÓN DE BASE DE DATOS (POOL)
// ==========================================
const dbPool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ==========================================
// MIGRACIÓN PHP → NODE
// Registra los endpoints /info.php, /infoUsuario.php, /foto.php,
// /email.php, /usuario.php, /ruta.php, /index.php directamente en Express,
// reutilizando dbPool y la cookie firmada de cookie-parser.
// ==========================================
const registerPhpCompat = require('./php-compat');
registerPhpCompat(app, dbPool, {
    uploadsDir: process.env.UPLOADS_DIR || '/var/www/itinere.pro',
    baseUrl:    'https://' + (process.env.WEBAUTHN_RP_ID || 'itinere.pro') + '/',
});
//Contadores mapbox
let staticCount = 0;
let rasterCount = 0;
let queryCount = 0;
let diaActual = new Date().toDateString(); // Guarda la fecha de hoy, ej: "Tue May 05 2026"
const maxStatic = Number(process.env.MAPBOX_MAX_STATIC) || 6000;
const maxRaster = Number(process.env.MAPBOX_MAX_RASTER) || 22000;
const maxQuery  = Number(process.env.MAPBOX_MAX_QUERY)  || 3000;
// ==========================================
// CONFIGURACIÓN IMPORTANTE PARA WEBAUTHN
// ==========================================
const rpName = process.env.WEBAUTHN_RP_NAME || 'Itinere';
const rpID   = process.env.WEBAUTHN_RP_ID   || 'itinere.pro';
const port   = Number(process.env.NODE_HTTPS_PORT) || 8443;

const expectedOrigins =[
    `https://${rpID}`, 
    `https://${rpID}:${port}`
];

const COOKIE_24H = 24 * 60 * 60 * 1000;

// ==========================================
// RUTAS DE UTILIDAD Y REDIRECCIÓN
// ==========================================

app.get('/read-cookie', (req, res) => {
    const userId = req.signedCookies.usuario;
    if (userId) {
        res.json({ logueado: true, id: userId });
    } else {
        res.json({ logueado: false });
    }
});

// Opciones reutilizables para la cookie de sesión
const cookieOpts = () => ({
    maxAge: COOKIE_24H,
    httpOnly: true,
    secure: true,
    signed: true,
    path: '/',
    sameSite: 'none',
    domain: rpID,
});

// =====================================================================
//  LOGIN POR MAGIC-CODE EMAIL
//  La clave se genera y verifica en el backend (no en el cliente).
//  Se almacena en memoria con TTL de 10 minutos. Para alta disponibilidad
//  multi-instancia conviene mover a Redis o tabla magic_links.
// =====================================================================
const MAGIC_TTL_MS  = 10 * 60 * 1000;
const MAGIC_MAX_TRY = 5;
const magicStore = new Map(); // email -> { hash, expira, intentos }

function hashClave(email, clave) {
    return crypto.createHmac('sha256', process.env.COOKIE_SECRET)
        .update(email + '|' + clave)
        .digest('hex');
}

// Limpieza periódica
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of magicStore.entries()) {
        if (v.expira < now) magicStore.delete(k);
    }
}, 60 * 1000).unref();

app.post('/auth/email/request', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
        return res.status(400).json({ error: 'Email inválido: ' + email });
    }
    const clave = String(crypto.randomInt(100000, 1000000)); // 6 cifras
    magicStore.set(email, {
        hash:    hashClave(email, clave),
        expira:  Date.now() + MAGIC_TTL_MS,
        intentos: 0,
    });

    // Llamamos a resend para que dispare el envío. Evitamos shell_exec.
    try {
        
const { data, error } = await resend.emails.send({
    from: "Itinere <no-reply@itinere.pro>",
    to: [email],  // <-- usa la variable email, no "to"
    subject: "Clave de acceso",
    html: "Usa esta clave para acceder a tu cuenta en itinere.pro: <strong>" + clave + "</strong>",
});

  if (error) {
    console.error('resend respondió', r.status);
    return res.status(502).json({ error: 'No se pudo enviar el email' });
  }

  res.status(200).json({ data });

    } catch (e) {
        console.error('Error llamando a resend:', e);
        res.status(502).json({ error: 'No se pudo enviar el email' });
    }
});

app.post('/auth/email/verify', async (req, res) => {
    var id = String(req.body?.id || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const clave = String(req.body?.clave || '').trim();
    const pag   = String(req.body?.pag   || 'index');

    const reg = magicStore.get(email);
    if (!reg || reg.expira < Date.now()) {
        magicStore.delete(email);
        return res.status(401).json({ error: 'Código expirado o no solicitado' });
    }
    reg.intentos++;
    if (reg.intentos > MAGIC_MAX_TRY) {
        magicStore.delete(email);
        return res.status(429).json({ error: 'Demasiados intentos' });
    }
    const esperado = hashClave(email, clave);
    if (!crypto.timingSafeEqual(Buffer.from(reg.hash), Buffer.from(esperado))) {
        return res.status(401).json({ error: 'Código incorrecto' });
    }
    magicStore.delete(email);

    // Crear o recuperar usuario por email
   // const [rows] = await dbPool.query('SELECT id FROM usuarios WHERE email = ?', [email]);
    const [rows] = await dbPool.query('SELECT id FROM usuarios WHERE email = ? OR id = ?', [email, id]);
    //let id;
    if (rows.length === 0) {
        const [result] = await dbPool.execute(
            `INSERT INTO usuarios (credential_id, public_key, transports, email, expire)
             VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY))`,
            [generateCredentialId(), generateFakePublicKey(), 'email', email]
        );
        id = result.insertId;
        await dbPool.execute('UPDATE usuarios SET nombre = ? WHERE id = ?', [`Itinerer_${id}`, id]);
    } else {
        id = rows[0].id;
        await dbPool.execute('UPDATE usuarios SET email = ? WHERE id = ?', [email, id]);
    }

    res.cookie('usuario', String(id), cookieOpts());
    res.json({ ok: true, id, redirect: resolverRedirect(pag) });
});

app.post('/borrar/cuenta', async (req, res) => {
    var id = String(req.body?.id || '').trim();
    const pag   = String(req.body?.pag   || 'index');

    // Borrar usuario por id
   
        const [result] = await dbPool.execute(
            'DELETE FROM usuarios where id = ?', [id]
        );
    if (result.affectedRows > 0) {
        res.json({ ok: true, id, redirect: resolverRedirect(pag) });
    } else {
        res.json({ ok: false, id, redirect: resolverRedirect(pag) });
    }
});

// Convierte el parámetro `pag` (pasado desde acceso.html) en una URL absoluta segura.
function resolverRedirect(pag) {
    pag = String(pag || '').trim();
    while (pag.startsWith('/')) pag = pag.substring(1);
    if (pag.length > 200) return 'https://' + rpID + '/index.html';
    if (pag.indexOf('|') !== -1) {
        if (pag.indexOf('|invitacion') !== -1) {
            return 'https://' + rpID + '/go.html?var=/' + pag.split('|').join('/');
        }
        return 'https://' + rpID + '/ruta.html?var=/' + pag.split('|').join('/');
    }
    if (!/^[A-Za-z0-9._\-?=&]+$/.test(pag)) return 'https://' + rpID + '/index.html';
    if (pag.endsWith('.html')) return 'https://' + rpID + '/' + pag;
    return 'https://' + rpID + '/' + pag + '.html';
}

app.get('/ruta/:ruta/:id/:lat/:lon/:dis', (req, res) => {
  const { id, ruta, lat, lon, dis } = req.params;
  res.redirect(`https://itinere.pro/acceso.html?pag=/ruta|${ruta}|${id}|${lat}|${lon}|${dis}`);
});   

app.get('/info/:ruta/:id', (req, res) => {
  const { id, ruta } = req.params;
  res.redirect(`https://itinere.pro/info.html?pag=/info/${ruta}/${id}`);
});   

app.get('/go/:id', (req, res) => {
  const { id } = req.params;
  res.redirect(`https://itinere.pro/go.html?/${id}`);
});   

// Endpoint para consultar los tokens publicos disponibles
app.get('/tokens/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await dbPool.query('SELECT tokens FROM usuarios WHERE id = ?', [id]);
        
        // Verificar si existe el usuario
        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const tokens = rows[0].tokens;
        
        if (tokens > 0) {
            res.json({ label: 'PrT:', tokens: tokens });
        } else {
            // Asegúrate de que maxStatic y staticCount estén definidos
            res.json({ label: 'PuT:', tokens: (maxStatic - staticCount) });
        }
    } catch (error) {
        console.error('Error en /tokens/:id:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// WEBHOOK PARA REENVÍO DE EMAILS RECIBIDOS
// ==========================================

// Variable para la dirección de destino (puedes cambiarla en cualquier momento)
let forwardToEmail = 'symphoniertech@gmail.com';

// Endpoint para cambiar la dirección de destino dinámicamente
app.post('/resend/forward-config', express.json(), (req, res) => {
    const { forward_email } = req.body;
    if (!forward_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forward_email)) {
        return res.status(400).json({ error: 'Email de destino inválido' });
    }
    forwardToEmail = forward_email;
    console.log(`✅ Dirección de reenvío actualizada a: ${forwardToEmail}`);
    res.json({ ok: true, forward_to: forwardToEmail });
});

// Endpoint para consultar la dirección actual
app.get('/resend/forward-config', (req, res) => {
    res.json({ forward_to: forwardToEmail });
});

// Webhook que recibe los emails de Resend
app.post('/resend/webhook', express.json(), async (req, res) => {
    // Verificar el secreto de Resend (si está configurado)
    const signature = req.headers['resend-signature'];
    const secret = process.env.SECRET_RESEND;
    
    if (secret && signature) {
        // Verificación básica del webhook (Resend usa firma en header)
        // Nota: Para una verificación completa, necesitarías el cuerpo raw.
        // Esta es una validación simple.
        console.log(`🔐 Webhook recibido con firma: ${signature.substring(0, 20)}...`);
    } else if (secret && !signature) {
        console.warn('⚠️ Webhook recibido sin firma esperada');
        // No rechazamos automáticamente por si Resend no envía firma en tu plan
    }
    
    try {
        const event = req.body;
        console.log(`📧 Evento recibido: ${event.type}`);
        
        // Procesar solo eventos de email recibido
if (event.type === 'email.received') {
    const emailData = event.data;
    const originalFrom = emailData.from;
    const originalSubject = emailData.subject;
    
    const { Resend } = require('resend');
    const resendClient = new Resend(apiResend);
    
    // Nota: forward() puede no permitir modificar asunto
    // Si no permite, usa send() en su lugar (ver Opción 3)
    const { data, error } = await resendClient.emails.receiving.forward({
        emailId: event.data.email_id,
        to: forwardToEmail,
        from: `${originalFrom} <no-reply@itinere.pro>`,
    });
    
    if (error) {
        console.error('❌ Error al reenviar email:', error);
        return res.status(502).json({ error: 'Error al reenviar el email' });
    }
    
    console.log(`✅ Email reenviado a ${forwardToEmail} | Original de: ${originalFrom}`);
}
        
        // Resend espera una respuesta 200 para confirmar recepción
        res.status(200).json({ ok: true });
        
    } catch (error) {
        console.error('💥 Error procesando webhook:', error);
        res.status(500).json({ error: 'Error interno procesando webhook' });
    }
});

// Función auxiliar para escapar HTML
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

console.log('📨 Webhook de Resend disponible en POST /resend/webhook');
console.log('   Configurar dirección de reenvío en POST /resend/forward-config');

// ==========================================
// 1. GENERAR REGISTRO
// ==========================================
app.get('/generate-registration-options', async (req, res) => {
    try {
        const newUserId = "user_" + Date.now(); 

        const options = await generateRegistrationOptions({
            rpName,
            rpID,
            userID: new Uint8Array(Buffer.from(newUserId)), 
            userName: newUserId,
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                residentKey: 'required',
                userVerification: 'required',
            },
        });

        res.cookie('webauthn_challenge', options.challenge, { maxAge: 300000, httpOnly: true, secure: true, signed: true });
        
        res.json(options);
    } catch (error) {
        console.error("Error generando opciones:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 2. VERIFICAR REGISTRO Y GUARDAR EN BD
// ==========================================
app.post('/verify-registration', async (req, res) => {
    const { body } = req;
    const expectedChallenge = req.signedCookies.webauthn_challenge;

    if (!expectedChallenge) return res.status(400).json({ error: 'Expirado' });

    try {
        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge,
            expectedOrigin: expectedOrigins,
            expectedRPID: rpID,
        });

        if (verification.verified) {
            const { credential } = verification.registrationInfo;
            const credIdBase64 = credential.id; 
            const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64');
            const transportsJson = JSON.stringify(credential.transports ||[]);

            let idUs = 0;

            const [rows] = await dbPool.execute("SELECT id FROM usuarios WHERE credential_id = ?", [credIdBase64]);

            if (rows.length === 0) {
                const [result] = await dbPool.execute(
                    `INSERT INTO usuarios (credential_id, public_key, transports, counter, expire) 
                     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY))`,[credIdBase64, publicKeyBase64, transportsJson, credential.counter]
                );
                idUs = result.insertId;
                
                await dbPool.execute("UPDATE usuarios SET nombre = ? WHERE id = ?",[`Itinerer_${idUs}`, idUs]);
                console.log(`✅ NUEVO usuario registrado con ID: ${idUs}`);
            } else {
                idUs = rows[0].id;
                console.log(`♻️ Usuario existente detectado con ID: ${idUs}`);
            }

            res.clearCookie('webauthn_challenge');
            res.cookie('usuario', String(idUs), cookieOpts());
            return res.json({ verified: true, id: idUs, redirect: resolverRedirect(req.query.pag || 'index') });
        }
    } catch (error) {
        console.error("Error en registro:", error);
        return res.status(400).json({ error: error.message });
    }
});

// ==========================================
// 3. INICIAR AUTENTICACIÓN
// ==========================================
app.get('/generate-authentication-options', async (req, res) => {
    try {
        const options = await generateAuthenticationOptions({
            rpID,
            userVerification: 'required',
        });

        res.cookie('webauthn_challenge', options.challenge, { maxAge: 300000, httpOnly: true, secure: true, signed: true });
        
        res.json(options);
    } catch (error) {
        console.error("Error al generar opciones de login:", error);
        res.status(500).json({ error: error.message }); 
    }
});

// ==========================================
// 4. VERIFICAR AUTENTICACIÓN (LOGIN)
// ==========================================
app.post('/verify-authentication', async (req, res) => {
    const { body } = req;
    const expectedChallenge = req.signedCookies.webauthn_challenge;

    if (!expectedChallenge) return res.status(400).json({ error: 'Expirado' });

    try {
        const [rows] = await dbPool.execute("SELECT * FROM usuarios WHERE credential_id = ?", [body.id]);
        
        if (rows.length === 0) {
            return res.status(400).json({ error: 'Dispositivo no encontrado en la BD. Regístrate primero.' });
        }

        const userDb = rows[0];
        const publicKeyUint8 = new Uint8Array(Buffer.from(userDb.public_key, 'base64'));

        const verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge,
            expectedOrigin: expectedOrigins,
            expectedRPID: rpID,
            credential: {
                id: userDb.credential_id,
                publicKey: publicKeyUint8,
                counter: userDb.counter,
                transports: JSON.parse(userDb.transports || '[]'),
            },
        });

        if (verification.verified) {
            await dbPool.execute("UPDATE usuarios SET counter = ? WHERE id = ?", [verification.authenticationInfo.newCounter, userDb.id]);

            res.clearCookie('webauthn_challenge');
            res.cookie('usuario', String(userDb.id), cookieOpts());
            return res.json({
                verified: true,
                id: userDb.id,
                redirect: resolverRedirect(req.query.pag || 'index'),
                message: 'Login exitoso',
            });
        }
    } catch (error) {
        console.error("Error en login:", error);
        return res.status(400).json({ error: error.message });
    }
});

// ==========================================
// FUNCIONES DE APOYO CORREGIDAS PARA NODEJS
// ==========================================

function generateCredentialId() {
  // 🛠️ CORRECCIÓN: Usamos crypto nativo de Node para generar el ID en formato "base64url"
  // Esto genera 32 bytes y los convierte de manera segura y compatible con MySQL
  return crypto.randomBytes(32).toString('base64url');
}

function generateFakePublicKey() {
  // 🛠️ CORRECCIÓN: La BD espera que sea Base64. Devolvemos directamente un Base64 
  // para que tenga coherencia con cómo lo guardas en /verify-registration
  return crypto.randomBytes(64).toString('base64');
}

//PROXY CONTROL PETICIONES A MAPBOX
// Lógica de contabilización de peticiones
app.use(async (req, res, next) => {
  const diaDeLaPeticion = new Date().toDateString();

  // 1. Comprobamos si hemos cambiado de día (Ej: ya pasó la medianoche)
  if (diaDeLaPeticion !== diaActual) {
    staticCount = 0;
    rasterCount = 0;
    queryCount  = 0;
    diaActual   = diaDeLaPeticion;
    console.log('🔄 Nuevo día detectado. Contadores reiniciados a 0.');
  }

  // 2. Sumamos la petición
 let urlMapbox = req.url;
const mapboxIndex = urlMapbox.indexOf('/mapbox/');
if (mapboxIndex === -1) {
    return res.status(400).json({ error: 'URL inválida' });
}

let usuario = urlMapbox.substring(0, mapboxIndex);
usuario = usuario.substring(usuario.lastIndexOf('/') + 1);

// Validar que el usuario no esté vacío
if (!usuario) {
    return res.status(400).json({ error: 'Usuario no especificado' });
}

try {
    const [rows] = await dbPool.query('SELECT tokens FROM usuarios WHERE id = ?', [usuario]);
    
    // Verificar si existe el usuario
    if (!rows || rows.length === 0) {
        console.log('Usuario no encontrado');
        return res.status(404).json({ error: 'Usuario no encontrado' }); // ✅ Se detiene aquí
    }
    
    const tokens = rows[0].tokens; // ✅ Ahora es seguro acceder
    
    // Asegurar que las variables estén definidas
    if (typeof staticCount === 'undefined') staticCount = 0;
    if (typeof rasterCount === 'undefined') rasterCount = 0;
    if (typeof queryCount === 'undefined') queryCount = 0;
    
    if (tokens > 0) {
        await dbPool.execute('UPDATE usuarios SET tokens = ? WHERE id = ?', [(tokens - 1), usuario]);
    } else {
        if (urlMapbox.indexOf('/v1/') != -1) { // static tiles
            staticCount++;
            console.log(`Petición #${staticCount}/${maxStatic} de static tiles del día: ${req.method} ${req.url}`);
        } else if (urlMapbox.indexOf('/v4/') != -1) { // raster y query tiles
            if (urlMapbox.indexOf('/tilequery/') != -1) {
                queryCount++;
                console.log(`Petición #${queryCount}/${maxQuery} de query tiles del día: ${req.method} ${req.url}`);
            } else {
                rasterCount++;
                console.log(`Petición #${rasterCount}/${maxRaster} de raster tiles del día: ${req.method} ${req.url}`);
            }
        }

        // 3. Bloqueamos si se excede
        if (staticCount > maxStatic || rasterCount > maxRaster || queryCount > maxQuery) {
            return res.status(429).json({ error: 'Límite de peticiones diarias superado' });
        }
    }
} catch (error) {
    console.error('Error de usuario', error);
    res.status(500).json({ error: 'Error interno del servidor' });
}
  
  console.log(req.url);
  
  next();
});

// Ruta proxy para Mapbox.
// req.url típico: /mapbox/styles/v1/mapbox/satellite-v9/tiles/14/8000/6000?access_token=
// Tenemos que quitar el prefijo /mapbox y dejar el path relativo a api.mapbox.com,
// añadiendo nuestro token. http-proxy concatena target + req.url, así que req.url
// DEBE ser un path absoluto del servidor destino, no una URL completa.
app.all('/:id/mapbox/:path(*)', (req, res) => {
    const qIndex = req.url.indexOf('?');
    const query  = qIndex >= 0 ? req.url.substring(qIndex + 1) : '';
    const params = new URLSearchParams(query);
    params.set('access_token', token);
    req.url = '/' + req.params.path + '?' + params.toString();
    proxy.web(req, res, { target: 'https://api.mapbox.com' });
});

// Manejo de errores del proxy
proxy.on('error', (err, req, res) => {
  console.error('Error en proxy:', err);
  res.status(500).json({ error: 'Error en el proxy del servidor' });
});
// ==========================================
// SERVIDOR HTTPS
// ==========================================
const sslOptions = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH)
};

https.createServer(sslOptions, app).listen(port, () => {
    console.log(`✅ Servidor HTTPS corriendo de forma segura en puerto ${port}`);
});