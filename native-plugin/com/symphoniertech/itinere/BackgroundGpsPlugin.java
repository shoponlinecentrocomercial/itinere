package symphoniertech.itinere;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundGps")
public class BackgroundGpsPlugin extends Plugin {
    @PluginMethod
    public void startTracking(PluginCall call) {
        // Aquí va tu lógica nativa: iniciar servicio, guardar en SQLite...
        call.resolve();
    }
}
