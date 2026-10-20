package com.unregisteredmusket.lootsplit;
import android.content.Context;
final class WidgetAppearance {
    static boolean light(Context context, int id) {
        String theme=CompanionSettings.read(context,id).optString("theme","terminal");
        return "light".equals(theme) || "system".equals(theme) && (context.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) != android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }
}
