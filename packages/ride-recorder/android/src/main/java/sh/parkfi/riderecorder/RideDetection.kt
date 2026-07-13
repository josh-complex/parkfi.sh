package sh.parkfi.riderecorder

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Tunable constants for the ride-detection state machine. Mirror of the iOS
 * `RideConst` — keep the two in lock-step.
 */
object RideConst {
    const val G = 9.81
    const val MONITOR_HZ = 10.0
    const val ACTIVE_HZ = 50.0
    const val VAR_WINDOW_S = 5.0
    const val START_VAR_THRESHOLD = 1.5
    const val START_SUSTAIN_S = 3.0
    const val END_VAR_THRESHOLD = 0.3
    const val END_SUSTAIN_S = 20.0
    const val MAX_DURATION_S = 360.0
    const val MIN_DURATION_S = 20.0
    const val RING_BUFFER_S = 10.0

    const val AIRTIME_G = 0.4
    const val AIRTIME_HYSTERESIS_S = 0.1
    const val LOW_G_THRESHOLD_G = 0.6
    const val DROP_VERTICAL_SPEED = -4.0
    const val DROP_VERTICAL_SUSTAIN_S = 0.7
    const val DROP_LOW_G_WINDOW_S = 1.0
    const val DROP_LOW_G_MIN_S = 0.3
    const val DROP_NO_BARO_LOW_G_MIN_S = 0.8
    const val DROP_MERGE_S = 2.0
    const val MAX_G_WINDOW_S = 0.4
    const val INVERSION_ANGLE_DEG = 150.0
    const val INVERSION_GYRO_DEG_S = 90.0
    const val INVERSION_COOLDOWN_S = 1.5
    const val BARO_EMA_TAU_S = 1.0
    const val GRAVITY_EMA_TAU_S = 5.0
}

/** One captured motion sample (device-independent units). */
data class RawSample(
    val t: Double,          // seconds since recording start
    val sfMs2: Double,      // |specific force| in m/s²
    val gx: Double,         // gravity unit vector, device frame
    val gy: Double,
    val gz: Double,
    val gyroDegS: Double,   // |angular rate| in deg/s (0 if no gyro)
    val altRel: Double?,    // relative altitude in m, null if no barometer
)

/** Computed ride summary + downsampled audit trace, ready to hand to JS. */
data class RideResult(
    val metrics: Map<String, Any?>,
    val samples: List<Map<String, Any?>>,
)

/** Pure metric computation from a captured sample array. Mirror of the iOS
 *  `RideMetricsComputer`. Stateless and independently testable. */
object RideMetricsComputer {

    fun compute(samples: List<RawSample>, baroAvailable: Boolean, gyroAvailable: Boolean): RideResult? {
        if (samples.size < 2) return null
        val first = samples.first()
        val last = samples.last()
        val duration = last.t - first.t
        if (duration < RideConst.MIN_DURATION_S) return null

        val airtime = computeAirtime(samples)
        val maxG = computeMaxG(samples)
        val (drops, maxDropM, vertical) = computeBaroMetrics(samples, baroAvailable)
        val inversions = if (gyroAvailable) computeInversions(samples) else 0
        val estTopSpeed = if (maxDropM > 0) 3.6 * sqrt(2 * RideConst.G * maxDropM) else null

        val confidence = computeConfidence(samples, duration, drops, airtime, baroAvailable)

        val now = System.currentTimeMillis()
        val startedAt = isoUtc(now - (duration * 1000).toLong())
        val endedAt = isoUtc(now)

        val metrics = linkedMapOf<String, Any?>(
            "startedAt" to startedAt,
            "endedAt" to endedAt,
            "durationS" to round1(duration),
            "dropCount" to drops,
            "airtimeS" to round1(airtime),
            "maxG" to round2(maxG),
            "inversions" to inversions,
            "verticalM" to round1(vertical),
            "maxDropM" to round1(maxDropM),
            "estTopSpeedKmh" to estTopSpeed?.let { round1(it) },
            "baroAvailable" to baroAvailable,
            "gyroAvailable" to gyroAvailable,
            "confidence" to round2(confidence),
        )
        return RideResult(metrics, downsample(samples))
    }

