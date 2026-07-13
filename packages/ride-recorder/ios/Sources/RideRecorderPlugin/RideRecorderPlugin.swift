import Foundation
import Capacitor

/// Capacitor bridge for the on-device ride recorder. Owns a single
/// `RideRecorder` and forwards its `rideStarted` / `rideDetected` events to JS.
@objc(RideRecorderPlugin)
public class RideRecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RideRecorderPlugin"
    public let jsName = "RideRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startMonitoring", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopMonitoring", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecording", returnType: CAPPluginReturnPromise),
    ]

    private lazy var recorder: RideRecorder = {
        let r = RideRecorder()
        r.onRideStarted = { [weak self] in
            self?.notifyListeners("rideStarted", data: [:])
        }
        r.onRideDetected = { [weak self] result in
            self?.notifyListeners("rideDetected", data: [
                "metrics": result.metrics,
                "samples": result.samples,
            ])
        }
        return r
    }()

    @objc func requestPermissions(_ call: CAPPluginCall) {
        // CoreMotion prompts lazily on first use; report the current state.
        call.resolve(["motion": RideRecorder.permissionState()])
    }

    @objc func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(["motion": RideRecorder.permissionState()])
    }

    @objc func startMonitoring(_ call: CAPPluginCall) {
        let imuHz = call.getDouble("imuHz") ?? RideConst.monitorHz
        let baroHz = call.getDouble("baroHz") ?? 1.0
        recorder.startMonitoring(imuHz: imuHz, baroHz: baroHz)
        call.resolve()
    }

    @objc func stopMonitoring(_ call: CAPPluginCall) {
        recorder.stopMonitoring()
        call.resolve()
    }

    @objc func startRecording(_ call: CAPPluginCall) {
        recorder.startRecording()
        call.resolve()
    }

    @objc func stopRecording(_ call: CAPPluginCall) {
        if let result = recorder.stopRecording() {
            call.resolve(["metrics": result.metrics, "samples": result.samples])
        } else {
            call.resolve()
        }
    }
}
