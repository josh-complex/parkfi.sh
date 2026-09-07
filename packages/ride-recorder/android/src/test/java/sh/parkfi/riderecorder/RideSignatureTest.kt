package sh.parkfi.riderecorder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parity test for [RideSignature] — mirrors the fixtures and numbers of
 * `src/lib/ride-metrics.test.ts` (the PARITY_TABLE there, row for row) so the
 * Kotlin gate can't drift from the shared TS implementation (which the client
 * suppression gate and the server's authoritative gate both use). Update the
 * two together; RideDetection.swift is checked against this by review.
 */
class RideSignatureTest {

    /** The TS test's neutral, signature-less round-2 baseline (45 s walk, 1.3 g). */
    private fun signature(
        dropCount: Int = 0,
        airtimeS: Double = 0.0,
        airtimeBurstS: Double? = 0.0,
        maxG: Double = 1.3,
        maxGSustainS: Double? = 0.0,
        inversions: Int = 0,
        durationS: Double = 45.0,
        overlong: Boolean? = false,
    ): Boolean = RideSignature.hasSignature(
        dropCount, airtimeS, airtimeBurstS, maxG, maxGSustainS, inversions, durationS, overlong
    )

    /** A pre-round-2 client: none of the new fields. */
    private fun legacy(
        dropCount: Int = 0,
        airtimeS: Double = 0.0,
        maxG: Double = 1.3,
        inversions: Int = 0,
        durationS: Double = 45.0,
    ): Boolean = RideSignature.hasSignature(
        dropCount, airtimeS, null, maxG, null, inversions, durationS, null
    )

    // --- Parity table (mirror of PARITY_TABLE in ride-metrics.test.ts) --------

    @Test
    fun realCoaster() {
        assertTrue(signature(dropCount = 2, airtimeS = 3.0, airtimeBurstS = 1.2, maxG = 3.8, maxGSustainS = 2.0, durationS = 95.0))
    }

    @Test
    fun launchCoasterSustainedGOnly() {
        assertTrue(signature(airtimeS = 0.2, airtimeBurstS = 0.2, maxG = 3.5, maxGSustainS = 1.4, durationS = 60.0))
    }

    @Test
    fun queueWalkToTheCapIsOverlong() {
        assertFalse(signature(airtimeS = 0.6, airtimeBurstS = 0.15, maxG = 2.4, maxGSustainS = 0.3, durationS = 345.0, overlong = true))
    }

    @Test
    fun queueWalkWithTwoPhoneHandlingDips() {
        // Cumulative airtime clears 0.5 s but no single burst does.
        assertFalse(signature(airtimeS = 0.7, airtimeBurstS = 0.3, maxG = 2.4, maxGSustainS = 0.4, durationS = 120.0))
    }

    @Test
    fun elevator() {
        assertFalse(signature(maxG = 1.15, durationS = 45.0))
    }

    @Test
    fun bus() {
        assertFalse(signature(airtimeS = 0.1, airtimeBurstS = 0.1, maxG = 1.6, durationS = 200.0))
    }

    @Test
    fun acceptsSingleDropAlone() {
        assertTrue(signature(dropCount = RideConst.SIG_MIN_DROP_COUNT))
    }

    @Test
    fun acceptsInversionAlone() {
        assertTrue(signature(inversions = RideConst.SIG_MIN_INVERSIONS))
    }

    @Test
    fun airtimeBurstThresholdBoundary() {
        assertTrue(signature(airtimeS = 0.5, airtimeBurstS = RideConst.SIG_MIN_AIRTIME_S))
        assertFalse(signature(airtimeS = 2.0, airtimeBurstS = RideConst.SIG_MIN_AIRTIME_S - 0.01))
    }

    @Test
    fun maxGOnlyAtAllThreeFloors() {
        assertTrue(
            signature(
                maxG = RideConst.SIG_MIN_MAX_G,
                maxGSustainS = RideConst.SIG_MAX_G_MIN_SUSTAIN_S,
                durationS = RideConst.SIG_MAX_G_MIN_DURATION_S,
            )
        )
    }

