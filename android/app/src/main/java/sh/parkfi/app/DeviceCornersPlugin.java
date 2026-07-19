package sh.parkfi.app;

import android.content.res.Resources;
import android.os.Build;
import android.view.RoundedCorner;
import android.view.WindowInsets;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reports the physical display's rounded-corner radii so the web layer can draw
 * edge-hugging UI (the bottom nav) concentric with the bezel. Returned values
 * are in dp (== CSS px). See research/device-corner-radius.md.
 *
 * Android 12+ (API 31) has a public per-corner API on WindowInsets. Below that
 * the only signal is the internal `rounded_corner_radius` framework dimen that
 * SystemUI itself uses — OEM-populated, so best-effort with a 0 (square)
 * fallback.
 */
@CapacitorPlugin(name = "DeviceCorners")
public class DeviceCornersPlugin extends Plugin {

    @PluginMethod
    public void getCorners(PluginCall call) {
        // rootWindowInsets must be read from an attached view; hop to the UI
        // thread (plugin methods run on Capacitor's executor thread).
        getActivity().runOnUiThread(() -> {
            float density = getContext().getResources().getDisplayMetrics().density;
            float tl = 0f;
            float tr = 0f;
            float bl = 0f;
            float br = 0f;
            boolean resolved = false;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                WindowInsets insets =
                    getActivity().getWindow().getDecorView().getRootWindowInsets();
                if (insets != null) {
                    tl = cornerRadiusPx(insets, RoundedCorner.POSITION_TOP_LEFT);
                    tr = cornerRadiusPx(insets, RoundedCorner.POSITION_TOP_RIGHT);
                    bl = cornerRadiusPx(insets, RoundedCorner.POSITION_BOTTOM_LEFT);
                    br = cornerRadiusPx(insets, RoundedCorner.POSITION_BOTTOM_RIGHT);
                    resolved = true;
                }
            }

            if (!resolved) {
                int id = Resources.getSystem()
                    .getIdentifier("rounded_corner_radius", "dimen", "android");
                float px = id > 0 ? Resources.getSystem().getDimensionPixelSize(id) : 0f;
                tl = tr = bl = br = px;
            }

            JSObject ret = new JSObject();
            ret.put("topLeft", tl / density);
            ret.put("topRight", tr / density);
            ret.put("bottomLeft", bl / density);
            ret.put("bottomRight", br / density);
            call.resolve(ret);
        });
    }

    /** Null when the corner isn't inside the app window (e.g. multi-window). */
    private static float cornerRadiusPx(WindowInsets insets, int position) {
        RoundedCorner corner = insets.getRoundedCorner(position);
        return corner != null ? corner.getRadius() : 0f;
    }
}
