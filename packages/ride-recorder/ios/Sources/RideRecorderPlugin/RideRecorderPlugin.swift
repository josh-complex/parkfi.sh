import Foundation
import Capacitor
import UIKit
import UserNotifications

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
        CAPPluginMethod(name: "getStepSample", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryStepSpan", returnType: CAPPluginReturnPromise),
    ]

    private lazy var recorder: RideRecorder = {
        let r = RideRecorder()
        r.onRideStarted = { [weak self] in
            self?.notifyListeners("rideStarted", data: [:])
        }
        r.onRideDetected = { [weak self] result in
            // W11: a local notification is the user-visible half when the WebView
            // is backgrounded/suspended (the natural moment — phone out of pocket
            // after the ride). Skipped when the app is active (in-app recap toast
            // covers it). retainUntilConsumed so the JS submit still fires on
            // resume even if no listener is attached right now.
            self?.postRecapIfBackgrounded(result.metrics)
            self?.notifyListeners(
                "rideDetected",
                data: ["metrics": result.metrics, "samples": result.samples],
                retainUntilConsumed: true
            )
        }
        return r
    }()

    /// Post a lock-screen recap when the app isn't foreground. Permission is
    /// shared with push registration (@capacitor/push-notifications, A4); if it
    /// wasn't granted, `add` silently no-ops. Under the foreground-only iOS
    /// posture (W9-A) this fires only in the brief backgrounded-not-yet-suspended
    /// window; it becomes the primary recap surface if background capture (W9-B)
    /// is ever adopted.
    private func postRecapIfBackgrounded(_ metrics: [String: Any]) {
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState != .active else { return }
            let content = UNMutableNotificationContent()
            content.title = "🎢 Ride recorded"
            content.body = Self.recapText(metrics)
            content.sound = .default
            let request = UNNotificationRequest(
                identifier: "ride-recap-\(Date().timeIntervalSince1970)",
                content: content,
                trigger: nil
            )
            UNUserNotificationCenter.current().add(request)
        }
    }

    /// Dumb recap line from the metrics dict — mirrors `rideRecapSegments`
    /// (drops · inversions · g · airtime). Kept intentionally simple.
    static func recapText(_ m: [String: Any]) -> String {
        var parts: [String] = []
        if let d = (m["dropCount"] as? NSNumber)?.intValue, d > 0 {
            parts.append("\(d) \(d == 1 ? "drop" : "drops")")
        }
        if let inv = (m["inversions"] as? NSNumber)?.intValue, inv > 0 {
            parts.append("\(inv) \(inv == 1 ? "inversion" : "inversions")")
        }
        if let g = (m["maxG"] as? NSNumber)?.doubleValue, g >= 1 {
            parts.append(String(format: "%.1f g", g))
        }
        if let a = (m["airtimeS"] as? NSNumber)?.doubleValue, a >= 1 {
            parts.append("\(Int(a.rounded())) s airtime")
        }
        return parts.isEmpty ? "Ride logged." : parts.joined(separator: " · ")
    }

    // Override the base CAPPlugin permission methods (CoreMotion prompts lazily
    // on first use); report the current state in the shape the JS layer expects.
    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        call.resolve(["motion": RideRecorder.permissionState()])
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
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

    @objc func getStepSample(_ call: CAPPluginCall) {
        if let sample = recorder.stepSample() {
            call.resolve(["steps": sample.steps, "sessionStartMs": sample.sessionStartMs])
        } else {
            call.resolve(["steps": NSNull(), "sessionStartMs": NSNull()])
        }
    }

    @objc func queryStepSpan(_ call: CAPPluginCall) {
        guard let fromMs = call.getDouble("fromMs"), let toMs = call.getDouble("toMs") else {
            call.reject("fromMs/toMs required")
            return
        }
        recorder.queryStepSpan(fromMs: fromMs, toMs: toMs) { steps in
            if let steps = steps {
                call.resolve(["steps": steps])
            } else {
                call.resolve(["steps": NSNull()])
            }
        }
    }

    @objc func stopRecording(_ call: CAPPluginCall) {
        if let result = recorder.stopRecording() {
            call.resolve(["metrics": result.metrics, "samples": result.samples])
        } else {
            call.resolve()
        }
    }
}
