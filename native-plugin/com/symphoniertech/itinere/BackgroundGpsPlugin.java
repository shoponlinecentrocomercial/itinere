package symphoniertech.itinere;

import android.content.Intent;
import android.os.Build;
import android.util.Log;
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
        
        JSObject ret = new JSObject();
        ret.put("fileExists", file.exists());
        ret.put("filePath", file.getAbsolutePath());
        ret.put("fileSize", file.exists() ? file.length() : 0);
        
        if (file.exists()) {
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    points.put(line);
                }
            } catch (Exception e) {
                ret.put("error", e.getMessage());
            }
        }
        ret.put("points", points);
        call.resolve(ret);
    }

    // Método de diagnóstico: comprueba si el servicio está vivo y si el archivo crece
    @PluginMethod
    public void getDebugInfo(PluginCall call) {
        JSObject ret = new JSObject();
        File file = new File(getContext().getFilesDir(), "gps_points.jsonl");
        ret.put("fileExists", file.exists());
        ret.put("fileSize", file.exists() ? file.length() : 0);
        ret.put("lastModified", file.exists() ? file.lastModified() : 0);
        
        // Comprobar si el servicio está en ejecución consultando el estado de la app
        android.app.ActivityManager am = (android.app.ActivityManager) getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
        boolean serviceRunning = false;
        for (android.app.ActivityManager.RunningServiceInfo service : am.getRunningServices(Integer.MAX_VALUE)) {
            if (GpsTrackingService.class.getName().equals(service.service.getClassName())) {
                serviceRunning = true;
                break;
            }
        }
        ret.put("serviceRunning", serviceRunning);
        
        call.resolve(ret);
    }
}