    private fun computeAirtime(s: List<RawSample>): Double {
        val threshold = RideConst.AIRTIME_G * RideConst.G
        var total = 0.0
        var inState = false
        var candidateSince: Double? = null
        for (i in 1 until s.size) {
            val dt = s[i].t - s[i - 1].t
            val low = s[i].sfMs2 < threshold
            if (low != inState) {
                if (candidateSince == null) candidateSince = s[i].t
                else if (s[i].t - candidateSince!! >= RideConst.AIRTIME_HYSTERESIS_S) {
                    inState = low
                    candidateSince = null
                }
            } else candidateSince = null
            if (inState) total += dt
        }
        return total
    }

    private fun computeMaxG(s: List<RawSample>): Double {
        var maxG = 0.0
        val window = ArrayDeque<Double>()
        var idx = 0
        for (i in s.indices) {
            window.addLast(s[i].sfMs2 / RideConst.G)
            while (idx < i && s[i].t - s[idx].t > RideConst.MAX_G_WINDOW_S) {
                window.removeFirst()
                idx++
            }
            val sorted = window.sorted()
            val median = sorted[sorted.size / 2]
            if (median > maxG) maxG = median
        }
        return maxG
    }

    private fun computeBaroMetrics(s: List<RawSample>, baroAvailable: Boolean): Triple<Int, Double, Double> {
        if (!baroAvailable) {
            return Triple(countLowGDrops(s, RideConst.DROP_NO_BARO_LOW_G_MIN_S), 0.0, 0.0)
        }

        val smoothed = DoubleArray(s.size)
        var ema: Double? = null
        for (i in s.indices) {
            val alt = s[i].altRel ?: ema ?: 0.0
            ema = if (ema == null) alt else {
                val alpha = 1 - exp(-0.1 / RideConst.BARO_EMA_TAU_S)
                ema!! + alpha * (alt - ema!!)
            }
            smoothed[i] = ema!!
        }

        var vertical = 0.0
        var peak = smoothed.first()
        var maxDrop = 0.0
        for (i in 1 until smoothed.size) {
            vertical += abs(smoothed[i] - smoothed[i - 1])
            if (smoothed[i] > peak) peak = smoothed[i]
            val drawdown = peak - smoothed[i]
            if (drawdown > maxDrop) maxDrop = drawdown
        }

        val dropTimes = ArrayList<Double>()
        var descentSince: Double? = null
        for (i in 1 until s.size) {
            val dt = s[i].t - s[i - 1].t
            if (dt <= 0) continue
            val dzdt = (smoothed[i] - smoothed[i - 1]) / dt
            if (dzdt < RideConst.DROP_VERTICAL_SPEED) {
                if (descentSince == null) descentSince = s[i - 1].t
                else if (s[i].t - descentSince!! >= RideConst.DROP_VERTICAL_SUSTAIN_S) {
                    if (hasLowG(s, s[i].t, RideConst.DROP_LOW_G_WINDOW_S, RideConst.DROP_LOW_G_MIN_S)) {
                        val lastT = dropTimes.lastOrNull()
                        if (lastT == null || s[i].t - lastT >= RideConst.DROP_MERGE_S) {
                            dropTimes.add(s[i].t)
                        }
                    }
                    descentSince = null
                }
            } else descentSince = null
        }
        return Triple(dropTimes.size, maxDrop, vertical)
    }

    private fun countLowGDrops(s: List<RawSample>, minS: Double): Int {
        val threshold = RideConst.LOW_G_THRESHOLD_G * RideConst.G
        var drops = 0
        var lowSince: Double? = null
        var lastDropT: Double? = null
        for (sample in s) {
            if (sample.sfMs2 < threshold) {
                if (lowSince == null) lowSince = sample.t
                else if (sample.t - lowSince!! >= minS) {
                    if (lastDropT == null || sample.t - lastDropT!! >= RideConst.DROP_MERGE_S) {
                        drops++
                        lastDropT = sample.t
                    }
                    lowSince = sample.t
                }
            } else lowSince = null
        }
        return drops
    }

