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
    static let endSustainS = 20.0
    // 15 s under the server's Zod cap (360) — the finish check fires one sample
    // past this, so an exact 360 here could compute durationS > 360 and get the
    // whole ride rejected server-side.
    static let maxDurationS = 345.0
    static let minDurationS = 20.0
    static let ringBufferS = 10.0

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
    static let inversionAngleDeg = 150.0
    static let inversionGyroDegS = 90.0
    static let inversionCooldownS = 1.5
    static let baroEmaTauS = 1.0            // altitude smoothing time constant
    static let gravityEmaTauS = 5.0        // inversion baseline

    // Ride-signature thresholds — mirror of RIDE_SIGNATURE in
    // src/lib/ride-metrics.ts (and the Android RideConst). W3 gates the local
    // recap notification on the same rule the JS/server gates use, so walking
    // traces stop notifying natively. Keep all three in lock-step.
    static let sigMinDropCount = 1
    static let sigMinAirtimeS = 0.5
    static let sigMinMaxG = 2.3
    static let sigMaxGMinDurationS = 40.0
    static let sigMinInversions = 1
}

/// Mirror of `hasRideSignature` in src/lib/ride-metrics.ts — whether a trace
/// shows coaster-like evidence rather than walking jitter. A maxG-only
/// signature additionally requires a sustained ride: step impacts read
/// 1.5–2.5 g in the 0.4 s windowed median but spike briefly, where
/// launch/helix g is sustained. Android parity is unit-tested
/// (RideSignatureTest.kt); this mirror is checked manually.
enum RideSignature {
    static func hasSignature(
        dropCount: Int, airtimeS: Double, maxG: Double, inversions: Int, durationS: Double
    ) -> Bool {
        return dropCount >= RideConst.sigMinDropCount
            || airtimeS >= RideConst.sigMinAirtimeS
            || inversions >= RideConst.sigMinInversions
            || (maxG >= RideConst.sigMinMaxG && durationS >= RideConst.sigMaxGMinDurationS)
    }

    /// Metrics-dict overload for the recap gate. Missing/non-numeric fields
    /// read as zero, which can only suppress, never over-notify.
    static func hasSignature(_ metrics: [String: Any]) -> Bool {
        return hasSignature(
            dropCount: (metrics["dropCount"] as? NSNumber)?.intValue ?? 0,
            airtimeS: (metrics["airtimeS"] as? NSNumber)?.doubleValue ?? 0,
            maxG: (metrics["maxG"] as? NSNumber)?.doubleValue ?? 0,
            inversions: (metrics["inversions"] as? NSNumber)?.intValue ?? 0,
            durationS: (metrics["durationS"] as? NSNumber)?.doubleValue ?? 0
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
struct RideResult {
    let metrics: [String: Any]
    let samples: [[String: Any]]
}

/// Pure metric computation from a captured sample array. Stateless and
/// unit-testable; the streaming capture lives in `RideRecorder`.
enum RideMetricsComputer {

    static func compute(
        _ samples: [RawSample],
        baroAvailable: Bool,
        gyroAvailable: Bool
    ) -> RideResult? {
        guard let first = samples.first, let last = samples.last else { return nil }
        let duration = last.t - first.t
        if duration < RideConst.minDurationS { return nil }

        let airtime = computeAirtime(samples)
        let maxG = computeMaxG(samples)
        let (drops, maxDropM, vertical) = computeBaroMetrics(samples, baroAvailable: baroAvailable)
        let inversions = gyroAvailable ? computeInversions(samples) : 0
        let estTopSpeed = maxDropM > 0 ? 3.6 * (2 * RideConst.g * maxDropM).squareRoot() : nil

        let confidence = computeConfidence(
            samples,
            duration: duration,
            drops: drops,
            airtime: airtime,
            baroAvailable: baroAvailable
        )

        let startedAt = Date().addingTimeInterval(-duration)
        let endedAt = Date()
        let iso = ISO8601DateFormatter()

        var metrics: [String: Any] = [
            "startedAt": iso.string(from: startedAt),
            "endedAt": iso.string(from: endedAt),
            "durationS": round1(duration),
            "dropCount": drops,
            "airtimeS": round1(airtime),
            "maxG": round2(maxG),
            "inversions": inversions,
            "verticalM": round1(vertical),
            "maxDropM": round1(maxDropM),
            "baroAvailable": baroAvailable,
            "gyroAvailable": gyroAvailable,
            "confidence": round2(confidence),
        ]
        // Explicit NSNull, never Optional.none-as-Any: the bridge's JSON
        // serialization drops non-JSON values, and the server schema expects
        // null (it tolerates a missing key too, but don't rely on it).
        metrics["estTopSpeedKmh"] = estTopSpeed.map { round1($0) as Any } ?? NSNull()

        return RideResult(metrics: metrics, samples: downsample(samples))
    }

    // Σ time where specific force < 0.4 g, with 100 ms enter/exit hysteresis.
    private static func computeAirtime(_ s: [RawSample]) -> Double {
        let threshold = RideConst.airtimeG * RideConst.g
        var total = 0.0
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
                }
            } else {
                candidateSince = nil
            }
            if inState { total += dt }
        }
        return total
    }

    // Max over the session of a trailing-window median of specific force in g
    // (median kills single-sample impact spikes from bumps / phone knocks).
    private static func computeMaxG(_ s: [RawSample]) -> Double {
        var maxG = 0.0
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
        }
        return maxG
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

        // EMA-smooth the altitude series (1 s time constant).
        var smoothed: [Double] = []
        var ema: Double? = nil
        for sample in s {
            let alt = sample.altRel ?? ema ?? 0
            if ema == nil { ema = alt } else {
                let dt = smoothed.isEmpty ? 0.1 : 0.1
                let alpha = 1 - exp(-dt / RideConst.baroEmaTauS)
                ema = ema! + alpha * (alt - ema!)
            }
            smoothed.append(ema!)
        }

        // Cumulative vertical + max drawdown (largest single descent).
        var vertical = 0.0
        var peak = smoothed.first ?? 0
        var maxDrop = 0.0
        for i in 1..<smoothed.count {
            vertical += abs(smoothed[i] - smoothed[i - 1])
            if smoothed[i] > peak { peak = smoothed[i] }
            let drawdown = peak - smoothed[i]
            if drawdown > maxDrop { maxDrop = drawdown }
        }

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
        airtime: Double,
        baroAvailable: Bool
    ) -> Double {
        var score = 0.0
        // variance profile — a real ride swings hard
        let mean = s.reduce(0.0) { $0 + $1.sfMs2 } / Double(s.count)
        let variance = s.reduce(0.0) { $0 + ($1.sfMs2 - mean) * ($1.sfMs2 - mean) } / Double(s.count)
        if variance > RideConst.startVarThreshold { score += 0.35 }
        if drops >= 1 || airtime > 0.5 { score += 0.25 }
        if baroAvailable {
            let alts = s.compactMap { $0.altRel }
            if let mn = alts.min(), let mx = alts.max(), mx - mn > 3 { score += 0.2 }
        }
        if duration >= 30 && duration <= 240 { score += 0.2 }
        // Ride-signature gate (W1): without ANY coaster evidence — no drop, no
        // airtime — walking jitter still scores ~0.55 additively, enough to clear
        // the server's 0.5 confidence floor. Collapse the score so only a trace
        // with real signature can pass. Mirror in RideDetection.kt.
        if drops == 0 && airtime < 0.5 { score *= 0.4 }
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
