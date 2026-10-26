package com.unregisteredmusket.lootsplit;

import static org.junit.Assert.*;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Widget discovery and setup (design plan M7/M8): picker previews and the settings screen's choices. */
@RunWith(AndroidJUnit4.class)
public class WidgetSetupTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    private static String allText(View view) {
        StringBuilder out = new StringBuilder();
        if (view instanceof TextView) out.append(((TextView) view).getText()).append('\n');
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) out.append(allText(((ViewGroup) view).getChildAt(i)));
        return out.toString();
    }

    @Test public void pickerPreviewsShowSampleHealthyDataNotSignIn() throws Exception {
        int owner = 0, companion = 0;
        for (AppWidgetProviderInfo info : AppWidgetManager.getInstance(context).getInstalledProviders()) {
            if (!context.getPackageName().equals(info.provider.getPackageName())) continue;
            boolean isOwner = info.provider.getClassName().equals(OwnerWidgetProvider.class.getName());
            // API 24–30 pickers show the image; API 31+ inflate the static preview layout.
            assertEquals(isOwner ? R.drawable.owner_widget_preview_image : R.drawable.companion_widget_preview_image, info.previewImage);
            if (android.os.Build.VERSION.SDK_INT >= 31) assertEquals(isOwner ? R.layout.owner_widget_preview : R.layout.companion_widget_preview, info.previewLayout);
            if (isOwner) owner++; else companion++;
        }
        assertEquals(1, owner); assertEquals(1, companion);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> { try {
            float density = context.getResources().getDisplayMetrics().density;
            for (int[] spec : new int[][]{{R.layout.owner_widget_preview, 300}, {R.layout.companion_widget_preview, 56}}) {
                // As a launcher does: through RemoteViews, at the provider's minimum size.
                FrameLayout parent = new FrameLayout(context);
                View view = new android.widget.RemoteViews(context.getPackageName(), spec[0]).apply(context, parent);
                parent.addView(view);
                int w = Math.round(250 * density), h = Math.round(spec[1] * density);
                parent.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
                parent.layout(0, 0, w, h);
                String text = allText(view);
                assertFalse(text, text.toUpperCase(java.util.Locale.ROOT).contains("SIGN IN"));
                assertTrue(text, spec[0] == R.layout.owner_widget_preview ? text.contains("HEALTHY") : text.contains("Merged #138"));
            }
        } catch (Throwable error) { failure.set(error); } });
        if (failure.get() != null) throw new AssertionError("preview", failure.get());
    }

    @Test public void presetsAreMatchedFromSavedChoicesAndLabelledInWords() throws Exception {
        for (String name : CompanionSettings.PRESETS) assertEquals(name, CompanionSettings.presetOf(CompanionSettings.preset(name).put("theme", "light")));
        // Settings saved before the preset choice was restored (no "charts" key) still match.
        JSONObject development = CompanionSettings.preset("Development"); development.remove("charts");
        assertEquals("Development", CompanionSettings.presetOf(development));
        assertEquals("Custom", CompanionSettings.presetOf(CompanionSettings.preset("Development").put("second", "log")));
        assertEquals(CompanionSettings.DEFAULT_PRESET, CompanionSettings.presetOf(null));
        assertEquals("Overall health", CompanionSettings.label("health"));
        assertEquals("Most severe problem", CompanionSettings.label("incident"));
        for (String value : CompanionSettings.CATEGORIES) assertNotEquals("Every summary has a label", value, CompanionSettings.label(value));
        for (String value : CompanionSettings.THEMES) assertNotEquals(value, CompanionSettings.label(value));
        for (String value : CompanionSettings.CHARTS) assertNotEquals(value, CompanionSettings.label(value));
        for (String name : CompanionSettings.PRESETS) assertNotEquals("Every preset is described", CompanionSettings.presetNote("Custom"), CompanionSettings.presetNote(name));
    }
}
