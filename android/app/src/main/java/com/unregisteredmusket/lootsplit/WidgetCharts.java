package com.unregisteredmusket.lootsplit;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/**
 * Field monitor charts, drawn in the app process into bitmaps that RemoteViews carry to the
 * launcher (RemoteViews allow no custom views or host-side Canvas drawing). Pure functions of
 * (values, size, palette): the same input always draws the same pixels, so instrumentation can
 * probe them.
 *
 * Size: bitmaps cross Binder inside the RemoteViews, so charts are drawn at no more than 2x
 * density and as opaque RGB_565 (2 bytes per pixel) on the tile colour. The pace line is an
 * ALPHA_8 strip stretched over the gauges. A null value is a gap: the line breaks and a bar is
 * drawn as a hollow outline, never as zero.
 */
final class WidgetCharts {
    private WidgetCharts() { }
    static final float MAX_SCALE = 2f;

    /** Colours for one widget theme (terminal = dark, parchment = light), opaque. */
    static final class Palette {
        final boolean light; final int background, tile, ink, muted, faint, bar, error, line, warn, ok, info, crit;
        private Palette(boolean light) {
            this.light = light;
            background = light ? Color.rgb(247, 242, 228) : Color.rgb(7, 23, 18);
            // The mockups' translucent tile tint, flattened onto the widget background.
            tile = light ? Color.rgb(234, 232, 217) : Color.rgb(13, 38, 28);
            ink = light ? Color.rgb(32, 72, 51) : Color.rgb(230, 248, 236);
            muted = light ? Color.rgb(32, 72, 51) : Color.rgb(177, 214, 193);
            faint = light ? Color.rgb(85, 104, 90) : Color.rgb(122, 166, 141);
            bar = light ? Color.rgb(60, 138, 98) : Color.rgb(91, 220, 156);
            error = light ? Color.rgb(157, 42, 42) : Color.rgb(244, 114, 114);
            line = light ? Color.rgb(205, 207, 191) : Color.rgb(31, 64, 49);
            warn = light ? Color.rgb(133, 91, 8) : Color.rgb(238, 199, 113);
            ok = light ? Color.rgb(21, 112, 62) : Color.rgb(19, 245, 128);
            info = light ? Color.rgb(42, 93, 143) : Color.rgb(140, 196, 242);
            crit = error;
        }
        static Palette of(boolean light) { return light ? LIGHT : DARK; }
        private Palette(Palette base, int tile) {
            light = base.light; background = base.background; this.tile = tile; ink = base.ink; muted = base.muted; faint = base.faint;
            bar = base.bar; error = base.error; line = base.line; warn = base.warn; ok = base.ok; info = base.info; crit = base.crit;
        }
        /** The same colours drawn straight on the widget background (the 4×1 face has no tiles). */
        Palette onBackground() { return new Palette(this, background); }
        int severity(String severity) {
            return "critical".equals(severity) ? crit : "warning".equals(severity) ? warn : "info".equals(severity) ? info : ok;
        }
    }
    static final Palette DARK = new Palette(false), LIGHT = new Palette(true);

    static float scale(float density) { return Math.max(1f, Math.min(MAX_SCALE, density)); }
    static int px(float dp, float density) { return Math.max(1, Math.round(dp * scale(density))); }

    private static Bitmap canvasBitmap(int w, int h, int fill) {
        Bitmap bitmap = Bitmap.createBitmap(Math.max(1, w), Math.max(1, h), Bitmap.Config.RGB_565);
        bitmap.eraseColor(fill);
        return bitmap;
    }
    private static Paint paint(int color) { Paint p = new Paint(Paint.ANTI_ALIAS_FLAG); p.setColor(color); return p; }
    private static int blend(int a, int b, float t) {
        return Color.rgb(Math.round(Color.red(a) * (1 - t) + Color.red(b) * t), Math.round(Color.green(a) * (1 - t) + Color.green(b) * t), Math.round(Color.blue(a) * (1 - t) + Color.blue(b) * t));
    }
    private static long max(Long[] values, long floor) {
        long out = floor;
        if (values != null) for (Long v : values) if (v != null && v > out) out = v;
        return out;
    }
    /** Height in px of the separate error strip under a sparkline (its own baseline, no second y-scale). */
    static int errorStripPx(float density) { return px(9, density); }

