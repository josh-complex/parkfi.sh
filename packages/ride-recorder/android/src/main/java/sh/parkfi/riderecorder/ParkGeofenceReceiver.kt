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
            maybePostParkEntryNotification(context)
        } else {
            context.stopService(Intent(context, RideMonitorService::class.java))
        }
    }

    /**
     * Notification etiquette (W3). The arming and the JS forward above are
     * unconditional — only the *notification* is gated:
     *  1. never while the app is foreground (the in-app UI covers it; a
     *     geofence-restarted process defaults `appActive` to false);
     *  2. never within [INITIAL_TRIGGER_SUPPRESS_MS] of registration — that's
     *     `INITIAL_TRIGGER_ENTER`'s synthetic firing on every cold start
     *     inside a park, the source of the field-test spam;
     *  3. at most once per device-local day.
     */
    private fun maybePostParkEntryNotification(context: Context) {
        if (RideMonitorService.appActive) return
        val prefs = RecorderPrefs.get(context)
        val registeredAt = prefs.getLong(RecorderPrefs.KEY_REGISTERED_AT, 0L)
        if (registeredAt > 0 &&
            System.currentTimeMillis() - registeredAt < INITIAL_TRIGGER_SUPPRESS_MS
        ) {
            return
        }
        val today = RecorderPrefs.today()
        if (prefs.getString(RecorderPrefs.KEY_ENTRY_NOTIFIED_DAY, null) == today) return
        prefs.edit().putString(RecorderPrefs.KEY_ENTRY_NOTIFIED_DAY, today).apply()
        postParkEntryNotification(context)
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

        // ENTERs this soon after registration are INITIAL_TRIGGER_ENTER
        // synthetics, not a walk through the gate.
        const val INITIAL_TRIGGER_SUPPRESS_MS = 30_000L
    }
}
