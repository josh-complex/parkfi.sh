package sh.parkfi.riderecorder

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * Capacitor bridge for the on-device ride recorder. Monitoring runs inside
 * [RideMonitorService] (a foreground service) so capture survives screen-off /
 * backgrounding (W8); this plugin starts/stops that service and relays its
 * `rideStarted` / `rideDetected` events to JS.
 *
 * `rideDetected` is forwarded with `retainUntilConsumed = true` so a ride
 * detected while the WebView is suspended is still delivered to JS on resume
 * (paired with the service's local recap notification, W11).
 */
@CapacitorPlugin(
    name = "RideRecorder",
    permissions = [
        // Step counting only (F-steps): TYPE_STEP_COUNTER needs
        // ACTIVITY_RECOGNITION on API 29+. IMU/baro capture needs no grant, so a
        // denial degrades to steps-less monitoring — never block arming on this.
        Permission(alias = "motion", strings = [Manifest.permission.ACTIVITY_RECOGNITION]),
        // Background park geofencing needs the separate "allow all the time"
        // grant on API 29+ (foreground fine-location is already held via the
        // WebView geolocation prompt). On API 30+ the OS routes this to a
        // settings screen rather than an inline dialog.
        Permission(
            alias = "bgLocation",
            strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION]
        )
    ]
)
class RideRecorderPlugin : Plugin() {

    private val geofencingClient: GeofencingClient by lazy {
        LocationServices.getGeofencingClient(context)
    }

    override fun load() {
        // Wire the service's static callbacks to this plugin's JS bridge. Set
        // once; the service reads them on the sensor thread at event time.
        RideMonitorService.rideStartedCb = { notifyListeners("rideStarted", JSObject()) }
        RideMonitorService.rideDetectedCb = { result ->
            notifyListeners("rideDetected", resultToJs(result), /* retainUntilConsumed = */ true)
        }
        // Region transitions (fired by ParkGeofenceReceiver, possibly after a
        // process restart) forward to JS retained so a suspended WebView still
        // gets them on resume.
        parkTransitionCb = { regionId, transition ->
            notifyListeners(
                "parkTransition",
                JSObject().put("regionId", regionId).put("transition", transition),
                /* retainUntilConsumed = */ true
            )
        }
    }

    // Capacitor lifecycle → tells the service whether the app is foreground, so
    // it only posts the local recap notification when the in-app toast can't.
    override fun handleOnResume() {
        RideMonitorService.appActive = true
    }

    override fun handleOnPause() {
        RideMonitorService.appActive = false
    }

