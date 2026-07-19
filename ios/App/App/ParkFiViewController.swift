import Capacitor
import UIKit

/// Bridge view controller subclass (wired up in Main.storyboard) whose only job
/// is registering our local plugins — Capacitor only auto-registers packaged
/// ones. Android's equivalent is `registerPlugin` in `MainActivity`.
class ParkFiViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeviceCornersPlugin())
    }
}
