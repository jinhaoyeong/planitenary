package com.blankcanvas.app;

import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keep Android system bars edge-to-edge and in sync with the in-app theme.
 * Capacitor StatusBar background APIs are ignored on Android 15+, so we paint
 * the decor/window background to match the web theme immediately.
 */
@CapacitorPlugin(name = "AppChrome")
public class AppChromePlugin extends Plugin {

    private static final int LIGHT_CHROME = Color.parseColor("#FAF7F2");
    private static final int DARK_CHROME = Color.parseColor("#14110F");

    @Override
    public void load() {
        super.load();
        applyTheme("light");
    }

    @PluginMethod
    public void sync(PluginCall call) {
        final String theme = call.getString("theme", "light");
        getBridge().executeOnMainThread(() -> {
            applyTheme(theme);
            call.resolve();
        });
    }

    private void applyTheme(String theme) {
        if (getActivity() == null) return;

        final boolean dark = "dark".equalsIgnoreCase(theme);
        final int chrome = dark ? DARK_CHROME : LIGHT_CHROME;
        final Window window = getActivity().getWindow();

        WindowCompat.setDecorFitsSystemWindows(window, false);

        // Transparent system bars so the themed web/decor background shows through.
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.setNavigationBarDividerColor(Color.TRANSPARENT);
        }

        window.getDecorView().setBackgroundColor(chrome);
        if (window.getDecorView().getRootView() != null) {
            window.getDecorView().getRootView().setBackgroundColor(chrome);
        }

        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        // Light bars = dark icons (for light backgrounds); dark bars = light icons.
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }
}