    /**
     * Requests as a line with a soft fill and an end dot; errors, when given, as red bars on their
     * own baseline strip below. Null requests break the line.
     */
    static Bitmap sparkline(Long[] requests, Long[] errors, float widthDp, float heightDp, float density, Palette p) {
        int w = px(widthDp, density), h = px(heightDp, density);
        int strip = errors == null ? 0 : errorStripPx(density);
        int chartH = Math.max(4, h - strip);
        Bitmap bitmap = canvasBitmap(w, h, p.tile);
        Canvas canvas = new Canvas(bitmap);
        float s = scale(density), top = 2 * s, bottom = chartH - 1;
        int n = requests == null ? 0 : requests.length;
        long peak = max(requests, 1);
        if (n > 1) {
            float step = (w - 4 * s) / (n - 1);
            Paint fill = paint(blend(p.tile, p.bar, 0.18f)); fill.setStyle(Paint.Style.FILL);
            Paint stroke = paint(p.bar); stroke.setStyle(Paint.Style.STROKE); stroke.setStrokeWidth(1.6f * s); stroke.setStrokeJoin(Paint.Join.ROUND); stroke.setStrokeCap(Paint.Cap.ROUND);
            Path line = new Path(), area = new Path();
            boolean open = false; float startX = 0, lastX = 0, lastY = 0; boolean any = false;
            for (int i = 0; i <= n; i++) {
                Long v = i < n ? requests[i] : null;
                float x = 2 * s + i * step;
                if (v == null) {
                    if (open) { area.lineTo(lastX, bottom); area.lineTo(startX, bottom); area.close(); open = false; }
                    continue;
                }
                float y = bottom - (v / (float) peak) * (bottom - top);
                if (!open) { line.moveTo(x, y); area.moveTo(x, bottom); area.lineTo(x, y); startX = x; open = true; }
                else { line.lineTo(x, y); area.lineTo(x, y); }
                lastX = x; lastY = y; any = true;
            }
            canvas.drawPath(area, fill);
            canvas.drawPath(line, stroke);
            if (any && requests[n - 1] != null) canvas.drawCircle(lastX, lastY, 2.4f * s, paint(p.bar));
        }
        if (errors != null) {
            float base = chartH + strip - 1;
            Paint rule = paint(p.line); rule.setStrokeWidth(Math.max(1, s));
            canvas.drawLine(0, base, w, base, rule);
            long emax = max(errors, 1);
            float slot = (float) w / Math.max(1, errors.length), bw = Math.max(1.4f * s, slot - s);
            Paint red = paint(p.error);
            for (int i = 0; i < errors.length; i++) {
                Long e = errors[i];
                if (e == null || e <= 0) continue;
                float bh = Math.max(2 * s, e / (float) emax * (strip - 2 * s));
                canvas.drawRoundRect(new RectF(i * slot, base - bh, i * slot + bw, base), s, s, red);
            }
        }
        return bitmap;
    }

    /**
     * Vertical bars with rounded data ends. The last bar (the current day) is full strength, the
     * others slightly lighter. A null value is a hollow outline at the baseline (not measured).
     * Day labels are TextViews under the image. {@code partial[i]} marks a day with missing slots with a small dot above its bar.
     */
    static Bitmap bars(Long[] values, boolean[] partial, float widthDp, float heightDp, float density, Palette p, int color) {
        int w = px(widthDp, density), h = px(heightDp, density);
        float s = scale(density);
        Bitmap bitmap = canvasBitmap(w, h, p.tile);
        Canvas canvas = new Canvas(bitmap);
        int n = values == null ? 0 : values.length;
        if (n == 0) return bitmap;
        float gap = 2 * s, bw = (w - gap * (n - 1)) / n, base = h - 1, room = base - 3 * s;
        long peak = max(values, 1);
        for (int i = 0; i < n; i++) {
            float x = i * (bw + gap);
            Long v = values[i];
            if (v == null) {
                Paint outline = paint(p.faint); outline.setStyle(Paint.Style.STROKE); outline.setStrokeWidth(Math.max(1, s));
                canvas.drawRoundRect(new RectF(x + s, base - 3 * s, x + bw - s, base), s, s, outline);
            } else {
                float bh = Math.max(2 * s, v / (float) peak * room);
                Paint fill = paint(i == n - 1 ? color : blend(p.tile, color, 0.62f));
                canvas.drawRoundRect(new RectF(x, base - bh, x + bw, base), 2 * s, 2 * s, fill);
                if (partial != null && i < partial.length && partial[i]) canvas.drawCircle(x + bw / 2, base - bh - 2 * s, 1.2f * s, paint(p.faint));
            }
        }
        return bitmap;
    }

    /** Errors per half-hour (the incident's last 6 hours) as red bars on a baseline, (axis labels are TextViews). */
    static Bitmap errorBars(Long[] errors, float widthDp, float heightDp, float density, Palette p) {
        int w = px(widthDp, density), h = px(heightDp, density);
        float s = scale(density);
        Bitmap bitmap = canvasBitmap(w, h, p.tile);
        Canvas canvas = new Canvas(bitmap);
        float base = h - 1;
        Paint rule = paint(p.line); rule.setStrokeWidth(Math.max(1, s));
        canvas.drawLine(0, base, w, base, rule);
        int n = errors == null ? 0 : errors.length;
        if (n > 0) {
            float gap = 1.5f * s, bw = (w - gap * (n - 1)) / n;
            long peak = max(errors, 1);
            for (int i = 0; i < n; i++) {
                float x = i * (bw + gap);
                Long e = errors[i];
                if (e == null) {
                    Paint outline = paint(p.faint); outline.setStyle(Paint.Style.STROKE); outline.setStrokeWidth(Math.max(1, s));
                    canvas.drawRoundRect(new RectF(x + s, base - 3 * s, x + bw - s, base), s, s, outline);
                } else if (e > 0) {
                    float bh = Math.max(2 * s, e / (float) peak * (base - 2 * s));
                    canvas.drawRoundRect(new RectF(x, base - bh, x + bw, base), 1.5f * s, 1.5f * s, paint(p.error));
                }
            }
        }
        return bitmap;
    }

    /** Width in px of the pace strip; one column is the tick. Stretched over the gauges (fitXY). */
    static final int PACE_COLUMNS = 80;
    /**
     * The billing-cycle pace mark: a 1 px tall ALPHA_8 strip whose opaque columns sit at the elapsed
     * share of the cycle. An ImageView stretches it over the gauge tracks and tints it with the ink
     * colour, so one tiny bitmap draws the vertical line through every gauge. Null when unknown.
     */
    static Bitmap paceStrip(double percent) {
        if (!Double.isFinite(percent) || percent < 0) return null;
        Bitmap strip = Bitmap.createBitmap(PACE_COLUMNS, 1, Bitmap.Config.ALPHA_8);
        int column = Math.max(0, Math.min(PACE_COLUMNS - 1, (int) Math.round(Math.min(100, percent) / 100d * (PACE_COLUMNS - 1))));
        strip.setPixel(column, 0, Color.argb(220, 0, 0, 0));
        return strip;
    }
}
