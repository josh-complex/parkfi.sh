import Foundation
import CoreLocation

/// Background park entry/exit detection via Core Location **region monitoring**.
///
/// Unlike `LocationKeepAlive` (which only sustains an already-running capture
/// session), monitored `CLCircularRegion`s fire `didEnterRegion` / `didExitRegion`
/// even when the app is suspended or terminated — iOS relaunches it in the
/// background to deliver the event. That is what lets ParkFi notice you walked
/// into Magic Kingdom with the phone in your pocket, arm the ride recorder, and
/// (when backgrounded) drop a "you're in the park" notification — none of which
/// the WebView's foreground `watchPosition` can do.
///
/// Requires the **Always** authorization + the `location` UIBackgroundMode (both
/// already declared for the keep-alive). iOS caps a single app at 20 monitored
/// regions; the JS layer sends only the nearest parks.
final class ParkGeofenceManager: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()

    /// (regionId, "enter"|"exit") — wired by the plugin to notify JS / arm.
    var onTransition: ((String, String) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false
    }

    /// Escalate to Always so monitored regions keep firing after the screen
    /// locks / the app is suspended. Safe to call repeatedly.
    func requestAlways() {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        manager.requestAlwaysAuthorization()
    }

    func authorizationState() -> String {
        switch manager.authorizationStatus {
        case .authorizedAlways: return "granted"
        case .authorizedWhenInUse: return "granted" // in-use still fires while active
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    /// Replace the monitored set. Clears any region we no longer want and starts
    /// monitoring the rest. Regions are keyed by id, so re-sending the same id
    /// updates it in place.
    func setRegions(_ regions: [(id: String, lat: Double, lng: Double, radius: Double)]) {
        let wanted = Set(regions.map { $0.id })
        for region in manager.monitoredRegions where !wanted.contains(region.identifier) {
            manager.stopMonitoring(for: region)
        }
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
        // iOS hard-caps at 20 monitored regions; keep the first 20 (JS pre-sorts
        // by distance, so these are the nearest).
        for r in regions.prefix(20) {
            let region = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: r.lat, longitude: r.lng),
                radius: min(r.radius, manager.maximumRegionMonitoringDistance),
                identifier: r.id
            )
            region.notifyOnEntry = true
            region.notifyOnExit = true
            manager.startMonitoring(for: region)
        }
    }

    func clear() {
        for region in manager.monitoredRegions {
            manager.stopMonitoring(for: region)
        }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        onTransition?(region.identifier, "enter")
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        onTransition?(region.identifier, "exit")
    }
}
