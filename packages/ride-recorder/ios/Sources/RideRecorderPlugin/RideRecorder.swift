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
    private let pedometer = CMPedometer()
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

    // Session step counter (F-steps): cumulative steps since the current
    // monitoring session was armed, nil when step counting is unavailable or
    // never armed. `sessionStartMs` identifies the session — the server keys its
    // dedupe cursor on it, so it must change exactly when the counter resets.
    // Written on the pedometer's callback thread, read from the Capacitor call
    // thread — guarded by stepsLock. Frozen (not cleared) on disarm so the JS
    // layer's last read before/after park exit still resolves.
    private let stepsLock = NSLock()
    private var sessionStepsValue: Int? = nil
    private var sessionStartMsValue: Double? = nil
    // Dedicated instance for historical queries (reconciliation) — kept separate
    // from the live-updates instance to avoid interleaving update/query state.
    private let pedometerHistory = CMPedometer()

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
        // Steps ride the same arm/disarm lifecycle, which is what scopes them to
        // in-park time: the JS tracker arms only inside a geofence. CMPedometer
        // counts on the motion coprocessor, so backgrounded stretches (locked
        // phone in a pocket) are included when the next update lands.
        startPedometer()
    }

    func stopMonitoring() {
        monitoring = false
        recording = false
        manual = false
        keepAlive.stop()
        motion.stopDeviceMotionUpdates()
        altimeter.stopRelativeAltitudeUpdates()
        pedometer.stopUpdates()
        ring.removeAll()
        capture.removeAll()
        varWindow.removeAll()
        highVarSince = nil
        lowVarSince = nil
    }

    /// Cumulative steps since the current monitoring session armed, with the
    /// session's start time as its identity; nil when step counting is
    /// unavailable (no coprocessor, permission denied) or never armed. The
    /// server diffs successive cumulative reports against a per-session cursor.
    func stepSample() -> (steps: Int, sessionStartMs: Double)? {
        stepsLock.lock()
        defer { stepsLock.unlock() }
        guard let steps = sessionStepsValue, let start = sessionStartMsValue else { return nil }
        return (steps, start)
    }

    /// Historical step count over an absolute window (reconciliation). Served
    /// from the OS's ~7-day pedometer buffer, so it survives app kills and
    /// repairs anything the live session lost. Nil when unavailable.
    func queryStepSpan(fromMs: Double, toMs: Double, completion: @escaping (Int?) -> Void) {
        guard CMPedometer.isStepCountingAvailable(), toMs > fromMs else {
            completion(nil)
            return
        }
        let from = Date(timeIntervalSince1970: fromMs / 1000)
        let to = Date(timeIntervalSince1970: toMs / 1000)
        pedometerHistory.queryPedometerData(from: from, to: to) { data, _ in
            completion(data?.numberOfSteps.intValue)
        }
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

    private func startPedometer() {
        // isStepCountingAvailable() is true even when Motion & Fitness was
        // denied — gate on authorization too. Without this a denied device
        // freezes the sample at (0, start), every ping ships cum 0, and the
        // server's distance cap (creditedDistance) reads "moved but took zero
        // steps" — zeroing distance_m for that user forever. Denied ⇒ nil
        // sample ⇒ the server treats the device as pedometer-less and GPS
        // distance passes through unclamped.
        let auth = CMPedometer.authorizationStatus()
        guard CMPedometer.isStepCountingAvailable(), auth != .denied, auth != .restricted else {
            stepsLock.lock()
            sessionStepsValue = nil
            sessionStartMsValue = nil
            stepsLock.unlock()
            return
        }
        stepsLock.lock()
        sessionStepsValue = 0
        sessionStartMsValue = Date().timeIntervalSince1970 * 1000
        stepsLock.unlock()
        pedometer.startUpdates(from: Date()) { [weak self] data, error in
            guard let self = self else { return }
            guard let data = data else {
                // .notDetermined resolves at this first use — a denial at the
                // prompt lands here as an error. Nil the whole sample: a dead
                // pedometer must read as "absent", never as "0 steps".
                if error != nil {
                    self.stepsLock.lock()
                    self.sessionStepsValue = nil
                    self.sessionStartMsValue = nil
                    self.stepsLock.unlock()
                }
                return
            }
            self.stepsLock.lock()
            self.sessionStepsValue = data.numberOfSteps.intValue
            self.stepsLock.unlock()
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
