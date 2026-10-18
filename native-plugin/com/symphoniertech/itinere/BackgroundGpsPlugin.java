package symphoniertech.itinere;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;

@CapacitorPlugin(name = "BackgroundGps")
public class BackgroundGpsPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), GpsTrackingService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        call.resolve(ret);
    }

    @PluginMethod
    public void getStoredPoints(PluginCall call) {
        JSArray points = new JSArray();
        File file = new File(getContext().getFilesDir(), "gps_points.jsonl");
        if (file.exists()) {
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    points.put(line);
                }
            } catch (Exception e) {
                call.reject("Error leyendo puntos: " + e.getMessage());
                return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("points", points);
        call.resolve(ret);
    }
}
