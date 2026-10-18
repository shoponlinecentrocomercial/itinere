package symphoniertech.itinere;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class GpsTrackingService extends Service {
    private static final String CHANNEL_ID = "itinere_gps_channel";
    private static final int NOTIFICATION_ID = 1;
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private File pointsFile;
    private SimpleDateFormat dateFormat;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        pointsFile = new File(getFilesDir(), "gps_points.jsonl");
        dateFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, createNotification());
        startLocationUpdates();
        return START_STICKY;
    }

    private Notification createNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Itinere GPS", NotificationManager.IMPORTANCE_LOW);
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Itinere - Ruta activa")
            .setContentText("Grabando ruta en segundo plano…")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build();
    }

    private void startLocationUpdates() {
        LocationRequest request = new LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY, 5000)
            .setMinUpdateDistanceMeters(5)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                for (Location location : result.getLocations()) {
                    savePoint(location);
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(request, locationCallback, null);
        } catch (SecurityException e) {
            stopSelf();
        }
    }

    private void savePoint(Location location) {
        try (FileWriter writer = new FileWriter(pointsFile, true)) {
            String json = String.format(Locale.US,
                "{\"lat\":%.6f,\"lng\":%.6f,\"acc\":%.2f,\"alt\":%.2f,\"speed\":%.2f,\"ts\":%d}\n",
                location.getLatitude(), location.getLongitude(),
                location.getAccuracy(), location.getAltitude(),
                location.getSpeed(), location.getTime());
            writer.write(json);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onDestroy() {
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
