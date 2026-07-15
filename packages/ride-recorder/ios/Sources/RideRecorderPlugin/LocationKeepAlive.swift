import Foundation
import CoreLocation

/// Keeps the app process scheduled in the background so `CMMotionManager` keeps
/// delivering IMU samples through a full ride when the phone is pocketed/locked
/// (W9 option B). iOS suspends a backgrounded app within seconds unless it holds
/// an active background-eligible session; a low-accuracy continuous location
/// session is the standard keep-alive (the same capability the Living Layer
/// needs — this is deliberately shared, not a one-off).
///
/// Requires the `location` UIBackgroundMode + `NSLocationAlwaysAndWhenInUseUsageDescription`
/// (see ios/App/App/Info.plist). Only runs while the recorder is monitoring
/// in-park, which bounds the battery cost. The fixes themselves are discarded —
/// the point is only that the session exists.
final class LocationKeepAlive: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var active = false

    override init() {
        super.init()
        manager.delegate = self
        // Coarse on purpose: we don't consume the location, we only need the
        // session to keep the process alive. Lower accuracy + a distance filter
        // means fewer wakeups and less battery.
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 50
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .fitness
    }

    func start() {
        guard !active else { return }
        active = true
        // WhenInUse first (the app already prompts for it elsewhere), then
        // upgrade to Always so updates keep flowing after the screen locks.
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        manager.requestAlwaysAuthorization()
        // Setting this true crashes if `location` isn't in UIBackgroundModes —
        // it is (Info.plist). Safe once the plist entry exists.
        manager.allowsBackgroundLocationUpdates = true
        manager.startUpdatingLocation()
    }

    func stop() {
        guard active else { return }
        active = false
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
    }

    // Delegate stubs — the fixes are intentionally ignored.
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {}
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
