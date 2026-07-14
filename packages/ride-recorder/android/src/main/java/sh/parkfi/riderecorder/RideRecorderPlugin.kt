package sh.parkfi.riderecorder

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor bridge for the on-device ride recorder. Owns a single
 * [RideRecorder] and forwards its `rideStarted` / `rideDetected` events to JS.
 */
@CapacitorPlugin(name = "RideRecorder")
class RideRecorderPlugin : Plugin() {
    private var recorder: RideRecorder? = null

    private fun engine(): RideRecorder {
        val existing = recorder
        if (existing != null) return existing
        val r = RideRecorder(context)
        r.onRideStarted = { notifyListeners("rideStarted", JSObject()) }
        r.onRideDetected = { result -> notifyListeners("rideDetected", resultToJs(result)) }
        recorder = r
        return r
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
        engine().startMonitoring()
        call.resolve()
    }

    @PluginMethod
    fun stopMonitoring(call: PluginCall) {
        recorder?.stopMonitoring()
        call.resolve()
    }

    @PluginMethod
    fun startRecording(call: PluginCall) {
        engine().startRecording()
        call.resolve()
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        val result = recorder?.stopRecording()
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
