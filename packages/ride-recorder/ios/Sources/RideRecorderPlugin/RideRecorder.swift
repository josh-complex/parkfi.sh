import Foundation
import CoreMotion

/// Foreground IMU + barometer capture with a passive-detection state machine.
///
/// Monitoring runs `deviceMotion` at ~10 Hz (accel-only, cheap) and watches a
/// rolling 5 s variance of specific-force magnitude. When the ride-start trigger
/// fires it escalates to 50 Hz, starts the altimeter, seeds the capture with the
/// 10 s pre-trigger ring buffer, and emits `rideStarted`. On ride end (quiet for
/// 20 s or a 6 min cap) it computes metrics and emits `rideDetected`, then
/// reverts to monitoring. Callers arm/disarm this only while in-park (see the JS
/// `AchievementTracker`), which is what bounds battery.
final class RideRecorder {
    var onRideStarted: (() -> Void)?
    var onRideDetected: ((RideResult) -> Void)?

    private let motion = CMMotionManager()
    private let altimeter = CMAltimeter()
    private let queue = OperationQueue()
    // Background keep-alive so capture survives screen-lock (W9-B). Owned by the
    // monitoring lifecycle — started on arm, stopped on disarm.
    private let keepAlive = LocationKeepAlive()

    private var monitoring = false
    private var recording = false
    private var manual = false

    // Rolling window for the variance trigger (monitoring mode).
    private var varWindow: [(t: Double, v: Double)] = []
    private var highVarSince: Double? = nil
    private var lowVarSince: Double? = nil

    // 10 s pre-trigger ring buffer + the active capture.
    private var ring: [RawSample] = []
    private var capture: [RawSample] = []
    private var recordStart: Double = 0

    private var relAltitude: Double? = nil
    private var baroAvailable = false
    private var gyroAvailable = false

    // MARK: - Permissions

