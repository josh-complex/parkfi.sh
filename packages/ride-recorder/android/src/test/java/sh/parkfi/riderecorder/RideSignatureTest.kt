package sh.parkfi.riderecorder

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parity test for [RideSignature] — mirrors the fixtures and numbers of
 * `src/lib/ride-metrics.test.ts` so the Kotlin gate can't drift from the
 * shared TS implementation (which the client suppression gate and the server's
 * authoritative gate both use). Update the two together.
 */
class RideSignatureTest {

    /** The TS test's neutral, signature-less baseline (45 s walk, 1.3 g). */
    private fun signature(
        dropCount: Int = 0,
        airtimeS: Double = 0.0,
        maxG: Double = 1.3,
        inversions: Int = 0,
        durationS: Double = 45.0,
    ): Boolean = RideSignature.hasSignature(dropCount, airtimeS, maxG, inversions, durationS)

    @Test
    fun suppressesWalkingFixture() {
        assertFalse(signature())
    }

    @Test
    fun acceptsLegitCoaster() {
        assertTrue(signature(dropCount = 2, maxG = 3.8))
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
    fun airtimeThresholdBoundary() {
        assertTrue(signature(airtimeS = RideConst.SIG_MIN_AIRTIME_S))
        assertFalse(signature(airtimeS = RideConst.SIG_MIN_AIRTIME_S - 0.01))
    }

    @Test
    fun maxGThresholdBoundary() {
        assertTrue(signature(maxG = RideConst.SIG_MIN_MAX_G))
        assertFalse(signature(maxG = RideConst.SIG_MIN_MAX_G - 0.01))
    }

    @Test
    fun rejectsWalkingBandMaxGSpike() {
        // W5: 1.8 sat inside the 1.5–2.5 g walking-impact band.
        assertFalse(signature(maxG = 2.0))
    }

    @Test
    fun maxGOnlySignatureRequiresSustainedDuration() {
        assertFalse(signature(maxG = 3.0, durationS = RideConst.SIG_MAX_G_MIN_DURATION_S - 1))
        assertTrue(signature(maxG = 3.0, durationS = RideConst.SIG_MAX_G_MIN_DURATION_S))
        // The duration floor only applies to maxG-only evidence.
        assertTrue(signature(dropCount = 1, durationS = 25.0))
    }

    @Test
    fun metricsMapOverloadMatchesScalars() {
        assertTrue(
            RideSignature.hasSignature(
                mapOf(
                    "dropCount" to 0,
                    "airtimeS" to 0.0,
                    "maxG" to 3.0,
                    "inversions" to 0,
                    "durationS" to 60.0,
                )
            )
        )
        // Missing keys read as zero — can only suppress.
        assertFalse(RideSignature.hasSignature(emptyMap()))
    }
}
