const idUnico = crypto.randomUUID();
const calcularDistanciaEnMetros = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Radio de la Tierra en metros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distancia en metros
};
var options = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0
};
var amplio=false;
var difSegundos = 1;
var maxiAsc=false;
var maxiDes=false;
var maxPendienteAsc = 0;
var maxPendienteDes = 0;
var ctr_mapLayers;
var privado=0;
var ultimoSegundo=0;
var peso=100;
var precis=10;
var alturaBase=0;
var imperial=false;
var laymap;
var vMedia=0;
var velmax=0;
var velmin=0;
var gasolina=34780000;
var gasolinagl=131656621.84752;
var gasoil=35860000;
var gasoilgl=135744866.57424;
var glp=24000000;
var glpgl=90849882.816;
var etanol=22500000;
var etanolgl=85171765.14;
var hidrogeno=4600000;
var hidrogenogl=17412894.2064;
var huella=0;
var varenergia = 0;
var varinercial = 0;
//var ptinercia=0;
var velocidadms = 0;
var ftvelocidad=0;
var mivelocidad=0;
var graba=false;
var pCompleta = false;
var alarmaGPS=true;
var compartido=false;
var latInicio;
var lonInicio;
var errores=0;
var altitud=0;
var latitud;
var longitud;
var desnivel=0;
var distancia=0;
var ultimaPosicion = [];
var grabando;
var crono;
var crd;
var mymap;
var marker = [];
var markerF = [];
var arrFotos = [];
var polyline;
var poly;
var poligono = [];
var coordenadas=[];
var degradado=[];
var contador=0;
var totalDistancia=0;
var alturaMin=0;
var alturaMax=0;
var multiplo=0;
var segundos=0;
var velocidad=0;
var ascenso=0;
var descenso=0;
var pendienteAsc=0;
var pendienteDes=0;
var numGradAsc=0;
var numGradDes=0;
var rotAsc=0;
var desnivelSup=0;
var desnivelInf=0;
var geoson = [];
var precision;
var malas = 1;
var dificultad='Ninguna';
var marcador = L.icon({
        iconUrl:base+'marcador.gif',
        iconSize: [58, 58]
});
var marcado = L.icon({
        iconUrl:base+'puntocam.png',
        iconSize: [35, 35]
});
var marcainicio = L.icon({
        iconUrl:base+'logo.png',
        iconSize: [35, 35]
});
var distanciami=0;
var velocidadmi=0;
var desnivelft=0;
var ascensoft=0;
var descensoft=0;
var velmaxmm=0;
var velminmm=0;
var velmaxkh=0;
var velminkh=0;
var ftAltMin=0;
var ftAltMax=0;
var ftDesSup=0;
var ftDesInf=0;
var fallos=0;
var paros=0;
var marcha=0;
var parada=false;
var fotosTomadas=0;
var mvelocidad=0;
var mvelmin=0;
var mvelmax=0;
var kmdistancia=0;
var kmascenso=0;
var kmdescenso=0;
var latcentroImagen;
var loncentroImagen;
var ctx;
var xviejo=0;
var yviejo=0;
var unidadNiv='m';
var fgMap;
var bgMap;

// --- SISTEMA DE ALMACENAMIENTO TEMPORAL (IndexedDB) ---
let dbTemp;
let requestIDB = indexedDB.open("ItinereTemporal", 1);

requestIDB.onupgradeneeded = function(e) {
    dbTemp = e.target.result;
    // Creamos el "cajón" donde guardaremos los bloques de puntos
    if (!dbTemp.objectStoreNames.contains("geosonChunks")) {
        dbTemp.createObjectStore("geosonChunks", { autoIncrement: true });
    }
};

requestIDB.onsuccess = function(e) {
    dbTemp = e.target.result;
    console.log("Base de datos temporal lista.");
    // Al cargar la web, comprobamos si la persona estaba a mitad de una ruta y recargó la página
    recuperarAvisoSiHayDatos();
};

function guardarChunkLocal(chunk) {
    if (!dbTemp) return;
    let tx = dbTemp.transaction("geosonChunks", "readwrite");
    // Guardamos una copia exacta del array actual
    tx.objectStore("geosonChunks").add([...chunk]); 
}

function recuperarAvisoSiHayDatos() {
    if (!dbTemp) return;
    let tx = dbTemp.transaction("geosonChunks", "readonly");
    let request = tx.objectStore("geosonChunks").getAll();
    request.onsuccess = function() {
        if (request.result.length > 0) {
            console.log("Se ha detectado una ruta sin guardar de una sesión anterior.");
            // Opcional: alert('Se ha recuperado una ruta en curso tras la recarga de la página');
        }
    };
}
// ------------------------------------------------------