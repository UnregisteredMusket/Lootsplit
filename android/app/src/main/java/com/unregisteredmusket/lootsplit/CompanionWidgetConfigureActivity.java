package com.unregisteredmusket.lootsplit;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.widget.*;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Widget settings (design plan M7, 2026-10-25): a live preview of this widget at the top, human
 * labels for every choice (the saved values are unchanged), the saved preset restored, a preset
 * applied as soon as it is picked, Save in a bar that stays at the bottom, and the extra app actions
 * in the ⋮ overflow menu. Every earlier option and action is still offered.
 */
public class CompanionWidgetConfigureActivity extends Activity {
    int widgetId;
    /** The choices by setting key ("preset", "first", "second", "charts", "action1", "action2", "theme"). */
    final Map<String, Spinner> choices = new LinkedHashMap<>();
    /** The saved value behind each spinner position (the spinner shows its label). */
    final Map<String, String[]> values = new LinkedHashMap<>();
    /** Shown in the Preset spinner when the choices match no preset. */
    static final String CUSTOM = "Custom";
    boolean companion;
    FrameLayout preview;
    TextView presetNote;
    int placementWidth;
    /** The stored reading, read once for the preview (the preview never fetches). */
    JSONObject stored;
    private int ink, muted, surface;

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, float sp, int color) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(sp); view.setTextColor(color); return view;
    }
    private void label(LinearLayout root, String value) {
        TextView view = text(value, 14, muted); view.setPadding(0, dp(14), 0, dp(4)); root.addView(view);
    }
    /** The saved value at the spinner's current position. */
    String value(String key) {
        Spinner spinner = choices.get(key); String[] options = values.get(key);
        if (spinner == null || options == null) return "";
        int position = spinner.getSelectedItemPosition();
        return position >= 0 && position < options.length ? options[position] : "";
    }
    void select(String key, String value) {
        String[] options = values.get(key); Spinner spinner = choices.get(key);
        if (options == null || spinner == null) return;
        for (int i = 0; i < options.length; i++) if (options[i].equals(value) && spinner.getSelectedItemPosition() != i) spinner.setSelection(i);
    }
    private Spinner choose(LinearLayout root, String key, String name, String[] options, String[] labels, String value) {
        label(root, name);
        Spinner spinner = new Spinner(this);
        spinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, labels));
        spinner.setContentDescription(name);
        choices.put(key, spinner); values.put(key, options);
        for (int i = 0; i < options.length; i++) if (options[i].equals(value)) spinner.setSelection(i);
        root.addView(spinner, new LinearLayout.LayoutParams(-1, dp(48)));
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { changed(key); }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        return spinner;
    }
    /** The settings as they would be saved now (the preset itself is not stored). */
    JSONObject draft() {
        JSONObject next = new JSONObject();
        try { for (String key : choices.keySet()) if (!key.equals("preset")) next.put(key, value(key)); } catch (Exception ignored) { }
        return next;
    }
    /**
     * A picked preset fills in its choices at once (no separate Apply step); changing any choice
     * shows the matching preset, or Custom. Both converge: re-selecting the same position is a no-op.
     */
    void changed(String key) {
        if (companion && key.equals("preset")) {
            String name = value("preset");
            if (!CUSTOM.equals(name)) { JSONObject preset = CompanionSettings.preset(name); for (String field : CompanionSettings.PRESET_FIELDS) select(field, preset.optString(field)); }
        } else if (companion && !key.equals("theme")) select("preset", CompanionSettings.presetOf(draft()));
        if (presetNote != null) presetNote.setText(CompanionSettings.presetNote(value("preset")));
        renderPreview();
    }
    /** Renders this widget with the unsaved choices into the preview (the stored reading, never a fetch). */
    void renderPreview() {
        if (preview == null) return;
        try {
            if (stored == null) stored = WidgetStore.read(this);
            JSONObject state = stored, next = draft();
            RemoteViews remote = companion ? CompanionWidgetProvider.views(this, state, next, widgetId, placementWidth)
                : OwnerWidgetProvider.medium(this, state, widgetId, true, CompanionSettings.light(this, next.optString("theme")));
            preview.removeAllViews();
            View face = remote.apply(this, preview);
            preview.addView(face, new FrameLayout.LayoutParams(-1, -1));
        } catch (Exception error) {
            preview.removeAllViews();
            TextView note = text("Preview unavailable", 13, muted); note.setGravity(Gravity.CENTER);
            preview.addView(note, new FrameLayout.LayoutParams(-1, -1));
        }
    }
    private void runAction(String action) {
        try { WidgetActions.pending(this, widgetId, action, true).send(); }
        catch (Exception ignored) { Toast.makeText(this, "Action unavailable. Open Lootsplitter from your launcher.", Toast.LENGTH_LONG).show(); }
    }
    void save() {
        CompanionSettings.save(this, widgetId, draft()); OwnerWidgetProvider.renderAll(this); OwnerWidgetJob.schedule(this);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)); finish();
    }

    @Override public void onCreate(Bundle state) {
        boolean night = (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        setTheme(night ? android.R.style.Theme_Material_NoActionBar : android.R.style.Theme_Material_Light_NoActionBar);
        ink = night ? Color.rgb(230, 238, 233) : Color.rgb(24, 32, 28); muted = night ? Color.rgb(170, 186, 178) : Color.rgb(70, 84, 77); surface = night ? Color.rgb(28, 32, 30) : Color.rgb(244, 245, 243);
        super.onCreate(state); setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        android.appwidget.AppWidgetProviderInfo info = manager.getAppWidgetInfo(widgetId);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID || info == null || (!info.provider.getClassName().equals(CompanionWidgetProvider.class.getName()) && !info.provider.getClassName().equals(OwnerWidgetProvider.class.getName()))) { finish(); return; }
        JSONObject settings = CompanionSettings.read(this, widgetId);
        companion = info.provider.getClassName().equals(CompanionWidgetProvider.class.getName());
        placementWidth = CompanionWidgetProvider.widthDp(manager.getAppWidgetOptions(widgetId));

        LinearLayout screen = new LinearLayout(this); screen.setOrientation(LinearLayout.VERTICAL);
        // Title bar: name, instance and the ⋮ overflow with the other app actions.
        LinearLayout bar = new LinearLayout(this); bar.setGravity(Gravity.CENTER_VERTICAL); bar.setPadding(dp(20), dp(8), dp(4), dp(4));
        LinearLayout titles = new LinearLayout(this); titles.setOrientation(LinearLayout.VERTICAL);
        TextView title = text(companion ? "4×1 companion settings" : "Field monitor settings", 20, ink); title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        titles.addView(title); titles.addView(text("Lootsplitter widget · instance " + widgetId, 13, muted));
        bar.addView(titles, new LinearLayout.LayoutParams(0, -2, 1));
        TextView more = text("⋮", 24, ink); more.setGravity(Gravity.CENTER); more.setContentDescription("More actions");
        more.setBackgroundResource(android.R.drawable.list_selector_background);
        more.setOnClickListener(v -> {
            PopupMenu menu = new PopupMenu(this, more);
            int index = 0;
            for (String action : WidgetActions.ACTIONS) if (!action.equals("settings")) menu.getMenu().add(0, index++, 0, WidgetActions.label(action));
            menu.setOnMenuItemClickListener(item -> { int i = 0; for (String action : WidgetActions.ACTIONS) if (!action.equals("settings")) { if (i++ == item.getItemId()) { runAction(action); return true; } } return false; });
            menu.show();
        });
        bar.addView(more, new LinearLayout.LayoutParams(dp(48), dp(48)));
        screen.addView(bar);

        // Live preview: this widget with the choices below, drawn from the stored reading. Taps on it do nothing here.
        preview = new FrameLayout(this) { @Override public boolean onInterceptTouchEvent(MotionEvent event) { return true; } };
        preview.setContentDescription("Preview of this widget with the choices below");
        LinearLayout.LayoutParams previewSize = new LinearLayout.LayoutParams(-1, dp(companion ? 64 : 168));
        previewSize.setMargins(dp(16), dp(4), dp(16), dp(8));
        screen.addView(preview, previewSize);

        ScrollView scroll = new ScrollView(this); LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), 0, dp(20), dp(16)); scroll.addView(root);
        screen.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        if (companion) {
            TextView intro = text("Pick a preset, or choose each line and button. Each widget keeps its own settings.", 14, ink);
            root.addView(intro);
            String[] presets = new String[CompanionSettings.PRESETS.length + 1];
            System.arraycopy(CompanionSettings.PRESETS, 0, presets, 0, CompanionSettings.PRESETS.length); presets[presets.length - 1] = CUSTOM;
            String[] presetLabels = presets.clone(); presetLabels[presetLabels.length - 1] = "Custom (your own choices)";
            choose(root, "preset", "Preset", presets, presetLabels, CompanionSettings.presetOf(settings));
            presetNote = text(CompanionSettings.presetNote(CompanionSettings.presetOf(settings)), 13, muted); presetNote.setPadding(0, dp(4), 0, 0);
            root.addView(presetNote);
            choose(root, "first", "Top line", CompanionSettings.CATEGORIES, CompanionSettings.labels(CompanionSettings.CATEGORIES), settings.optString("first"));
            choose(root, "second", "Bottom line", CompanionSettings.CATEGORIES, CompanionSettings.labels(CompanionSettings.CATEGORIES), settings.optString("second"));
            choose(root, "charts", "Charts (24-hour requests and main runs, when the widget is at least 300 dp wide)", CompanionSettings.CHARTS, CompanionSettings.labels(CompanionSettings.CHARTS), settings.optString("charts", "off"));
            choose(root, "action1", "First button", WidgetActions.ACTIONS, WidgetActions.LABELS, settings.optString("action1"));
            choose(root, "action2", "Second button", WidgetActions.ACTIONS, WidgetActions.LABELS, settings.optString("action2"));
        }
        choose(root, "theme", "Appearance", CompanionSettings.THEMES, CompanionSettings.labels(CompanionSettings.THEMES), settings.optString("theme"));
        TextView footnote = text("Tap a line on the widget for its full detail. Timers show elapsed wall time, not measured effort. Widgets use static status symbols (✓ healthy, ! attention, ✕ failure); continuous flashing is intentionally unsupported. Android may delay background delivery; logging continues on the backend.", 12, muted);
        footnote.setPadding(0, dp(20), 0, 0); root.addView(footnote);

        // Sticky bottom bar: Cancel and Save widget stay visible while the choices scroll.
        LinearLayout actions = new LinearLayout(this); actions.setGravity(Gravity.END | Gravity.CENTER_VERTICAL); actions.setPadding(dp(16), dp(8), dp(16), dp(8)); actions.setBackgroundColor(surface);
        Button cancel = new Button(this, null, android.R.attr.borderlessButtonStyle); cancel.setText("Cancel"); cancel.setOnClickListener(v -> finish());
        Button save = new Button(this); save.setText("Save widget"); save.setOnClickListener(v -> save());
        actions.addView(cancel); actions.addView(save);
        screen.addView(actions, new LinearLayout.LayoutParams(-1, -2));

        // Edge-to-edge (targetSdk 35+): keep the title and the Save bar clear of the system bars.
        screen.setOnApplyWindowInsetsListener((view, insets) -> {
            int top, bottom, left, right;
            if (Build.VERSION.SDK_INT >= 30) { android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()); top = bars.top; bottom = bars.bottom; left = bars.left; right = bars.right; }
            else { top = insets.getSystemWindowInsetTop(); bottom = insets.getSystemWindowInsetBottom(); left = insets.getSystemWindowInsetLeft(); right = insets.getSystemWindowInsetRight(); }
            view.setPadding(left, top, right, bottom);
            return insets;
        });
        setContentView(screen);
        renderPreview();
    }
}
