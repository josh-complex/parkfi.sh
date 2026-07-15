package sh.parkfi.riderecorder

import android.content.Intent
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

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
@CapacitorPlugin(name = "RideRecorder")
class RideRecorderPlugin : Plugin() {

    override fun load() {
        // Wire the service's static callbacks to this plugin's JS bridge. Set
        // once; the service reads them on the sensor thread at event time.
        RideMonitorService.rideStartedCb = { notifyListeners("rideStarted", JSObject()) }
        RideMonitorService.rideDetectedCb = { result ->
            notifyListeners("rideDetected", resultToJs(result), /* retainUntilConsumed = */ true)
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

    // Motion sensors need no runtime grant on Android; override the base
    // permission methods to report "granted" in the shape the JS layer expects.
    override fun requestPermissions(call: PluginCall) {
        call.resolve(JSObject().put("motion", "granted"))
    }

    override fun checkPermissions(call: PluginCall) {
        call.resolve(JSObject().put("motion", "granted"))
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
}
