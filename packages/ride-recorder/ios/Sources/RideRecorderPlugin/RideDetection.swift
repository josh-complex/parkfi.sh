import Foundation

/// Tunable constants for the ride-detection state machine. Kept in one place so
/// the iOS and Android engines stay in lock-step (mirror any change in
/// `RideDetection.kt`).
enum RideConst {
    static let g = 9.81
    static let monitorHz = 10.0
    static let activeHz = 50.0
    static let varWindowS = 5.0
    static let startVarThreshold = 1.5      // (m/s²)² of specific-force magnitude
    static let startSustainS = 3.0
    static let endVarThreshold = 0.3
    // Round 2 (R7): 20 → 8. Real coasters brake to a stop and unload; 8 s of low
    // variance is enough. At 20 s a queue shuffle never went quiet long enough
    // and every capture ran to maxDurationS — which made the maxG-only
    // signature's 40 s duration floor always-true.
    static let endSustainS = 8.0
    // 15 s under the server's Zod cap (360) — the finish check fires one sample
    // past this, so an exact 360 here could compute durationS > 360 and get the
    // whole ride rejected server-side.
    static let maxDurationS = 345.0
    static let minDurationS = 20.0
    static let ringBufferS = 10.0
    // Of the ring, how much pre-trigger context seeds a capture (round 2: was
    // the whole 10 s ring).
    static let preTriggerKeepS = 3.0
    // A capture longer than this is computed (telemetry) but flagged overlong —
    // never a ride. Mirror of RIDE_SIGNATURE.maxSignatureDurationS.
    static let maxSignatureDurationS = 240.0

    static let airtimeG = 0.4               // specific force < 0.4 g = weightless
    static let airtimeHysteresisS = 0.1
    static let lowGThresholdG = 0.6         // drop low-g gate
    static let dropVerticalSpeed = -4.0     // m/s barometric descent for a drop
    static let dropVerticalSustainS = 0.7
    static let dropLowGWindowS = 1.0
    static let dropLowGMinS = 0.3
    static let dropNoBaroLowGMinS = 0.8     // fallback when barometer absent
    static let dropMergeS = 2.0
    static let maxGWindowS = 0.4
    // The windowed median must hold at least this many g to count toward
    // maxGSustainS (the maxG-only signature's sustain gate).
    static let maxGSustainG = 2.0
    static let inversionAngleDeg = 150.0
    static let inversionGyroDegS = 90.0
    static let inversionCooldownS = 1.5
    static let baroEmaTauS = 1.0            // altitude smoothing time constant
    // verticalM integrates the smoothed altitude at the barometer's real update
    // rate, with a dead band at the sensor noise floor (R9 parity).
    static let baroDecimateHz = 5.0
    static let baroStepFloorM = 0.15
    static let gravityEmaTauS = 5.0        // inversion baseline

    // Ride-signature thresholds — mirror of RIDE_SIGNATURE in
    // src/lib/ride-metrics.ts (and the Android RideConst). W3 gates the local
    // recap notification on the same rule the JS/server gates use, so walking
    // traces stop notifying natively. Keep all three in lock-step.
    static let sigMinDropCount = 1
    static let sigMinAirtimeS = 0.5
    static let sigMinMaxG = 2.3
    static let sigMaxGMinDurationS = 40.0
    static let sigMaxGMinSustainS = 1.0
    static let sigMinInversions = 1
}

/// Mirror of `hasRideSignature` in src/lib/ride-metrics.ts — whether a trace
/// shows coaster-like evidence rather than walking jitter. Round 2: the airtime
/// gate is the longest *contiguous* burst, the maxG-only branch also needs the
/// windowed median to hold ≥ 2.0 g for a full second, and an overlong capture
/// is never a ride. Nil round-2 inputs fall back to the old rule (how the
/// server treats pre-round-2 clients). Android parity is unit-tested
/// (RideSignatureTest.kt); this mirror is checked by review.
enum RideSignature {
    static func hasSignature(
        dropCount: Int, airtimeS: Double, airtimeBurstS: Double?, maxG: Double,
        maxGSustainS: Double?, inversions: Int, durationS: Double, overlong: Bool?
    ) -> Bool {
        if overlong ?? (durationS > RideConst.maxSignatureDurationS) { return false }
        let burst = airtimeBurstS ?? airtimeS
        let sustain = maxGSustainS ?? Double.infinity
        return dropCount >= RideConst.sigMinDropCount
            || burst >= RideConst.sigMinAirtimeS
            || inversions >= RideConst.sigMinInversions
            || (maxG >= RideConst.sigMinMaxG
                && durationS >= RideConst.sigMaxGMinDurationS
                && sustain >= RideConst.sigMaxGMinSustainS)
    }

