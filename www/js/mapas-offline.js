// mapas-offline.js — descarga y caché de teselas de mapa en IndexedDB para
// poder seguir una ruta sin conexión (planificar-ruta.html descarga,
// ruta.html las sirve con una capa Leaflet cache-first).
//
// Las teselas se guardan por coordenada global 'estilo/z/x/y' (una tesela no
// pertenece a una ruta: cualquier ruta que pase por la zona la reutiliza).
// El store 'descargas' sólo asocia claves a cada descarga para poder borrar.
//
// CADUCIDAD: los términos de Mapbox permiten cachear teselas un máximo de
// 30 días. obtener() no sirve teselas caducadas y purgarCaducadas() las
// elimina al cargar cualquier página que incluya este script.

var mapasOffline = (function () {
    var NOMBRE_DB = 'ItinereMapasOffline';
    var CADUCIDAD_MS = 30 * 24 * 3600 * 1000; // 30 días (términos Mapbox)
    var ZOOM_MIN = 14, ZOOM_MAX = 18;
    var ESTILO = 'mapbox/outdoors-v12'; // el que usa ruta.html
    // El proxy del servidor es /{idUsuario}/mapbox/... (contabiliza las
    // peticiones por usuario y responde 400 si falta el id). {usuario} se
    // sustituye en el momento de pedir cada tesela, ver esperarUsuario().
    var URL_PROXY = 'https://itinere.pro/{usuario}/mapbox/';
    var URL_ESTILO = URL_PROXY + 'styles/v1/' + ESTILO + '/tiles/{z}/{x}/{y}?access_token=';
    var URL_TERRENO = URL_PROXY + 'v4/mapbox.terrain-rgb/14/{x}/{y}@2x.pngraw?access_token=';
    var BYTES_POR_TESELA = 25 * 1024; // sólo para estimar antes de descargar

    var dbPromesa = null;
    function abrirDB() {
        if (dbPromesa) return dbPromesa;
        dbPromesa = new Promise(function (resolve, reject) {
            var req = indexedDB.open(NOMBRE_DB, 1);
            req.onupgradeneeded = function () {
                var d = req.result;
                if (!d.objectStoreNames.contains('teselas')) d.createObjectStore('teselas');
                if (!d.objectStoreNames.contains('descargas')) d.createObjectStore('descargas');
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
        return dbPromesa;
    }

    function enTransaccion(store, modo, fn) {
        return abrirDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(store, modo);
                var resultado = fn(tx.objectStore(store));
                tx.oncomplete = function () { resolve(resultado && resultado.result !== undefined ? resultado.result : resultado); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    // ---------- Usuario (para el proxy /{id}/mapbox/) ----------
    // Las páginas reciben el id del usuario logueado de forma asíncrona
    // (/read-cookie) en la global `id`. Las teselas cacheadas no lo necesitan,
    // pero antes de pedir cualquier cosa a la red hay que esperar a tenerlo:
    // si se pidiera con id 0 el proxy respondería 404 y Leaflet no reintenta.
    // La página puede avisar con setUsuario(id); si no lo hace, se sondea la
    // global `id` durante un máximo de 15 s y después se sigue con lo que haya.
    var usuarioActual = 0;
    var resolverUsuario = null;
    var usuarioPromesa = new Promise(function (resolve) { resolverUsuario = resolve; });
    var sondeoUsuario = null;

    function leerUsuarioGlobal() {
        try { return (typeof id !== 'undefined') ? (parseInt(id, 10) || 0) : 0; } catch (e) { return 0; }
    }
    function setUsuario(u) {
        u = parseInt(u, 10) || 0;
        if (u <= 0) return;
        usuarioActual = u;
        if (sondeoUsuario) { clearInterval(sondeoUsuario); sondeoUsuario = null; }
        resolverUsuario(u);
    }
    function esperarUsuario() {
        if (usuarioActual > 0) return Promise.resolve(usuarioActual);
        var g = leerUsuarioGlobal();
        if (g > 0) { setUsuario(g); return Promise.resolve(g); }
        if (!sondeoUsuario) {
            var intentos = 0;
            sondeoUsuario = setInterval(function () {
                var v = leerUsuarioGlobal();
                if (v > 0) { setUsuario(v); return; }
                if (++intentos >= 150) { // 15 s sin id: no bloquear más
                    clearInterval(sondeoUsuario); sondeoUsuario = null;
                    resolverUsuario(0);
                }
            }, 100);
        }
        return usuarioPromesa;
    }
    // Sustituye {usuario} por el id conocido (0 si aún no hay: el proxy fallará
    // igual que antes, pero no se bloquea nada).
    function conUsuario(url) { return url.replace('{usuario}', usuarioActual || leerUsuarioGlobal() || 0); }

    // ---------- Matemática de teselas (esquema slippy z/x/y estándar, el
    // mismo con el que Leaflet construye las URLs de la capa) ----------
    function lonLatATesela(lon, lat, z) {
        var n = Math.pow(2, z);
        var x = Math.floor(((lon + 180) / 360) * n);
        var latRad = lat * Math.PI / 180;
        var y = Math.floor((0.5 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / (2 * Math.PI)) * n);
        var max = n - 1;
        return { x: Math.min(Math.max(x, 0), max), y: Math.min(Math.max(y, 0), max) };
    }

    // Corredor de teselas que cubre la ruta: para cada punto y cada zoom,
    // la tesela del punto + 1 tesela de margen alrededor (3x3), deduplicado.
    // Devuelve { mapa: [{z,x,y,clave}], terreno: [{x,y,clave}] }.
    function clavesCorredor(puntos) {
        var vistas = {};
        var mapa = [];
        var terreno = [];
        for (var i = 0; i < puntos.length; i++) {
            var lat = puntos[i][0], lon = puntos[i][1];
            for (var z = ZOOM_MIN; z <= ZOOM_MAX; z++) {
                var t = lonLatATesela(lon, lat, z);
                var n = Math.pow(2, z) - 1;
                for (var dx = -1; dx <= 1; dx++) {
                    for (var dy = -1; dy <= 1; dy++) {
                        var x = t.x + dx, y = t.y + dy;
                        if (x < 0 || y < 0 || x > n || y > n) continue;
                        var clave = ESTILO + '/' + z + '/' + x + '/' + y;
                        if (!vistas[clave]) {
                            vistas[clave] = true;
                            mapa.push({ z: z, x: x, y: y, clave: clave });
                            if (z === 14) {
                                var claveT = 'terrain-rgb/14/' + x + '/' + y;
                                terreno.push({ x: x, y: y, clave: claveT });
                            }
                        }
                    }
                }
            }
        }
        return { mapa: mapa, terreno: terreno };
    }

    function urlDeTesela(t) { // t: {z,x,y} de mapa, o {x,y} de terreno (clave lo distingue)
        if (t.clave.indexOf('terrain-rgb/') === 0) {
            return conUsuario(URL_TERRENO.replace('{x}', t.x).replace('{y}', t.y));
        }
        return conUsuario(URL_ESTILO.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y));
    }

    // ---------- Lectura ----------
    // Devuelve el Blob si existe y no ha caducado; si caducó lo borra y devuelve null.
    function obtener(clave) {
        return abrirDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction('teselas', 'readonly');
                var req = tx.objectStore('teselas').get(clave);
                req.onsuccess = function () {
                    var reg = req.result;
                    if (!reg) return resolve(null);
                    if (Date.now() - reg.ts > CADUCIDAD_MS) {
                        enTransaccion('teselas', 'readwrite', function (s) { s.delete(clave); }).catch(function () {});
                        return resolve(null);
                    }
                    resolve(reg.b);
                };
                req.onerror = function () { resolve(null); };
            });
        }).catch(function () { return null; });
    }

    // URL para la tesela de terreno (elevación): blob local si está cacheada,
    // URL de red si no. El llamador debe revocar el objectURL tras usarlo.
    function urlTerreno(x, y) {
        var clave = 'terrain-rgb/14/' + x + '/' + y;
        return obtener(clave).then(function (blob) {
            if (blob) return URL.createObjectURL(blob);
            return esperarUsuario().then(function () {
                return conUsuario(URL_TERRENO.replace('{x}', x).replace('{y}', y));
            });
        });
    }

    // ---------- Descarga ----------
    // puntos: [[lat, lon], ...]. onProgreso(hechas, total) opcional.
    // Devuelve { total, descargadas, fallidas, bytes, caduca }.
    function descargar(puntos, nombre, onProgreso) {
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().catch(function () {});
        }
        var claves = clavesCorredor(puntos);
        var todas = claves.mapa.concat(claves.terreno);
        var ahora = Date.now();
        var hechas = 0, fallidas = 0, bytes = 0;
        var CONCURRENCIA = 6;
        var indice = 0;

        function siguiente() {
            if (indice >= todas.length) return Promise.resolve();
            var t = todas[indice++];
            return obtener(t.clave).then(function (existente) {
                if (existente) return; // ya cacheada y fresca
                return fetch(urlDeTesela(t)).then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.blob();
                }).then(function (blob) {
                    bytes += blob.size;
                    return enTransaccion('teselas', 'readwrite', function (s) {
                        s.put({ b: blob, ts: ahora }, t.clave);
                    });
                });
            }).catch(function () {
                fallidas++;
            }).then(function () {
                hechas++;
                if (onProgreso) onProgreso(hechas, todas.length);
                return siguiente();
            });
        }

        return esperarUsuario().then(function () {
            var hilos = [];
            for (var h = 0; h < CONCURRENCIA; h++) hilos.push(siguiente());
            return Promise.all(hilos);
        }).then(function () {
            var idDescarga = (typeof idUnico !== 'undefined' && idUnico) ? String(idUnico) : String(ahora);
            var registro = {
                nombre: nombre || '',
                ts: ahora,
                caduca: ahora + CADUCIDAD_MS,
                claves: todas.map(function (t) { return t.clave; }),
                bytes: bytes,
                zooms: [ZOOM_MIN, ZOOM_MAX],
            };
            return enTransaccion('descargas', 'readwrite', function (s) {
                s.put(registro, idDescarga);
            }).then(function () {
                return { total: todas.length, descargadas: hechas - fallidas, fallidas: fallidas, bytes: bytes, caduca: registro.caduca };
            });
        });
    }

    function estimar(puntos) {
        var claves = clavesCorredor(puntos);
        var n = claves.mapa.length + claves.terreno.length;
        return { teselas: n, bytesAprox: n * BYTES_POR_TESELA };
    }

    // ---------- Mantenimiento ----------
    function purgarCaducadas() {
        var limite = Date.now() - CADUCIDAD_MS;
        return abrirDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(['teselas', 'descargas'], 'readwrite');
                tx.objectStore('teselas').openCursor().onsuccess = function (e) {
                    var c = e.target.result;
                    if (!c) return;
                    if (c.value.ts < limite) c.delete();
                    c.continue();
                };
                tx.objectStore('descargas').openCursor().onsuccess = function (e) {
                    var c = e.target.result;
                    if (!c) return;
                    if (c.value.ts < limite) c.delete();
                    c.continue();
                };
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { resolve(); };
            });
        }).catch(function () {});
    }

    function borrarTodo() {
        return enTransaccion('teselas', 'readwrite', function (s) { s.clear(); }).then(function () {
            return enTransaccion('descargas', 'readwrite', function (s) { s.clear(); });
        });
    }

    // Resumen del uso actual: { teselas, bytes, caduca } (caduca = la más próxima).
    function uso() {
        return abrirDB().then(function (db) {
            return new Promise(function (resolve) {
                var teselas = 0, bytes = 0, tsMin = null;
                var tx = db.transaction('teselas', 'readonly');
                tx.objectStore('teselas').openCursor().onsuccess = function (e) {
                    var c = e.target.result;
                    if (!c) return;
                    teselas++;
                    bytes += (c.value.b && c.value.b.size) || 0;
                    if (tsMin === null || c.value.ts < tsMin) tsMin = c.value.ts;
                    c.continue();
                };
                tx.oncomplete = function () {
                    resolve({ teselas: teselas, bytes: bytes, caduca: tsMin === null ? null : tsMin + CADUCIDAD_MS });
                };
                tx.onerror = function () { resolve({ teselas: 0, bytes: 0, caduca: null }); };
            });
        }).catch(function () { return { teselas: 0, bytes: 0, caduca: null }; });
    }

    // ---------- Capa Leaflet cache-first ----------
    // Igual que L.tileLayer del estilo outdoors, pero cada tesela se busca
    // primero en IndexedDB; si no está (o caducó) se pide a la red (online),
    // esperando antes a conocer el id de usuario que exige el proxy.
    function crearCapa(opciones) {
        var Capa = L.TileLayer.extend({
            createTile: function (coords, done) {
                var self = this;
                var tile = document.createElement('img');
                L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
                L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));
                tile.alt = '';
                tile.setAttribute('role', 'presentation');
                var key = this._tileCoordsToKey(coords);
                var clave = ESTILO + '/' + coords.z + '/' + coords.x + '/' + coords.y;
                // Si Leaflet ya descartó esta tesela (cambio de zoom/pan mientras
                // esperábamos), no gastar red ni cuota del proxy.
                function vigente() { var t = self._tiles[key]; return !!(t && t.el === tile); }
                function deRed() {
                    return esperarUsuario().then(function () {
                        if (vigente()) tile.src = self.getTileUrl(coords);
                    });
                }
                obtener(clave).then(function (blob) {
                    if (!vigente()) return;
                    if (blob) {
                        tile._urlBlob = URL.createObjectURL(blob);
                        tile.src = tile._urlBlob;
                        return;
                    }
                    return deRed();
                }).catch(function () { return deRed(); }).catch(function () {});
                return tile;
            },
        });
        // {usuario} de la plantilla se resuelve en cada getTileUrl (L.Util.template
        // admite funciones), así la URL lleva el id aunque llegue tarde.
        var capa = new Capa(URL_ESTILO, L.extend({ usuario: function () { return usuarioActual || leerUsuarioGlobal() || 0; } }, opciones));
        // Liberar los objectURL de las teselas que salen de pantalla.
        capa.on('tileunload', function (e) {
            if (e.tile && e.tile._urlBlob) {
                URL.revokeObjectURL(e.tile._urlBlob);
                e.tile._urlBlob = null;
            }
        });
        return capa;
    }

    // Purga automática (no bloquea la carga de la página).
    try { purgarCaducadas(); } catch (e) {}

    return {
        ZOOM_MIN: ZOOM_MIN,
        ZOOM_MAX: ZOOM_MAX,
        estimar: estimar,
        descargar: descargar,
        obtener: obtener,
        urlTerreno: urlTerreno,
        crearCapa: crearCapa,
        setUsuario: setUsuario,
        uso: uso,
        borrarTodo: borrarTodo,
        purgarCaducadas: purgarCaducadas,
    };
})();