    // IMU/baro sensors need no runtime grant; "motion" here maps to
    // ACTIVITY_RECOGNITION, which gates only the step counter (API 29+; earlier
    // releases have no such runtime permission and report granted).
    override fun requestPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            getPermissionState("motion") == PermissionState.GRANTED
        ) {
            call.resolve(JSObject().put("motion", "granted"))
        } else {
            requestPermissionForAlias("motion", call, "motionPermissionCallback")
        }
    }

    @PermissionCallback
    fun motionPermissionCallback(call: PluginCall) {
        call.resolve(JSObject().put("motion", motionState()))
    }

    override fun checkPermissions(call: PluginCall) {
        call.resolve(JSObject().put("motion", motionState()))
    }

    private fun motionState(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "granted"
        return when (getPermissionState("motion")) {
            PermissionState.GRANTED -> "granted"
            PermissionState.DENIED -> "denied"
            else -> "prompt"
        }
    }

    @PluginMethod
    fun startMonitoring(call: PluginCall) {
        val intent = Intent(context, RideMonitorService::class.java)
        ContextCompat.startForegroundService(context, intent)
        call.resolve()
    }

    @PluginMethod
    fun stopMonitoring(call: PluginCall) {
        context.stopService(Intent(context, RideMonitorService::class.java))
        call.resolve()
    }

    @PluginMethod
    fun startRecording(call: PluginCall) {
        RideMonitorService.instance?.startRecording()
        call.resolve()
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        val result = RideMonitorService.instance?.stopRecording()
        if (result != null) call.resolve(resultToJs(result)) else call.resolve()
    }

    @PluginMethod
    fun getStepSample(call: PluginCall) {
        val sample = RideMonitorService.instance?.stepSample()
        call.resolve(
            JSObject()
                .put("steps", sample?.steps ?: org.json.JSONObject.NULL)
                .put("sessionStartMs", sample?.sessionStartMs ?: org.json.JSONObject.NULL)
        )
    }

    // Historical step queries are iOS-only (CMPedometer's 7-day buffer); Android
    // has no system store without Health Connect, so reconciliation no-ops here.
    @PluginMethod
    fun queryStepSpan(call: PluginCall) {
        call.resolve(JSObject().put("steps", org.json.JSONObject.NULL))
    }

    // --- Background park geofencing ------------------------------------------

    @PluginMethod
    fun requestBackgroundLocation(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            getPermissionState("bgLocation") == PermissionState.GRANTED
        ) {
            call.resolve(JSObject().put("location", "granted"))
        } else {
            requestPermissionForAlias("bgLocation", call, "bgLocationCallback")
        }
    }

    @PermissionCallback
    fun bgLocationCallback(call: PluginCall) {
        val state = when (getPermissionState("bgLocation")) {
            PermissionState.GRANTED -> "granted"
            PermissionState.DENIED -> "denied"
            else -> "prompt"
        }
        call.resolve(JSObject().put("location", state))
    }

    @PluginMethod
    fun setParkGeofences(call: PluginCall) {
        val regions = call.getArray("regions", JSArray()) ?: JSArray()
        val fences = ArrayList<Geofence>()
        val canonicalParts = ArrayList<String>()
        for (i in 0 until regions.length()) {
            val obj = regions.getJSONObject(i)
            val id = obj.optString("id", "")
            if (id.isEmpty()) continue
            val lat = obj.optDouble("lat")
            val lng = obj.optDouble("lng")
            val radiusM = obj.optDouble("radiusM")
            canonicalParts.add("$id:$lat:$lng:$radiusM")
            fences.add(
                Geofence.Builder()
                    .setRequestId(id)
                    .setCircularRegion(lat, lng, radiusM.toFloat())
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .setTransitionTypes(
                        Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT
                    )
                    .build()
            )
        }
        if (fences.isEmpty()) {
            call.resolve()
            return
        }
        // Skip-unchanged (W3): every cold start re-registered the same set,
        // and INITIAL_TRIGGER_ENTER fired a synthetic ENTER each app open
        // inside a park. If the fence set is byte-identical AND the device
        // hasn't rebooted since (Play Services drops geofences on reboot,
        // so an unchanged set must still re-register then), leave the live
        // registration alone. bootCount -1 (unreadable) always re-registers.
        val canonical = canonicalParts.sorted().joinToString(";")
        val prefs = RecorderPrefs.get(context)
        val bootCount = RecorderPrefs.bootCount(context)
        if (canonical == prefs.getString(RecorderPrefs.KEY_GEOFENCE_SET, null) &&
            bootCount != -1 &&
            bootCount == prefs.getInt(RecorderPrefs.KEY_GEOFENCE_BOOT_COUNT, -2)
        ) {
            call.resolve()
            return
        }
        val request = GeofencingRequest.Builder()
            // Fire immediately if we're *already* inside a park when registering.
            // The receiver suppresses the *notification* for ENTERs within 30 s
            // of KEY_REGISTERED_AT (the synthetic), but still arms + forwards.
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofences(fences)
            .build()
        try {
            // Replace the set: drop everything, then add the new fences.
            geofencingClient.removeGeofences(geofencePendingIntent)
            geofencingClient.addGeofences(request, geofencePendingIntent)
                .addOnSuccessListener {
                    prefs.edit()
                        .putString(RecorderPrefs.KEY_GEOFENCE_SET, canonical)
                        .putInt(RecorderPrefs.KEY_GEOFENCE_BOOT_COUNT, bootCount)
                        .putLong(RecorderPrefs.KEY_REGISTERED_AT, System.currentTimeMillis())
                        .apply()
                    call.resolve()
                }
                .addOnFailureListener { e -> call.reject("geofence add failed", e) }
        } catch (e: SecurityException) {
            // Background-location grant missing — geofences only run while in use.
            call.reject("background location not granted", e)
        }
    }

    @PluginMethod
    fun clearParkGeofences(call: PluginCall) {
        // Drop the stored set too, so the skip-unchanged check in
        // setParkGeofences can't mistake a cleared registration for a live one.
        RecorderPrefs.get(context).edit()
            .remove(RecorderPrefs.KEY_GEOFENCE_SET)
            .remove(RecorderPrefs.KEY_GEOFENCE_BOOT_COUNT)
            .apply()
        geofencingClient.removeGeofences(geofencePendingIntent)
            .addOnCompleteListener { call.resolve() }
    }

    private val geofencePendingIntent: PendingIntent by lazy {
        val intent = Intent(context, ParkGeofenceReceiver::class.java)
        // MUTABLE: Play Services fills the geofence transition extras into it.
        PendingIntent.getBroadcast(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
    }

    private fun resultToJs(result: RideResult): JSObject {
        // JSONObject.put(k, null) REMOVES the key; emit explicit JSON nulls so
        // no-baro metrics (estTopSpeedKmh, altRel) arrive as null, not missing.
        // (The server schema also tolerates missing keys — belt and suspenders.)
        val metrics = JSObject()
        for ((k, v) in result.metrics) metrics.put(k, v ?: org.json.JSONObject.NULL)
        val samples = JSArray()
        for (s in result.samples) {
            val obj = JSObject()
            for ((k, v) in s) obj.put(k, v ?: org.json.JSONObject.NULL)
            samples.put(obj)
        }
        return JSObject().put("metrics", metrics).put("samples", samples)
    }

    companion object {
        // Wired in load(); read by ParkGeofenceReceiver, which may fire in a
        // freshly-restarted process (so it's static, not an instance field).
        // @Volatile so the receiver thread sees the plugin's write.
        @Volatile
        var parkTransitionCb: ((String, String) -> Unit)? = null
    }
}