    /// Metrics-dict overload for the recap gate. Missing required fields read
    /// as zero (can only suppress); missing round-2 fields read as absent.
    static func hasSignature(_ metrics: [String: Any]) -> Bool {
        return hasSignature(
            dropCount: (metrics["dropCount"] as? NSNumber)?.intValue ?? 0,
            airtimeS: (metrics["airtimeS"] as? NSNumber)?.doubleValue ?? 0,
            airtimeBurstS: (metrics["airtimeBurstS"] as? NSNumber)?.doubleValue,
            maxG: (metrics["maxG"] as? NSNumber)?.doubleValue ?? 0,
            maxGSustainS: (metrics["maxGSustainS"] as? NSNumber)?.doubleValue,
            inversions: (metrics["inversions"] as? NSNumber)?.intValue ?? 0,
            durationS: (metrics["durationS"] as? NSNumber)?.doubleValue ?? 0,
            overlong: metrics["overlong"] as? Bool
        )
    }
}

/// One captured motion sample (device-independent units).
struct RawSample {
    let t: Double          // seconds since recording start
    let sfMs2: Double      // |specific force| in m/s² (accelerometer magnitude)
    let gx: Double         // gravity unit vector, device frame
    let gy: Double
    let gz: Double
    let gyroDegS: Double   // |angular rate| in deg/s (0 if no gyro)
    let altRel: Double?    // relative altitude in m, nil if no barometer
}

/// The computed ride summary + downsampled audit trace, ready to hand to JS.
/// `startedAtMs` is the wall-clock ride start (same instant as
/// `metrics["startedAt"]`) for the native event queue.
struct RideResult {
    let metrics: [String: Any]
    let samples: [[String: Any]]
    let startedAtMs: Int64
}

/// Pure metric computation from a captured sample array. Stateless and
/// unit-testable; the streaming capture lives in `RideRecorder`.
enum RideMetricsComputer {

    /// - Parameter endedAt: wall-clock time of the LAST sample in `samples`.
    ///   The recorder trims the quiet tail that ended the capture before
    ///   calling this, so the caller — not `Date()` — knows when the ride ended.
    static func compute(
        _ samples: [RawSample],
        baroAvailable: Bool,
        gyroAvailable: Bool,
        endedAt: Date = Date()
    ) -> RideResult? {
        guard let first = samples.first, let last = samples.last, samples.count >= 2 else { return nil }
        let duration = last.t - first.t
        if duration < RideConst.minDurationS { return nil }

        let (airtime, airtimeBurst) = computeAirtime(samples)
        let (maxG, maxGSustain) = computeMaxG(samples)
        let (drops, maxDropM, vertical) = computeBaroMetrics(samples, baroAvailable: baroAvailable)
        let inversions = gyroAvailable ? computeInversions(samples) : 0
        let estTopSpeed = maxDropM > 0 ? 3.6 * (2 * RideConst.g * maxDropM).squareRoot() : nil
        let overlong = duration > RideConst.maxSignatureDurationS

        let confidence = computeConfidence(
            samples,
            duration: duration,
            drops: drops,
            airtimeBurst: airtimeBurst,
            baroAvailable: baroAvailable
        )

        let startedAt = endedAt.addingTimeInterval(-duration)
        let iso = ISO8601DateFormatter()

        var metrics: [String: Any] = [
            "startedAt": iso.string(from: startedAt),
            "endedAt": iso.string(from: endedAt),
            "durationS": round1(duration),
            "dropCount": drops,
            "airtimeS": round1(airtime),
            "airtimeBurstS": round2(airtimeBurst),
            "maxG": round2(maxG),
            "maxGSustainS": round2(maxGSustain),
            "inversions": inversions,
            "verticalM": round1(vertical),
            "maxDropM": round1(maxDropM),
            "baroAvailable": baroAvailable,
            "gyroAvailable": gyroAvailable,
            "confidence": round2(confidence),
            "overlong": overlong,
        ]
        // Explicit NSNull, never Optional.none-as-Any: the bridge's JSON
        // serialization drops non-JSON values, and the server schema expects
        // null (it tolerates a missing key too, but don't rely on it).
        metrics["estTopSpeedKmh"] = estTopSpeed.map { round1($0) as Any } ?? NSNull()

        return RideResult(
            metrics: metrics,
            samples: downsample(samples),
            startedAtMs: Int64(startedAt.timeIntervalSince1970 * 1000)
        )
    }

