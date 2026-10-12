function mapa_nuevo() {
// 1.) BASEMAPS
var thunder_pioneer = L.tileLayer('https://itinere.pro/'+id+'/mapbox/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token=', { maxZoom:20, noWrap:true, id: 'mapbox/satellite-streets-v12', attribution:'Mapbox' });
var capa_basic = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:20, noWrap:true, attribution:'OpenStreetMap' });

// 2.) OVERLAYMAPS
var capa_curvas = L.tileLayer.wms('https://servicios.idee.es/wms-inspire/mdt?', {
    layers: 'EL.ContourLine',
    format: 'image/png',
    transparent: true, // Activa el fondo transparente
    attribution: 'ign.es'
});
 
// LAYERMENU
var baseMaps = {
    "Sat+Urb": thunder_pioneer,
    "Basic": capa_basic
};


         mymap = L.map('mimapa', {
              center: [0, 0],
              zoom: 2,
              layers: [thunder_pioneer, capa_curvas],
              preferCanvas: true
        });

var overlayMaps = {
    "Topo": capa_curvas
};
var ctr_blend = L.control({position:'topleft'});
ctr_blend.onAdd = function (mymap) {
    valBlend = 1.0;
    this.div = L.DomUtil.create('div');
    this.div.style.position='fixed';
    this.div.style.display='flex';
    this.div.style.alignItems='center';
    this.div.style.top='60px';
    this.div.style.left='50px';
    this.div.style.borderRadius='5px';
    this.div.style.padding='5px';
    this.div.id='divmap1';
    this.div.style.background='rgba(255,255,255,.8)';
    this.div.innerHTML = '<span id="id_valBlend" style="color:#000;font-size:14px;">Basic</span><input type="range" id="id_sliderBlend" min="0" max="1" step="0.1" value="1" style="width:100px;accent-color:#888;" oninput="fct_blend()"><span id="id_valBlend2" style="color:#000;font-size:14px;">Sat+Urb</span>';
    L.DomEvent.disableClickPropagation(this.div);
    return this.div;
}
ctr_blend.addTo(mymap);
var ctr_line = L.control({position:'bottomleft'});
ctr_line.onAdd = function (mymap) {
    //var valLine = 'Distancia";
    this.div = L.DomUtil.create('div');
    this.div.style.position='fixed';
    this.div.style.display='flex';
    this.div.style.alignItems='center';
    this.div.style.bottom='300px';
    this.div.style.left='0px';
    this.div.id='divmap2';
    this.div.style.border='5px solid transparent';
    this.div.style.borderRadius='5px 5px 0px 0px';
    this.div.style.background='rgba(255,255,255,.5)';
    this.div.style.borderImage='linear-gradient(90deg, #DBC207, #F06700) 1';
    this.div.style.borderImageWidth='0 0 5px 0';
    this.div.innerHTML = '<select onchange="cambioLinea()" name="linea" id="linea" style="border:none;background:rgba(255,255,255,.7);border-radius:5px 5px 0px 0px;color:#000;font-size:14px;"><option value="distancia">Distancia</option><option value="altura">Altura</option><option value="velocidad">Velocidad</option></select>';
    L.DomEvent.disableClickPropagation(this.div);
    return this.div;
}
ctr_line.addTo(mymap);
var ctr_graph = L.control({position:'bottomright'});
ctr_graph.onAdd = function (mymap) {
    this.div = L.DomUtil.create('div');
    this.div.style.position='fixed';
    this.div.style.display='flex';
    this.div.style.alignItems='center';
    this.div.style.bottom='300px';
    this.div.style.right='0px';
    this.div.id='divmap3';
    this.div.style.borderRight='5px solid transparent';
    this.div.style.borderTop='5px solid transparent';
    this.div.style.borderLeft='5px solid orange';
    this.div.style.borderBottom='5px solid orange';
    this.div.style.borderRadius='5px 5px 0px 0px';
    this.div.style.background='rgba(255,255,255,.5)';
    this.div.innerHTML = '<select onchange="cambioGraph()" name="graph" id="graph" style="border:none;background:rgba(255,255,255,.7);border-radius:5px 5px 0px 0px;color:#000;font-size:14px;"><option value="altura">Altura</option><option value="velocidad">Velocidad</option><option value="altvel">Alt.+Vel.</option></select>';
    L.DomEvent.disableClickPropagation(this.div);
    return this.div;
}
ctr_graph.addTo(mymap);

var ctr_punto = L.control({position:'topleft'});
ctr_punto.onAdd = function (mymap) {
this.div = L.DomUtil.create('div');
    this.div.style.position='fixed';
    this.div.style.display='flex';
    this.div.style.alignItems='center';
    this.div.style.width='50px';
    this.div.style.height='50px';
    this.div.style.top='calc(50% - 105px)';
    this.div.style.left='calc(50% - 25px)';
    this.div.id='puntoMira';
    this.div.style.background='transparent';
    this.div.innerHTML = '<img src="https://itinere.pro/puntoMira.png" style="height:50px;" />';
    L.DomEvent.disableClickPropagation(this.div);
    return this.div;
}
ctr_punto.addTo(mymap);

var ctr_amplia = L.control({position:'topright'});
ctr_amplia.onAdd = function (mymap) {
this.div = L.DomUtil.create('div');
    this.div.style.position='fixed';
    this.div.style.display='flex';
    this.div.style.alignItems='center';
    this.div.style.width='30px';
    this.div.style.height='30px';
    this.div.style.top='63px';
    this.div.style.right='60px';
    this.div.id='amplia';
    this.div.style.background='rgba(255,255,255,.5)';
    this.div.innerHTML = '<img id="imgamplia" src="https://itinere.pro/maxi.png" onclick="ventana()" style="height:30px;" />';
    L.DomEvent.disableClickPropagation(this.div);
    return this.div;
}
ctr_amplia.addTo(mymap);

ctr_mapLayers = L.control.layers(baseMaps, overlayMaps).addTo(mymap);
bgMap = capa_basic;
mymap.addLayer(bgMap);            // add initial backgroundmap-layer to map
bgMap.bringToBack();
fgMap = thunder_pioneer;

mymap.on('baselayerchange', fct_layerchange);       
mymap.on('overlayremove', function(e) {
  console.log(Object.entries(bgMap).options.id);
});
mymap.on('overlayadd', function(e) {
       //document.getElementById("id_valBlend").innerHTML = document.getElementById("id_valBlend2").innerHTML;
       mymap.addLayer(bgMap);      
});

}