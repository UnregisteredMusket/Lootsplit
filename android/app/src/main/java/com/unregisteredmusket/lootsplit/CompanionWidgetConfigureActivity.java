package com.unregisteredmusket.lootsplit;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.widget.*;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;

public class CompanionWidgetConfigureActivity extends Activity {
    int widgetId; final Map<String, Spinner> choices = new LinkedHashMap<>();
    private void label(LinearLayout root, String text) { TextView view=new TextView(this); view.setText(text); view.setTextSize(16); view.setPadding(0,16,0,8); root.addView(view); }
    private Spinner choose(LinearLayout root, String key, String name, String[] options, String value) {
        label(root, name); Spinner spinner=new Spinner(this); ArrayAdapter<String> adapter=new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, options); spinner.setAdapter(adapter); spinner.setContentDescription(name);
        for(int i=0;i<options.length;i++) if(options[i].equals(value)) spinner.setSelection(i);
        root.addView(spinner, new LinearLayout.LayoutParams(-1, dp(48))); choices.put(key,spinner); return spinner;
    }
    private int dp(int value) { return Math.round(value*getResources().getDisplayMetrics().density); }
    @Override public void onCreate(Bundle state) {
        setTheme((getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES ? android.R.style.Theme_Material_NoActionBar : android.R.style.Theme_Material_Light_NoActionBar);
        super.onCreate(state); setResult(RESULT_CANCELED);
        widgetId=getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID);
        android.appwidget.AppWidgetProviderInfo info=AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId);
        if (widgetId==AppWidgetManager.INVALID_APPWIDGET_ID || info==null || (!info.provider.getClassName().equals(CompanionWidgetProvider.class.getName()) && !info.provider.getClassName().equals(OwnerWidgetProvider.class.getName()))) { finish(); return; }
        JSONObject settings=CompanionSettings.read(this,widgetId);
        ScrollView scroll=new ScrollView(this); LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(20),dp(16),dp(20),dp(24)); scroll.addView(root); setContentView(scroll);
        boolean companion=info.provider.getClassName().equals(CompanionWidgetProvider.class.getName());
        if (companion) {
        label(root,"Lootsplit 4×1 companion · instance "+widgetId);
        label(root,"Choose two summaries in top-to-bottom order and two toolbar actions. Tap a summary for its full detail. Each widget has independent settings.");
        Spinner presets=choose(root,"preset","Preset",CompanionSettings.PRESETS,"Development");
        Button apply=new Button(this); apply.setText("Apply preset"); root.addView(apply);
        choose(root,"first","First summary",CompanionSettings.CATEGORIES,settings.optString("first"));
        choose(root,"second","Second summary",CompanionSettings.CATEGORIES,settings.optString("second"));
        choose(root,"action1","First toolbar action",WidgetActions.ACTIONS,settings.optString("action1"));
        choose(root,"action2","Second toolbar action",WidgetActions.ACTIONS,settings.optString("action2"));
        apply.setOnClickListener(v -> { JSONObject preset=CompanionSettings.preset(presets.getSelectedItem().toString()); for(String key: new String[]{"first","second","action1","action2"}) { Spinner spinner=choices.get(key); for(int i=0;i<spinner.getCount();i++) if(spinner.getItemAtPosition(i).equals(preset.optString(key))) spinner.setSelection(i); } });
        } else label(root,"Lootsplit Field monitor · instance "+widgetId);
        choose(root,"theme","Appearance",CompanionSettings.THEMES,settings.optString("theme"));
        Button save=new Button(this); save.setText("Save widget"); root.addView(save); save.setOnClickListener(v -> {
            JSONObject next=new JSONObject(); try { for(Map.Entry<String,Spinner> entry: choices.entrySet()) if(!entry.getKey().equals("preset")) next.put(entry.getKey(),entry.getValue().getSelectedItem().toString()); } catch(Exception ignored) { return; }
            CompanionSettings.save(this,widgetId,next); OwnerWidgetProvider.renderAll(this); OwnerWidgetJob.schedule(this);
            setResult(RESULT_OK,new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,widgetId)); finish();
        });
        label(root,"More actions");
        for(String action: WidgetActions.ACTIONS) if(!action.equals("settings")) { Button button=new Button(this); button.setText(WidgetActions.label(action)); root.addView(button); button.setOnClickListener(v -> { try { WidgetActions.pending(this,widgetId,action,true).send(); } catch(Exception ignored) { Toast.makeText(this,"Action unavailable. Open Lootsplit from your launcher.",Toast.LENGTH_LONG).show(); } }); }
        label(root,"Timers show elapsed wall time, not measured effort. Launcher widgets use static status symbols (✓ healthy, ! attention, ✕ failure); continuous flashing is intentionally unsupported. Android may delay background delivery. Logging continues on the backend.");
    }
}