    // (Σ time where specific force < 0.4 g, longest contiguous such burst), both
    // with 100 ms enter/exit hysteresis. The burst is the signature gate input.
    private static func computeAirtime(_ s: [RawSample]) -> (total: Double, burst: Double) {
        let threshold = RideConst.airtimeG * RideConst.g
        var total = 0.0
        var burst = 0.0
        var run = 0.0
        var inState = false
        var candidateSince: Double? = nil
        for i in 1..<s.count {
            let dt = s[i].t - s[i - 1].t
            let low = s[i].sfMs2 < threshold
            if low != inState {
                if candidateSince == nil { candidateSince = s[i].t }
                else if s[i].t - candidateSince! >= RideConst.airtimeHysteresisS {
                    inState = low
                    candidateSince = nil
                    if !inState { run = 0 }
                }
            } else {
                candidateSince = nil
            }
            if inState {
                total += dt
                run += dt
                if run > burst { burst = run }
            }
        }
        return (total, burst)
    }

    // (Max over the session of a trailing-window median of specific force in g,
    // longest run with that median ≥ maxGSustainG). The median kills
    // single-sample impact spikes from bumps / phone knocks; the sustain
    // separates a step impact from a launch.
    private static func computeMaxG(_ s: [RawSample]) -> (maxG: Double, sustainS: Double) {
        var maxG = 0.0
        var sustain = 0.0
        var runStart: Double? = nil
        var window: [Double] = []
        var idx = 0
        for i in 0..<s.count {
            window.append(s[i].sfMs2 / RideConst.g)
            while idx < i && s[i].t - s[idx].t > RideConst.maxGWindowS {
                window.removeFirst()
                idx += 1
            }
            let sorted = window.sorted()
            let median = sorted[sorted.count / 2]
            if median > maxG { maxG = median }
            if median >= RideConst.maxGSustainG {
                if runStart == nil { runStart = s[i].t }
                sustain = max(sustain, s[i].t - runStart!)
            } else {
                runStart = nil
            }
        }
        return (maxG, sustain)
    }

