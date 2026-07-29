package sh.parkfi.riderecorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import java.util.Locale

/**
 * Foreground service that keeps IMU/barometer capture alive when the app is
 * backgrounded or the screen is locked (W8/F2). Capacitor freezes the WebView JS
 * in the background and cached-app freezing halts sensor delivery to an
 * in-process `HandlerThread`; a foreground service exempts the process so
 * sampling continues.
 *
 * Owns the single [RideRecorder]. On a detected ride it (1) posts a local recap
 * notification when the app isn't foreground (W11) and (2) forwards the event to
 * the plugin's JS listeners with retain-until-consumed semantics, so the submit
 * still fires when the WebView resumes.
 *
 * `foregroundServiceType` is **specialUse**: continuous accelerometer/barometer
 * sampling for novel ride detection fits none of the predefined types
 * (location / health / dataSync). specialUse requires a Play Console declaration
 * — see FOLLOWUP.md W8. If review pushes back, `health` + FOREGROUND_SERVICE_HEALTH
 * is the fallback (change here AND the manifest together).
 */
class RideMonitorService : Service() {

    private var recorder: RideRecorder? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val deadMan = Runnable { stopSelf() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        val r = RideRecorder(this)
        r.onRideStarted = { rideStartedCb?.invoke() }
        r.onRideDetected = { result ->
            // Local notification is the user-visible half when the WebView is
            // suspended; skip it when the app is foreground (the in-app recap
            // toast covers that case), and gate it on the ride signature (W3)
            // so walking traces stop notifying — the raw detector's variance
            // trigger fires on queue shuffling/phone handling. The JS forward
            // always happens (the debug ring and PostHog need suppressed
            // traces too).
            if (!appActive && RideSignature.hasSignature(result.metrics)) {
                postRecapNotification(result)
            }
            rideDetectedCb?.invoke(result)
        }
        recorder = r
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        recorder?.startMonitoring()
        // Dead-man switch: never outlive a park day if a disarm is missed
        // (park exit, logout, tracker unmount all normally stop the service).
        mainHandler.removeCallbacks(deadMan)
        mainHandler.postDelayed(deadMan, DEAD_MAN_MS)
        // Don't auto-restart: we only want to monitor while explicitly armed.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(deadMan)
        recorder?.stopMonitoring()
        recorder = null
        if (instance === this) instance = null
        super.onDestroy()
    }

    /** Manual "I'm boarding" affordance — delegates to the owned recorder. */
    fun startRecording() {
        recorder?.startRecording()
    }

    fun stopRecording(): RideResult? = recorder?.stopRecording()

    /** Session step sample passthrough for the plugin's getStepSample. */
    fun stepSample(): RideRecorder.StepSample? = recorder?.stepSample()

    private fun startForegroundCompat() {
        ensureChannels(this)
        val notif = ongoingNotification(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(ONGOING_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            @Suppress("DEPRECATION")
            startForeground(ONGOING_ID, notif)
        }
    }

    private fun ongoingNotification(ctx: Context): Notification =
        NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setContentTitle("ParkFi is watching for rides")
            .setContentText("Only while you're in the park.")
            .setSmallIcon(ctx.applicationInfo.icon) // TODO: swap for a monochrome status icon
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(launchIntent(ctx))
            .build()

    private fun postRecapNotification(result: RideResult) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notif = NotificationCompat.Builder(this, RECAP_CHANNEL_ID)
            .setContentTitle("🎢 Ride recorded")
            .setContentText(recapText(result.metrics))
            .setSmallIcon(applicationInfo.icon)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(launchIntent(this))
            .build()
        nm.notify(RECAP_ID, notif)
    }

    private fun launchIntent(ctx: Context): PendingIntent? {
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getActivity(ctx, 0, launch, flags)
    }

    companion object {
        const val CHANNEL_ID = "ride-monitor"
        const val RECAP_CHANNEL_ID = "ride-recap"
        const val ONGOING_ID = 4201
        const val RECAP_ID = 4202
        const val DEAD_MAN_MS = 12L * 60 * 60 * 1000

        // Wired by the plugin; read on the recorder's thread at event time.
        // @Volatile so the sensor thread sees the plugin's writes.
        @Volatile
        var rideStartedCb: (() -> Unit)? = null

        @Volatile
        var rideDetectedCb: ((RideResult) -> Unit)? = null

        // Toggled by the plugin's resume/pause lifecycle so the service knows
        // whether to post the local recap notification (skip when foreground).
        // Defaults to FALSE: a geofence-restarted process without a resumed
        // activity is not foreground — the old `true` default suppressed
        // recaps after process death, the exact case the notification exists
        // for (and let the entry notification skip its foreground check).
        @Volatile
        var appActive: Boolean = false

        // Live instance for the plugin's manual start/stop-recording delegation.
        @Volatile
        var instance: RideMonitorService? = null

        fun ensureChannels(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID, "Ride monitoring", NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "Shown while ParkFi watches for coaster rides in the park."
                    setShowBadge(false)
                }
            )
            nm.createNotificationChannel(
                NotificationChannel(
                    RECAP_CHANNEL_ID, "Ride recaps", NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "A summary when a coaster ride is detected."
                }
            )
        }

        /** Dumb recap line from the metrics map — mirrors `rideRecapSegments`
         *  (drops · inversions · g · airtime). Kept intentionally simple. */
        fun recapText(metrics: Map<String, Any?>): String {
            val parts = ArrayList<String>()
            (metrics["dropCount"] as? Number)?.toInt()?.let {
                if (it > 0) parts.add("$it ${if (it == 1) "drop" else "drops"}")
            }
            (metrics["inversions"] as? Number)?.toInt()?.let {
                if (it > 0) parts.add("$it ${if (it == 1) "inversion" else "inversions"}")
            }
            (metrics["maxG"] as? Number)?.toDouble()?.let {
                if (it >= 1) parts.add(String.format(Locale.US, "%.1f g", it))
            }
            (metrics["airtimeS"] as? Number)?.toDouble()?.let {
                if (it >= 1) parts.add("${Math.round(it)} s airtime")
            }
            return if (parts.isEmpty()) "Ride logged." else parts.joinToString(" · ")
        }
    }
}