    private fun hasLowG(s: List<RawSample>, t: Double, window: Double, minS: Double): Boolean {
        val threshold = RideConst.LOW_G_THRESHOLD_G * RideConst.G
        var lowTime = 0.0
        var prevT: Double? = null
        for (sample in s) {
            if (abs(sample.t - t) > window) continue
            if (sample.sfMs2 < threshold && prevT != null) lowTime += sample.t - prevT!!
            prevT = sample.t
        }
        return lowTime >= minS
    }

    private fun computeInversions(s: List<RawSample>): Int {
        var count = 0
        var baseX = s.first().gx
        var baseY = s.first().gy
        var baseZ = if (s.first().gz != 0.0) s.first().gz else -1.0
        var inverted = false
        var lastFlipT = -RideConst.INVERSION_COOLDOWN_S
        for (i in 1 until s.size) {
            val dt = s[i].t - s[i - 1].t
            val alpha = 1 - exp(-dt / RideConst.GRAVITY_EMA_TAU_S)
            val dot = clamp(s[i].gx * baseX + s[i].gy * baseY + s[i].gz * baseZ, -1.0, 1.0)
            val angle = acos(dot) * 180 / Math.PI
            if (!inverted && angle > RideConst.INVERSION_ANGLE_DEG &&
                s[i].gyroDegS > RideConst.INVERSION_GYRO_DEG_S &&
                s[i].t - lastFlipT > RideConst.INVERSION_COOLDOWN_S
            ) {
                count++
                inverted = true
                lastFlipT = s[i].t
            } else if (inverted && angle < RideConst.INVERSION_ANGLE_DEG - 40) {
                inverted = false
            }
            baseX += alpha * (s[i].gx - baseX)
            baseY += alpha * (s[i].gy - baseY)
            baseZ += alpha * (s[i].gz - baseZ)
            val norm = sqrt(baseX * baseX + baseY * baseY + baseZ * baseZ)
            if (norm > 0) { baseX /= norm; baseY /= norm; baseZ /= norm }
        }
        return count
    }

    private fun computeConfidence(
        s: List<RawSample>,
        duration: Double,
        drops: Int,
        airtime: Double,
        baroAvailable: Boolean,
    ): Double {
        var score = 0.0
        val mean = s.sumOf { it.sfMs2 } / s.size
        val variance = s.sumOf { (it.sfMs2 - mean) * (it.sfMs2 - mean) } / s.size
        if (variance > RideConst.START_VAR_THRESHOLD) score += 0.35
        if (drops >= 1 || airtime > 0.5) score += 0.25
        if (baroAvailable) {
            val alts = s.mapNotNull { it.altRel }
            if (alts.isNotEmpty() && (alts.max() - alts.min()) > 3) score += 0.2
        }
        if (duration in 30.0..240.0) score += 0.2
        return min(1.0, score)
    }

    private fun downsample(s: List<RawSample>): List<Map<String, Any?>> {
        if (s.isEmpty()) return emptyList()
        val first = s.first()
        val out = ArrayList<Map<String, Any?>>()
        var nextT = 0.0
        for (sample in s) {
            val rel = sample.t - first.t
            if (rel + 1e-6 >= nextT) {
                out.add(
                    linkedMapOf(
                        "t" to ((sample.t - first.t) * 1000).toInt(),
                        "aMag" to round2(sample.sfMs2),
                        "altRel" to sample.altRel?.let { round2(it) },
                    )
                )
                nextT += 0.25
            }
            if (out.size >= 600) break
        }
        return out
    }

    private fun round1(v: Double) = Math.round(v * 10) / 10.0
    private fun round2(v: Double) = Math.round(v * 100) / 100.0
    private fun clamp(v: Double, lo: Double, hi: Double) = min(max(v, lo), hi)

    private fun isoUtc(epochMs: Long): String {
        val fmt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
        fmt.timeZone = java.util.TimeZone.getTimeZone("UTC")
        return fmt.format(java.util.Date(epochMs))
    }
}