    static func permissionState() -> String {
        guard CMMotionActivityManager.isActivityAvailable() else { return "granted" }
        switch CMMotionActivityManager.authorizationStatus() {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    // MARK: - Lifecycle

    func startMonitoring(imuHz: Double, baroHz: Double) {
        guard motion.isDeviceMotionAvailable, !monitoring else { return }
        monitoring = true
        gyroAvailable = motion.isGyroAvailable
        queue.maxConcurrentOperationCount = 1
        // Hold a background location session so iOS keeps scheduling us with the
        // screen locked — otherwise deviceMotion updates stop within seconds of
        // suspension mid-ride (W9-B).
        keepAlive.start()
        startDeviceMotion(hz: imuHz)
        // Run the altimeter from arming, not from ride-start, so the 10 s
        // pre-trigger ring carries real altitude and the lift-hill climb is
        // captured (W3/F5). CMAltimeter is ~1 Hz — negligible battery vs the IMU.
        // relAltitude continuity across rides in one arming session is fine: all
        // metrics use relative deltas/drawdowns within a single capture.
        startAltimeter()
    }

    func stopMonitoring() {
        monitoring = false
        recording = false
        manual = false
        keepAlive.stop()
        motion.stopDeviceMotionUpdates()
        altimeter.stopRelativeAltitudeUpdates()
        ring.removeAll()
        capture.removeAll()
        varWindow.removeAll()
        highVarSince = nil
        lowVarSince = nil
    }

    func startRecording() {
        guard monitoring, !recording else { return }
        manual = true
        beginRecording(seedFromRing: true)
    }

    func stopRecording() -> RideResult? {
        guard recording else { return nil }
        let result = finishRecording()
        return result
    }

    // MARK: - Capture

    private func startDeviceMotion(hz: Double) {
        motion.stopDeviceMotionUpdates()
        motion.deviceMotionUpdateInterval = 1.0 / hz
        motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: queue) { [weak self] dm, _ in
            guard let self = self, let dm = dm else { return }
            self.handleMotion(dm)
        }
    }

    private func startAltimeter() {
        guard CMAltimeter.isRelativeAltitudeAvailable() else {
            baroAvailable = false
            return
        }
        baroAvailable = true
        relAltitude = nil
        altimeter.startRelativeAltitudeUpdates(to: queue) { [weak self] data, _ in
            guard let self = self, let data = data else { return }
            self.relAltitude = data.relativeAltitude.doubleValue
        }
    }

    private func handleMotion(_ dm: CMDeviceMotion) {
        let t = dm.timestamp
        // Specific force = user acceleration + gravity, in G → magnitude in m/s².
        let sfx = dm.userAcceleration.x + dm.gravity.x
        let sfy = dm.userAcceleration.y + dm.gravity.y
        let sfz = dm.userAcceleration.z + dm.gravity.z
        let sfMs2 = (sfx * sfx + sfy * sfy + sfz * sfz).squareRoot() * RideConst.g

        let gyroDegS = (dm.rotationRate.x * dm.rotationRate.x
            + dm.rotationRate.y * dm.rotationRate.y
            + dm.rotationRate.z * dm.rotationRate.z).squareRoot() * 180 / .pi

        // gravity is already ~unit length in G; normalize defensively.
        let gnorm = max(1e-6, (dm.gravity.x * dm.gravity.x
            + dm.gravity.y * dm.gravity.y + dm.gravity.z * dm.gravity.z).squareRoot())

        let sample = RawSample(
            t: t,
            sfMs2: sfMs2,
            gx: dm.gravity.x / gnorm,
            gy: dm.gravity.y / gnorm,
            gz: dm.gravity.z / gnorm,
            gyroDegS: gyroDegS,
            altRel: baroAvailable ? relAltitude : nil
        )

        if recording {
            capture.append(sample)
            evaluateEnd(sample, now: t)
        } else {
            pushRing(sample, now: t)
            evaluateStart(sfMs2: sfMs2, now: t)
        }
    }

    private func pushRing(_ s: RawSample, now: Double) {
        ring.append(s)
        while let first = ring.first, now - first.t > RideConst.ringBufferS {
            ring.removeFirst()
        }
    }

    // MARK: - Triggers

    private func evaluateStart(sfMs2: Double, now: Double) {
        // rolling variance of specific force over the window
        varWindow.append((now, sfMs2))
        while let first = varWindow.first, now - first.t > RideConst.varWindowS {
            varWindow.removeFirst()
        }
        guard varWindow.count > 3 else { return }
        let mean = varWindow.reduce(0.0) { $0 + $1.v } / Double(varWindow.count)
        let variance = varWindow.reduce(0.0) { $0 + ($1.v - mean) * ($1.v - mean) } / Double(varWindow.count)

        if variance > RideConst.startVarThreshold {
            if highVarSince == nil { highVarSince = now }
            else if now - highVarSince! >= RideConst.startSustainS {
                beginRecording(seedFromRing: true)
            }
        } else {
            highVarSince = nil
        }
    }

    private func evaluateEnd(_ s: RawSample, now: Double) {
        if now - recordStart >= RideConst.maxDurationS {
            _ = finishRecording()
            return
        }
        if manual { return }  // manual recordings end only via stopRecording()

        // Quiet detection: variance of the last window below the end threshold.
        let recent = capture.filter { now - $0.t <= RideConst.varWindowS }
        guard recent.count > 3 else { return }
        let mean = recent.reduce(0.0) { $0 + $1.sfMs2 } / Double(recent.count)
        let variance = recent.reduce(0.0) { $0 + ($1.sfMs2 - mean) * ($1.sfMs2 - mean) } / Double(recent.count)
        if variance < RideConst.endVarThreshold {
            if lowVarSince == nil { lowVarSince = now }
            else if now - lowVarSince! >= RideConst.endSustainS {
                _ = finishRecording()
            }
        } else {
            lowVarSince = nil
        }
    }

    private func beginRecording(seedFromRing: Bool) {
        guard !recording else { return }
        recording = true
        lowVarSince = nil
        highVarSince = nil
        capture = seedFromRing ? ring : []
        recordStart = capture.first?.t ?? (ring.last?.t ?? Date().timeIntervalSince1970)
        // Altimeter already running from startMonitoring (W3) — do not restart it
        // here or the ring's pre-trigger altitude baseline resets to the trigger
        // point, losing the lift hill.
        startDeviceMotion(hz: RideConst.activeHz)  // escalate to full rate
        onRideStarted?()
    }

    private func finishRecording() -> RideResult? {
        guard recording else { return nil }
        recording = false
        let wasManual = manual
        manual = false
        let samples = capture
        capture = []
        // Leave the altimeter running — it's owned by the monitoring lifecycle
        // now (started in startMonitoring, stopped in stopMonitoring), so the
        // next ride's pre-trigger ring keeps getting real altitude (W3).

        // back down to monitoring rate (unless we're fully stopping)
        if monitoring { startDeviceMotion(hz: RideConst.monitorHz) }

        let result = RideMetricsComputer.compute(
            samples,
            baroAvailable: baroAvailable,
            gyroAvailable: gyroAvailable
        )
        if let result = result, !wasManual {
            onRideDetected?(result)
        }
        return result
    }
}
