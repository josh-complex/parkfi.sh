package sh.parkfi.riderecorder

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

/**
 * Receives Play Services geofence transitions — which fire even when the app is
 * killed — and turns a park entry/exit into three things:
 *  1. forwards the transition to the plugin's JS listeners (retained until the
 *     WebView resumes and consumes it);
 *  2. on entry, starts [RideMonitorService] so sensors run while pocketed;
 *  3. on a backgrounded entry, posts a "you're in the park" notification.
 *
 * Declared as a plain manifest receiver (not runtime-registered) so the OS can
 * deliver transitions even after the process has been killed.
 *
 * **Android 12+ caveat:** launching the specialUse foreground service from this
 * background broadcast can throw `ForegroundServiceStartNotAllowedException`.
 * We attempt it in a try/catch and always still forward the JS event + post the
 * notification, so a blocked service start degrades to "armed on next
 * foreground" rather than crashing. See tier3-discovery.md for the location-FGS
 * follow-up.
 */
class ParkGeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) return

        val transition = when (event.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "enter"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "exit"
            else -> return
        }
        val ids = event.triggeringGeofences?.map { it.requestId } ?: return

        for (id in ids) {
            RideRecorderPlugin.parkTransitionCb?.invoke(id, transition)
        }

        if (transition == "enter") {
            try {
                ContextCompat.startForegroundService(
                    context, Intent(context, RideMonitorService::class.java)
                )
            } catch (_: Exception) {
                // Backgrounded FGS-start blocked (Android 12+) — the JS event
                // still lands, so monitoring arms when the app next resumes.
            }
            postParkEntryNotification(context)
        } else {
            context.stopService(Intent(context, RideMonitorService::class.java))
        }
    }

    private fun postParkEntryNotification(context: Context) {
        RideMonitorService.ensureChannels(context)
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notif = NotificationCompat.Builder(context, RideMonitorService.RECAP_CHANNEL_ID)
            .setContentTitle("You're in the park 🎢")
            .setContentText("ParkFi is counting your day — miles, queues, and rides.")
            .setSmallIcon(context.applicationInfo.icon)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        nm.notify(PARK_ENTRY_ID, notif)
    }

    companion object {
        const val PARK_ENTRY_ID = 4203
    }
}
