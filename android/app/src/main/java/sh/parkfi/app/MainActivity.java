package sh.parkfi.app;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge boots in super.onCreate.
        registerPlugin(DeviceCornersPlugin.class);
        super.onCreate(savedInstanceState);

        // The web layer hides the gesture/navigation bar (see native-system-bars.ts).
        // Capacitor's SystemBars.hide() doesn't set a behaviour, so once revealed the
        // bar would stay up. BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE makes an edge swipe
        // reveal it transiently and then auto-hide again — the immersive-sticky feel
        // of "hidden unless you're gesturing".
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
