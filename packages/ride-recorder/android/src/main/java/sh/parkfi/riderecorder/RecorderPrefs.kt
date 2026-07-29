package sh.parkfi.riderecorder

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * SharedPreferences shared between [RideRecorderPlugin] (which registers the
 * geofences) and [ParkGeofenceReceiver] (which may fire in a freshly-restarted
 * process) — the notification-etiquette state (W3) must survive process death,
 * which static fields don't.
 */
object RecorderPrefs {
    private const val NAME = "sh.parkfi.riderecorder.prefs"

    /** Device-local day ("yyyy-MM-dd") the park-entry notification last posted. */
    const val KEY_ENTRY_NOTIFIED_DAY = "lastEntryNotifiedDay"

    /** Wall-clock ms when the geofence set was last (re-)registered — ENTERs
     *  within a short window of this are the INITIAL_TRIGGER_ENTER synthetic. */
    const val KEY_REGISTERED_AT = "geofencesRegisteredAt"

    /** Canonical string of the currently registered fence set (skip-unchanged). */
    const val KEY_GEOFENCE_SET = "geofenceSet"

    /** Boot count at registration time: Play Services drops geofences on
     *  reboot, so an unchanged set still re-registers after one. */
    const val KEY_GEOFENCE_BOOT_COUNT = "geofenceBootCount"

    fun get(context: Context): SharedPreferences =
        context.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    /** Device-local calendar day. Park-local would need timezone plumbing for
     *  no real gain — the dedupe just needs "roughly once a day". */
    fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    /** System boot count, or -1 when unavailable (API < 24 / missing setting) —
     *  callers must treat -1 as "always re-register". */
    fun bootCount(context: Context): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return -1
        return try {
            Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
        } catch (_: Exception) {
            -1
        }
    }
}