    // Drops, largest single descent, and cumulative |Δaltitude|.
    private static func computeBaroMetrics(
        _ s: [RawSample],
        baroAvailable: Bool
    ) -> (drops: Int, maxDropM: Double, verticalM: Double) {
        if !baroAvailable {
            // No barometer: fall back to sustained low-g events as drops.
            return (drops: countLowGDrops(s, minS: RideConst.dropNoBaroLowGMinS),
                    maxDropM: 0, verticalM: 0)
        }

        // EMA-smooth the altitude series (1 s time constant) with the REAL
        // per-sample dt (R9): a hardcoded 0.1 at the 50 Hz capture rate made
        // the effective τ ≈ 0.2 s.
        var smoothed: [Double] = []
        var ema: Double? = nil
        for i in 0..<s.count {
            let alt = s[i].altRel ?? ema ?? 0
            if ema == nil { ema = alt } else {
                let dt = max(1e-3, s[i].t - s[i - 1].t)
                let alpha = 1 - exp(-dt / RideConst.baroEmaTauS)
                ema = ema! + alpha * (alt - ema!)
            }
            smoothed.append(ema!)
        }

        // Max drawdown (largest single descent) on the smoothed series.
        var peak = smoothed.first ?? 0
        var maxDrop = 0.0
        for i in 1..<smoothed.count {
            if smoothed[i] > peak { peak = smoothed[i] }
            let drawdown = peak - smoothed[i]
            if drawdown > maxDrop { maxDrop = drawdown }
        }
        let vertical = computeVertical(s, smoothed: smoothed)

        // Barometric drop detection: descent faster than 4 m/s sustained ≥0.7 s,
        // confirmed by a low-g window ±1 s; merge events closer than 2 s.
        var dropTimes: [Double] = []
        var descentSince: Double? = nil
        for i in 1..<s.count {
            let dt = s[i].t - s[i - 1].t
            guard dt > 0 else { continue }
            let dzdt = (smoothed[i] - smoothed[i - 1]) / dt
            if dzdt < RideConst.dropVerticalSpeed {
                if descentSince == nil { descentSince = s[i - 1].t }
                else if s[i].t - descentSince! >= RideConst.dropVerticalSustainS {
                    if hasLowG(s, around: s[i].t, window: RideConst.dropLowGWindowS,
                              minS: RideConst.dropLowGMinS) {
                        if let lastT = dropTimes.last, s[i].t - lastT < RideConst.dropMergeS {
                            // merge — same drop
                        } else {
                            dropTimes.append(s[i].t)
                        }
                    }
                    descentSince = nil
                }
            } else {
                descentSince = nil
            }
        }
        return (drops: dropTimes.count, maxDropM: maxDrop, verticalM: vertical)
    }

    /// Σ|Δaltitude| over the smoothed series decimated to the barometer's real
    /// update rate, with a dead band at the noise floor: the reference altitude
    /// only advances once the series has moved ≥ baroStepFloorM away from it,
    /// so ±0.1 m jitter integrates to zero while a slow lift-hill climb still
    /// accrues (in 0.15 m quanta). Mirror of RideDetection.kt computeVertical.
    private static func computeVertical(_ s: [RawSample], smoothed: [Double]) -> Double {
        guard !s.isEmpty else { return 0 }
        let stepS = 1.0 / RideConst.baroDecimateHz
        var vertical = 0.0
        var lastT = s[0].t
        var ref = smoothed[0]
        for i in 1..<s.count {
            if s[i].t - lastT < stepS - 1e-6 { continue }
            lastT = s[i].t
            let d = smoothed[i] - ref
            if abs(d) >= RideConst.baroStepFloorM {
                vertical += abs(d)
                ref = smoothed[i]
            }
        }
        return vertical
    }

    private static func countLowGDrops(_ s: [RawSample], minS: Double) -> Int {
        let threshold = RideConst.lowGThresholdG * RideConst.g
        var drops = 0
        var lowSince: Double? = nil
        var lastDropT: Double? = nil
        for sample in s {
            if sample.sfMs2 < threshold {
                if lowSince == nil { lowSince = sample.t }
                else if sample.t - lowSince! >= minS {
                    if lastDropT == nil || sample.t - lastDropT! >= RideConst.dropMergeS {
                        drops += 1
                        lastDropT = sample.t
                    }
                    lowSince = sample.t  // keep counting but throttle by merge window
                }
            } else {
                lowSince = nil
            }
        }
        return drops
    }

    private static func hasLowG(_ s: [RawSample], around t: Double, window: Double, minS: Double) -> Bool {
        let threshold = RideConst.lowGThresholdG * RideConst.g
        var lowTime = 0.0
        var prevT: Double? = nil
        for sample in s where abs(sample.t - t) <= window {
            if sample.sfMs2 < threshold, let p = prevT {
                lowTime += sample.t - p
            }
            prevT = sample.t
        }
        return lowTime >= minS
    }

