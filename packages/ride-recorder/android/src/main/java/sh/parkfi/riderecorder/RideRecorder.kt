package sh.parkfi.riderecorder

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Foreground IMU + barometer capture with a passive-detection state machine.
 * Android mirror of the iOS `RideRecorder`.
 *
 * Combines `TYPE_LINEAR_ACCELERATION` + `TYPE_GRAVITY` (→ specific force),
 * `TYPE_GYROSCOPE`, and `TYPE_PRESSURE` (→ relative altitude). Monitoring runs
 * at ~UI rate watching a rolling variance; a ride-start trigger escalates to
 * GAME rate and starts using the barometer. Battery is bounded by the JS layer
 * arming this only while in-park.
 */
class RideRecorder(context: Context) : SensorEventListener {
    var onRideStarted: (() -> Unit)? = null
    var onRideDetected: ((RideResult) -> Unit)? = null

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val linear = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
    private val gravity = sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY)
    private val gyro = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val pressure = sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE)

    private var thread: HandlerThread? = null
    private var handler: Handler? = null

    private var monitoring = false
    private var recording = false
    private var manual = false

    private val baroAvailable = pressure != null
    private val gyroAvailable = gyro != null

    // latest raw values, combined into a sample on each linear-accel event
    private val gravVec = DoubleArray(3) { if (it == 2) -9.81 else 0.0 }
    private val linVec = DoubleArray(3)
    private var gyroDegS = 0.0
    private var basePressure: Double? = null
    private var relAltitude: Double? = null

    private val varWindow = ArrayList<DoublePair>()
    private var highVarSince: Double? = null
    private var lowVarSince: Double? = null

    private val ring = ArrayList<RawSample>()
    private var capture = ArrayList<RawSample>()
    private var recordStart = 0.0

    private data class DoublePair(val t: Double, val v: Double)

    fun permissionState(): String = "granted" // Android motion sensors need no runtime grant

    fun startMonitoring() {
        if (monitoring || linear == null) return
        monitoring = true
        thread = HandlerThread("ride-recorder").also { it.start() }
        handler = Handler(thread!!.looper)
        registerSensors(SensorManager.SENSOR_DELAY_UI)
    }

    fun stopMonitoring() {
        monitoring = false
        recording = false
        manual = false
        sensorManager.unregisterListener(this)
        thread?.quitSafely()
        thread = null
        handler = null
        ring.clear()
        capture.clear()
        varWindow.clear()
        highVarSince = null
        lowVarSince = null
        basePressure = null
    }

    fun startRecording() {
        if (!monitoring || recording) return
        manual = true
        beginRecording()
    }

    fun stopRecording(): RideResult? {
        if (!recording) return null
        return finishRecording()
    }

    private fun registerSensors(delay: Int) {
        sensorManager.unregisterListener(this)
        linear?.let { sensorManager.registerListener(this, it, delay, handler) }
        gravity?.let { sensorManager.registerListener(this, it, delay, handler) }
        gyro?.let { sensorManager.registerListener(this, it, delay, handler) }
        // pressure is inherently slow; SENSOR_DELAY_NORMAL is plenty
        pressure?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL, handler) }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_GRAVITY -> {
                gravVec[0] = event.values[0].toDouble()
                gravVec[1] = event.values[1].toDouble()
                gravVec[2] = event.values[2].toDouble()
            }
            Sensor.TYPE_GYROSCOPE -> {
                val x = event.values[0].toDouble()
                val y = event.values[1].toDouble()
                val z = event.values[2].toDouble()
                gyroDegS = sqrt(x * x + y * y + z * z) * 180 / Math.PI
            }
            Sensor.TYPE_PRESSURE -> {
                val hpa = event.values[0].toDouble()
                val altM = SensorManager.getAltitude(
                    SensorManager.PRESSURE_STANDARD_ATMOSPHERE, hpa.toFloat()
                ).toDouble()
                if (basePressure == null) basePressure = altM
                relAltitude = altM - basePressure!!  // relative only — absolute is weather-biased
            }
            Sensor.TYPE_LINEAR_ACCELERATION -> {
                linVec[0] = event.values[0].toDouble()
                linVec[1] = event.values[1].toDouble()
                linVec[2] = event.values[2].toDouble()
                emitSample(event.timestamp / 1_000_000_000.0)  // ns → s
            }
        }
    }

    private fun emitSample(t: Double) {
        // specific force = linear acceleration + gravity (device frame), m/s²
        val sfx = linVec[0] + gravVec[0]
        val sfy = linVec[1] + gravVec[1]
        val sfz = linVec[2] + gravVec[2]
        val sfMs2 = sqrt(sfx * sfx + sfy * sfy + sfz * sfz)

        val gnorm = max(1e-6, sqrt(gravVec[0] * gravVec[0] + gravVec[1] * gravVec[1] + gravVec[2] * gravVec[2]))
        val sample = RawSample(
            t = t,
            sfMs2 = sfMs2,
            gx = gravVec[0] / gnorm,
            gy = gravVec[1] / gnorm,
            gz = gravVec[2] / gnorm,
            gyroDegS = gyroDegS,
            altRel = if (baroAvailable) relAltitude else null,
        )

        if (recording) {
            capture.add(sample)
            evaluateEnd(sample, t)
        } else {
            pushRing(sample, t)
            evaluateStart(sfMs2, t)
        }
    }

    private fun pushRing(s: RawSample, now: Double) {
        ring.add(s)
        while (ring.isNotEmpty() && now - ring.first().t > RideConst.RING_BUFFER_S) {
            ring.removeAt(0)
        }
    }

    private fun evaluateStart(sfMs2: Double, now: Double) {
        varWindow.add(DoublePair(now, sfMs2))
        while (varWindow.isNotEmpty() && now - varWindow.first().t > RideConst.VAR_WINDOW_S) {
            varWindow.removeAt(0)
        }
        if (varWindow.size <= 3) return
        val mean = varWindow.sumOf { it.v } / varWindow.size
        val variance = varWindow.sumOf { (it.v - mean) * (it.v - mean) } / varWindow.size
        if (variance > RideConst.START_VAR_THRESHOLD) {
            if (highVarSince == null) highVarSince = now
            else if (now - highVarSince!! >= RideConst.START_SUSTAIN_S) beginRecording()
        } else highVarSince = null
    }

    private fun evaluateEnd(s: RawSample, now: Double) {
        if (now - recordStart >= RideConst.MAX_DURATION_S) {
            finishRecording()
            return
        }
        if (manual) return
        val recent = capture.filter { now - it.t <= RideConst.VAR_WINDOW_S }
        if (recent.size <= 3) return
        val mean = recent.sumOf { it.sfMs2 } / recent.size
        val variance = recent.sumOf { (it.sfMs2 - mean) * (it.sfMs2 - mean) } / recent.size
        if (variance < RideConst.END_VAR_THRESHOLD) {
            if (lowVarSince == null) lowVarSince = now
            else if (now - lowVarSince!! >= RideConst.END_SUSTAIN_S) finishRecording()
        } else lowVarSince = null
    }

    private fun beginRecording() {
        if (recording) return
        recording = true
        highVarSince = null
        lowVarSince = null
        capture = ArrayList(ring)
        recordStart = capture.firstOrNull()?.t ?: ring.lastOrNull()?.t ?: 0.0
        registerSensors(SensorManager.SENSOR_DELAY_GAME) // escalate to ~50 Hz
        onRideStarted?.invoke()
    }

    private fun finishRecording(): RideResult? {
        if (!recording) return null
        recording = false
        val wasManual = manual
        manual = false
        val samples = capture
        capture = ArrayList()
        if (monitoring) registerSensors(SensorManager.SENSOR_DELAY_UI)

        val result = RideMetricsComputer.compute(samples, baroAvailable, gyroAvailable)
        if (result != null && !wasManual) onRideDetected?.invoke(result)
        return result
    }
}
