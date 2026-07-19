import Capacitor
import UIKit

/// Reports the physical display's corner radius (pt == CSS px) so the web layer
/// can draw edge-hugging UI (the bottom nav) concentric with the bezel. See
/// research/device-corner-radius.md.
///
/// iOS has no public read API (through iOS 26), and the private
/// `UIScreen._displayCornerRadius` key is an App Store rejection risk we won't
/// take pre-first-submission. Instead: a static model-identifier → radius table
/// (BezelKit-style), with a safe-area heuristic fallback for unlisted devices.
/// Refresh the table once a year when new hardware ships.
@objc(DeviceCornersPlugin)
public class DeviceCornersPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceCornersPlugin"
    public let jsName = "DeviceCorners"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCorners", returnType: CAPPluginReturnPromise)
    ]

    /// Display corner radius in points, keyed by model identifier
    /// (`utsname.machine`). Values from BezelKit's device database. Home-button
    /// devices (square displays, incl. SE 2/3) are absent on purpose — the
    /// fallback resolves them to 0.
    private static let radiiByModel: [String: Double] = [
        // X / XS / XS Max / 11 Pro / 11 Pro Max
        "iPhone10,3": 39.0, "iPhone10,6": 39.0,
        "iPhone11,2": 39.0, "iPhone11,4": 39.0, "iPhone11,6": 39.0,
        "iPhone12,3": 39.0, "iPhone12,5": 39.0,
        // XR / 11
        "iPhone11,8": 41.5, "iPhone12,1": 41.5,
        // 12 / 13 generations
        "iPhone13,1": 44.0, "iPhone13,2": 47.33, "iPhone13,3": 47.33, "iPhone13,4": 53.33,
        "iPhone14,4": 44.0, "iPhone14,5": 47.33, "iPhone14,2": 47.33, "iPhone14,3": 53.33,
        // 14 / 14 Plus / 14 Pro / 14 Pro Max
        "iPhone14,7": 47.33, "iPhone14,8": 53.33, "iPhone15,2": 55.0, "iPhone15,3": 55.0,
        // 15 family
        "iPhone15,4": 55.0, "iPhone15,5": 55.0, "iPhone16,1": 55.0, "iPhone16,2": 55.0,
        // 16 family (Pros went to 62)
        "iPhone17,1": 62.0, "iPhone17,2": 62.0,
        "iPhone17,3": 55.0, "iPhone17,4": 55.0, "iPhone17,5": 55.0,
    ]

    @objc func getCorners(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let radius = Self.displayCornerRadius()
            call.resolve([
                "topLeft": radius,
                "topRight": radius,
                "bottomLeft": radius,
                "bottomRight": radius,
            ])
        }
    }

    private static func displayCornerRadius() -> Double {
        if let known = radiiByModel[modelIdentifier()] {
            return known
        }
        // Unknown device (future hardware, or an iPad). A notch/island phone has
        // a top safe-area inset ≥ 44pt → assume the modern-iPhone ballpark.
        // Home-button-less iPads report ~24pt and have ~18pt display corners.
        // Anything else (home-button hardware) is a square display.
        let topInset =
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first?.safeAreaInsets.top ?? 0
        if topInset >= 44 { return 55.0 }
        if topInset >= 24, UIDevice.current.userInterfaceIdiom == .pad { return 18.0 }
        return 0.0
    }

    private static func modelIdentifier() -> String {
        // Simulators report their arch; the simulated hardware is in the env.
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return simulated
        }
        var systemInfo = utsname()
        uname(&systemInfo)
        return withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
    }
}
