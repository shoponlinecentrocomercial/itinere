package symphoniertech.itinere;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;

@CapacitorPlugin(name = "BackgroundGps")
public class BackgroundGpsPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        // Aquí irá la lógica del servicio en primer plano
        JSObject ret = new JSObject();
        ret.put("status", "started");
        call.resolve(ret);
    }

    @PluginMethod
    public void getStoredPoints(PluginCall call) {
        // Aquí leeremos los puntos guardados en SQLite
        JSObject ret = new JSObject();
        ret.put("points", new com.getcapacitor.JSArray());
        call.resolve(ret);
    }
}
