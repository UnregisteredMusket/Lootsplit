package com.unregisteredmusket.lootsplit;
import android.content.Context;
final class WidgetAppearance {
    static boolean light(Context context, int id) {
        return CompanionSettings.light(context, CompanionSettings.read(context,id).optString("theme","terminal"));
    }
}