    @Test
    fun maxGOnlySustainJustUnder() {
        assertFalse(signature(maxG = 3.0, maxGSustainS = 0.99, durationS = 60.0))
    }

    @Test
    fun overlongVetoesRealEvidence() {
        assertFalse(signature(dropCount = 2, airtimeBurstS = 1.2, maxG = 3.8, maxGSustainS = 2.0, durationS = 95.0, overlong = true))
    }

    // --- Boundaries the TS suite also checks ------------------------------------

    @Test
    fun suppressesWalkingFixture() {
        assertFalse(signature())
    }

    @Test
    fun maxGThresholdBoundaryWithSustain() {
        assertTrue(signature(maxG = RideConst.SIG_MIN_MAX_G, maxGSustainS = 1.0))
        assertFalse(signature(maxG = RideConst.SIG_MIN_MAX_G - 0.01, maxGSustainS = 1.0))
    }

    @Test
    fun rejectsWalkingBandMaxGSpike() {
        // W5: 1.8 sat inside the 1.5–2.5 g walking-impact band.
        assertFalse(signature(maxG = 2.0, maxGSustainS = 1.0))
    }

    @Test
    fun maxGOnlySignatureRequiresSustainedDuration() {
        assertFalse(signature(maxG = 3.0, maxGSustainS = 1.0, durationS = RideConst.SIG_MAX_G_MIN_DURATION_S - 1))
        assertTrue(signature(maxG = 3.0, maxGSustainS = 1.0, durationS = RideConst.SIG_MAX_G_MIN_DURATION_S))
        // The duration floor only applies to maxG-only evidence.
        assertTrue(signature(dropCount = 1, durationS = 25.0))
    }

    // --- Legacy (pre-round-2) clients -------------------------------------------

    @Test
    fun legacyGatesOnCumulativeAirtime() {
        assertTrue(legacy(airtimeS = 0.6))
        assertFalse(legacy(airtimeS = 0.4))
    }

    @Test
    fun legacyKeepsDurationOnlyMaxGRule() {
        assertTrue(legacy(maxG = 3.0, durationS = 60.0))
        assertFalse(legacy(maxG = 3.0, durationS = 39.0))
    }

    @Test
    fun legacyInfersOverlongFromDuration() {
        assertFalse(legacy(maxG = 2.5, durationS = 345.0))
        assertTrue(legacy(maxG = 2.5, durationS = RideConst.MAX_SIGNATURE_DURATION_S))
    }

    @Test
    fun explicitOverlongFalseBeatsDurationInference() {
        assertTrue(signature(dropCount = 1, durationS = 300.0, overlong = false))
    }

    // --- Metrics-map overload ---------------------------------------------------

    @Test
    fun metricsMapOverloadMatchesScalars() {
        assertTrue(
            RideSignature.hasSignature(
                mapOf(
                    "dropCount" to 0,
                    "airtimeS" to 0.0,
                    "airtimeBurstS" to 0.0,
                    "maxG" to 3.0,
                    "maxGSustainS" to 1.5,
                    "inversions" to 0,
                    "durationS" to 60.0,
                    "overlong" to false,
                )
            )
        )
        // Round-2 fields missing ⇒ legacy fallback (duration-only maxG rule).
        assertTrue(
            RideSignature.hasSignature(
                mapOf("dropCount" to 0, "airtimeS" to 0.0, "maxG" to 3.0, "inversions" to 0, "durationS" to 60.0)
            )
        )
        // Missing required keys read as zero — can only suppress.
        assertFalse(RideSignature.hasSignature(emptyMap()))
    }

    // --- Metric computation (the R7/R9 mechanics, not just the gate) -----------

    private fun sample(t: Double, g: Double, alt: Double? = null) =
        RawSample(t = t, sfMs2 = g * RideConst.G, gx = 0.0, gy = 0.0, gz = -1.0, gyroDegS = 0.0, altRel = alt)