    // Count of gravity-vector flips >150° from a slow (5 s EMA) baseline,
    // gated by gyro rate >90°/s so pocket fumbling doesn't count.
    private static func computeInversions(_ s: [RawSample]) -> Int {
        var count = 0
        var baseX = s.first?.gx ?? 0
        var baseY = s.first?.gy ?? 0
        var baseZ = s.first?.gz ?? -1
        var inverted = false
        var lastFlipT = -RideConst.inversionCooldownS
        for i in 1..<s.count {
            let dt = s[i].t - s[i - 1].t
            let alpha = 1 - exp(-dt / RideConst.gravityEmaTauS)
            // angle between instantaneous gravity and the trailing baseline
            let dot = clamp(s[i].gx * baseX + s[i].gy * baseY + s[i].gz * baseZ, -1, 1)
            let angle = acos(dot) * 180 / .pi
            if !inverted, angle > RideConst.inversionAngleDeg,
               s[i].gyroDegS > RideConst.inversionGyroDegS,
               s[i].t - lastFlipT > RideConst.inversionCooldownS {
                count += 1
                inverted = true
                lastFlipT = s[i].t
            } else if inverted, angle < RideConst.inversionAngleDeg - 40 {
                inverted = false
            }
            // advance the baseline slowly toward current orientation
            baseX += alpha * (s[i].gx - baseX)
            baseY += alpha * (s[i].gy - baseY)
            baseZ += alpha * (s[i].gz - baseZ)
            let norm = (baseX * baseX + baseY * baseY + baseZ * baseZ).squareRoot()
            if norm > 0 { baseX /= norm; baseY /= norm; baseZ /= norm }
        }
        return count
    }

    // Weighted 0..1 ride-signature score (see PLAN B2 table).
    private static func computeConfidence(
        _ s: [RawSample],
        duration: Double,
        drops: Int,
        airtimeBurst: Double,
        baroAvailable: Bool
    ) -> Double {
        var score = 0.0
        // variance profile — a real ride swings hard
        let mean = s.reduce(0.0) { $0 + $1.sfMs2 } / Double(s.count)
        let variance = s.reduce(0.0) { $0 + ($1.sfMs2 - mean) * ($1.sfMs2 - mean) } / Double(s.count)
        if variance > RideConst.startVarThreshold { score += 0.35 }
        if drops >= 1 || airtimeBurst > 0.5 { score += 0.25 }
        // Barometric range is only ride evidence over a ride-length capture —
        // across a 5-minute queue it's weather drift (round 2).
        if baroAvailable && duration <= RideConst.maxSignatureDurationS {
            let alts = s.compactMap { $0.altRel }
            if let mn = alts.min(), let mx = alts.max(), mx - mn > 3 { score += 0.2 }
        }
        if duration >= 30 && duration <= 240 { score += 0.2 }
        // Ride-signature gate (W1): without ANY coaster evidence — no drop, no
        // airtime burst — walking jitter still scores ~0.55 additively, enough
        // to clear the server's 0.5 confidence floor. Collapse the score so only
        // a trace with real signature can pass. Mirror in RideDetection.kt.
        if drops == 0 && airtimeBurst < 0.5 { score *= 0.4 }
        return min(1.0, score)
    }

    // ~4 Hz downsample for the server audit trace; hard cap 600 samples.
    private static func downsample(_ s: [RawSample]) -> [[String: Any]] {
        guard let first = s.first else { return [] }
        var out: [[String: Any]] = []
        var nextT = 0.0
        for sample in s {
            let rel = sample.t - first.t
            if rel + 1e-6 >= nextT {
                out.append([
                    "t": Int((sample.t - first.t) * 1000),
                    "aMag": round2(sample.sfMs2),
                    // NSNull, not Optional-as-Any — see estTopSpeedKmh note.
                    "altRel": sample.altRel.map { round2($0) as Any } ?? NSNull(),
                ])
                nextT += 0.25
            }
            if out.count >= 600 { break }
        }
        return out
    }

    private static func round1(_ v: Double) -> Double { (v * 10).rounded() / 10 }
    private static func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
    private static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
        min(max(v, lo), hi)
    }
}