    @Test
    fun airtimeBurstIsLongestContiguousNotCumulative() {
        // 50 Hz: 1 g, then three 0.3 s dips separated by 1 g stretches.
        val s = ArrayList<RawSample>()
        var t = 0.0
        fun push(seconds: Double, g: Double) {
            var n = 0
            while (n < (seconds * 50).toInt()) { s.add(sample(t, g)); t += 0.02; n++ }
        }
        push(2.0, 1.0); push(0.3, 0.1); push(2.0, 1.0); push(0.3, 0.1); push(2.0, 1.0); push(0.3, 0.1); push(2.0, 1.0)
        val (total, burst) = RideMetricsComputer.computeAirtime(s)
        assertTrue("cumulative ${total} should clear 0.5", total >= 0.5)
        assertTrue("burst ${burst} must stay under 0.5", burst < RideConst.SIG_MIN_AIRTIME_S)
        // Hysteresis eats ~0.1 s of each dip's start; each burst is ~0.2 s.
        assertTrue(burst > 0.1)
    }

    @Test
    fun maxGSustainMeasuresHeldGNotPeak() {
        val s = ArrayList<RawSample>()
        var t = 0.0
        fun push(seconds: Double, g: Double) {
            var n = 0
            while (n < (seconds * 50).toInt()) { s.add(sample(t, g)); t += 0.02; n++ }
        }
        // A brief 0.3 s spike to 3 g (a stumble)…
        push(5.0, 1.0); push(0.3, 3.0); push(5.0, 1.0)
        val (spikeMax, spikeSustain) = RideMetricsComputer.computeMaxG(s)
        assertTrue(spikeMax >= 2.3)
        assertTrue("stumble sustain ${spikeSustain}", spikeSustain < RideConst.SIG_MAX_G_MIN_SUSTAIN_S)
        // …vs 2 s of 3 g (a launch).
        s.clear(); t = 0.0
        push(5.0, 1.0); push(2.0, 3.0); push(5.0, 1.0)
        val (_, launchSustain) = RideMetricsComputer.computeMaxG(s)
        assertTrue("launch sustain ${launchSustain}", launchSustain >= RideConst.SIG_MAX_G_MIN_SUSTAIN_S)
    }

    @Test
    fun verticalIgnoresNoiseButIntegratesSlowClimb() {
        // 50 Hz, 60 s of ±0.05 m barometer jitter around a flat altitude.
        val flat = ArrayList<RawSample>()
        var t = 0.0
        var i = 0
        while (t < 60.0) { flat.add(sample(t, 1.0, if (i % 2 == 0) 0.05 else -0.05)); t += 0.02; i++ }
        val smoothedFlat = DoubleArray(flat.size) { flat[it].altRel!! }
        assertEquals(0.0, RideMetricsComputer.computeVertical(flat, smoothedFlat), 1e-9)

        // A 0.5 m/s climb for 20 s (10 m) must not be dropped step by step.
        val climb = ArrayList<RawSample>()
        t = 0.0
        while (t < 20.0) { climb.add(sample(t, 1.0, 0.5 * t)); t += 0.02 }
        val smoothedClimb = DoubleArray(climb.size) { climb[it].altRel!! }
        val v = RideMetricsComputer.computeVertical(climb, smoothedClimb)
        assertTrue("climb vertical ${v}", v > 9.0 && v <= 10.0)
    }

    @Test
    fun overlongCaptureIsFlaggedAndNotARide() {
        // 300 s bumpy walk with a maxG in the walking band.
        val s = ArrayList<RawSample>()
        var t = 0.0
        var i = 0
        while (t < 300.0) { s.add(sample(t, if (i % 10 == 0) 2.4 else 1.0)); t += 0.1; i++ }
        val r = RideMetricsComputer.compute(s, baroAvailable = false, gyroAvailable = false, endedAtMs = 1_700_000_300_000L)!!
        assertEquals(true, r.metrics["overlong"])
        assertFalse(RideSignature.hasSignature(r.metrics))
        // startedAt is endedAt − duration, threaded out as a Long for the queue.
        assertEquals((1_700_000_300_000L - 300_000L + 100L).toDouble(), r.startedAtMs.toDouble(), 200.0)
    }
}
