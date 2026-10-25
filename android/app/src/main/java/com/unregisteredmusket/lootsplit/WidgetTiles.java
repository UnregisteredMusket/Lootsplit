package com.unregisteredmusket.lootsplit;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.widget.RemoteViews;
import java.text.NumberFormat;
import java.util.Calendar;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * At a glance tiles (Traffic, Plan usage, Deploys · main, Players now) and the report/agent strip
 * of the Field monitor list (redesign approved 2026-10-25). Tiles sit two to a row; tapping one
 * expands it across both columns (stable IDs glance:*, kept in {@link WidgetRowState}). The
 * Traffic tile's 24h/7d toggle is stored there too ("range:traffic=7d"). Expanding or toggling only
 * re-renders the stored reading; it never fetches.
 */
final class WidgetTiles {
    private WidgetTiles() { }
    static final String TRAFFIC = "glance:traffic", USAGE = "glance:usage", DEPLOYS = "glance:deploys", PLAYERS = "glance:players";
    static final String RANGE_7D = "range:traffic=7d", RANGE_24H = "range:traffic=24h";
    static final String[] ORDER = {TRAFFIC, USAGE, DEPLOYS, PLAYERS};

    /** Adds the tile rows: consecutive compact tiles share a row; an expanded tile takes a whole row. */
    static void add(JSONArray rows, JSONObject snapshot, Set<String> expanded) throws Exception {
        JSONArray pending = new JSONArray();
        for (String id : ORDER) {
            JSONObject tile = tile(snapshot, id, expanded);
            if (tile.optBoolean("expanded")) {
                if (pending.length() > 0) { rows.put(row(pending)); pending = new JSONArray(); }
                rows.put(row(new JSONArray().put(tile)));
            } else {
                pending.put(tile);
                if (pending.length() == 2) { rows.put(row(pending)); pending = new JSONArray(); }
            }
        }
        if (pending.length() > 0) rows.put(row(pending));
    }
    private static JSONObject row(JSONArray tiles) throws Exception {
        JSONArray ids = new JSONArray();
        StringBuilder id = new StringBuilder("tiles:");
        for (int i = 0; i < tiles.length(); i++) { ids.put(tiles.getJSONObject(i).getString("id")); id.append(i == 0 ? "" : ",").append(tiles.getJSONObject(i).getString("id").substring(7)); }
        return new JSONObject().put("kind", "tiles").put("id", id.toString()).put("ids", ids).put("tiles", tiles).put("title", "At a glance");
    }
    static boolean sevenDays(Set<String> expanded) { return expanded != null && expanded.contains(RANGE_7D); }

    private static Long[] longs(JSONArray values) {
        if (values == null) return null;
        Long[] out = new Long[values.length()];
        for (int i = 0; i < values.length(); i++) { Object v = values.opt(i); out[i] = v instanceof Number ? ((Number) v).longValue() : null; }
        return out;
    }
    private static String sum(Long[] values) {
        long total = 0; boolean any = false;
        if (values != null) for (Long v : values) if (v != null) { total += v; any = true; }
        return any ? WidgetRows.compact(total) : "—";
    }
    private static String dayLetter(String day) { String name = dayName(day); return name.isEmpty() ? "·" : name.substring(0, 1); }
    private static String dayName(String day) {
        try {
            String[] parts = day.split("-");
            Calendar c = Calendar.getInstance(); c.clear(); c.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]), 12, 0);
            return new java.text.SimpleDateFormat("EEE", Locale.getDefault()).format(c.getTime());
        } catch (Exception ignored) { return day; }
    }

    /** One tile's text and chart inputs (rendered by {@link #view}). Missing data stays an explicit gap. */
    static JSONObject tile(JSONObject snapshot, String id, Set<String> expanded) throws Exception {
        boolean open = expanded != null && expanded.contains(id);
        JSONObject tile = new JSONObject().put("id", id).put("expanded", open);
        JSONObject series = snapshot.optJSONObject("series");
        String seriesState = series == null ? "" : series.optString("state");
        boolean charts = "ready".equals(seriesState);
        // No series object: a reading stored by the previous app version; "absent": an older server.
        String chartGap = series == null ? "Charts appear after the next refresh" : "absent".equals(seriesState) ? "Charts need a server update" : charts ? "" : "Chart unavailable" + (series.optString("errorCode").isEmpty() ? "" : " · " + series.optString("errorCode"));
        switch (id) {
            case TRAFFIC: {
                long[] counts = WidgetRows.traffic(snapshot);
                boolean week = open && sevenDays(expanded);
                tile.put("key", open ? "Traffic · requests" : "Traffic 24h").put("toggle", open).put("range", week ? "7d" : "24h").put("action", "logs");
                String errorsState = snapshot.optString("errorsState");
                tile.put("errorColor", counts != null && counts[1] > 0 ? ("warning".equals(errorsState) ? "yellow" : "healthy".equals(errorsState) ? "" : "red") : "");
                if (!week) {
                    tile.put("value", counts == null ? "—" : WidgetRows.compact(counts[0]) + (open ? " req / 24h" : " req")).put("errors", counts == null ? "" : WidgetRows.compact(counts[1]) + " err");
                    if (charts) {
                        tile.put("chart", "spark").put("requests", series.optJSONArray("requests")).put("errorSeries", series.optJSONArray("errors"));
                        int measured = series.optInt("measured", 0);
                        tile.put("note1", open ? "Measured " + measured + " of 48 half-hours · errors on their own baseline" : measured < 48 ? measured + "/48 half-hours measured" : "");
                        if (open) tile.put("axis", new JSONArray().put("-24h").put("-12h").put("now")).put("note2", "Tap 7d for requests and errors per day");
                    } else tile.put("note1", counts == null ? snapshot.optString("traffic") : chartGap);
                    tile.put("description", "Requests in the past 24 hours: " + (counts == null ? snapshot.optString("traffic") : counts[0] + ", errors: " + counts[1]) + (charts ? ". Chart of requests per half-hour with errors on their own baseline" : ". " + chartGap));
                } else {
                    JSONArray daily = charts ? series.optJSONArray("daily") : null;
                    if (daily == null || daily.length() == 0) {
                        tile.put("value", "—").put("note1", charts ? "No daily readings" : chartGap).put("description", "Requests per day unavailable");
                    } else {
                        Long[] requests = new Long[daily.length()], errors = new Long[daily.length()];
                        JSONArray partial = new JSONArray(), letters = new JSONArray();
                        long busiest = -1; String busiestDay = "";
                        StringBuilder perDay = new StringBuilder();
                        for (int i = 0; i < daily.length(); i++) {
                            JSONObject day = daily.getJSONObject(i);
                            Object r = day.opt("requests"), e = day.opt("errors");
                            requests[i] = r instanceof Number ? ((Number) r).longValue() : null;
                            errors[i] = e instanceof Number ? ((Number) e).longValue() : null;
                            partial.put(day.optInt("measured") < day.optInt("expected"));
                            letters.put(dayLetter(day.optString("day")));
                            if (requests[i] != null && requests[i] > busiest) { busiest = requests[i]; busiestDay = dayName(day.optString("day")); }
                            perDay.append(i == 0 ? "" : " ").append(errors[i] == null ? "—" : Long.toString(errors[i]));
                        }
                        JSONArray values = new JSONArray(); for (Long v : requests) values.put(v == null ? JSONObject.NULL : v);
                        Long today = requests[requests.length - 1];
                        tile.put("value", sum(requests) + " req / 7 days · " + sum(errors) + " err" + (today == null ? "" : " · today " + WidgetRows.compact(today)));
                        tile.put("chart", "bars").put("values", values).put("partial", partial).put("days", letters);
                        tile.put("note1", busiest >= 0 ? "Busiest " + busiestDay + " " + WidgetRows.compact(busiest) : "No measured day");
                        tile.put("note2", "Errors per day: " + perDay + " · dot = partial day");
                        tile.put("description", "Requests per day for 7 days, " + sum(requests) + " in total; errors per day " + perDay);
                    }
                }
                break;
            }
            case USAGE: {
                JSONObject usage = snapshot.optJSONObject("usage");
                boolean ready = usage != null && "ready".equals(usage.optString("state"));
                tile.put("key", "Plan usage · cycle").put("action", "logs").put("usage", true);
                if (!ready) {
                    tile.put("note1", usage == null ? "Unavailable in this reading" : usage.optString("reason", "Cloudflare usage unavailable")).put("gauges", new JSONArray());
                    tile.put("description", "Cloudflare plan usage: " + tile.optString("note1"));
                    break;
                }
                JSONArray gauges = usage.optJSONArray("gauges");
                tile.put("gauges", gauges == null ? new JSONArray() : gauges);
                double elapsed = usage.optDouble("elapsed", -1);
                tile.put("pace", elapsed);
                String label = usage.optString("cycleLabel");
                tile.put("note1", elapsed >= 0 ? "│ pace: " + WidgetData.percent(elapsed) + " of " + (label.isEmpty() ? "month" : "cycle") + (label.startsWith("Cycle since ") ? " (" + label.substring(12) + "→)" : "") : "Pace unavailable");
                StringBuilder detail = new StringBuilder(), spoken = new StringBuilder("Cloudflare plan usage, billing cycle to date: ");
                JSONArray rows = usage.optJSONArray("rows");
                if (rows != null) for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.getJSONObject(i); detail.append(i == 0 ? "" : "\n").append(row.optString("title")).append("\n  ").append(row.optString("detail").replace("\n", "\n  ")); }
                if (gauges != null) for (int i = 0; i < gauges.length(); i++) { JSONObject g = gauges.getJSONObject(i); spoken.append(g.optString("label")).append(" ").append(g.optString("text")).append(g.optBoolean("hot") ? " (80% or more)" : "").append(", "); }
                tile.put("detail", detail.toString()).put("description", spoken + (elapsed >= 0 ? "cycle elapsed " + WidgetData.percent(elapsed) : "pace unknown"));
                break;
            }
            case DEPLOYS: {
                tile.put("key", "Deploys · main").put("action", "activity");
                JSONArray runs = snapshot.optJSONArray("mainRuns");
                JSONObject activity = snapshot.optJSONObject("activity");
                int running = activity != null && "ready".equals(activity.optString("state")) ? activity.optInt("active") : 0;
                String commit = snapshot.optString("commit");
                long deployed = snapshot.optLong("deployedAt", 0);
                tile.put("note1", "Live " + commit + (deployed > 0 ? " · deployed " + WidgetRows.clock(deployed) : ""));
                if (runs == null) {
                    tile.put("pips", "").put("note2", series == null ? "Run history appears after the next refresh" : "absent".equals(seriesState) ? "Run history needs a server update" : "Run history unavailable (GitHub)");
                    tile.put("description", "Main runs: " + tile.optString("note2") + ". " + tile.optString("note1"));
                    break;
                }
                int shown = Math.min(runs.length(), open ? 20 : 11);
                JSONArray pips = new JSONArray();
                for (int i = shown - 1; i >= 0; i--) pips.put(runs.getJSONObject(i).optString("conclusion"));
                if (running > 0) pips.put("running");
                tile.put("pipStates", pips);
                JSONObject latest = runs.length() > 0 ? runs.getJSONObject(0) : null;
                JSONObject event = WidgetRows.latestActivity(snapshot);
                tile.put("note2", running > 0 && event != null && "active".equals(event.optString("state")) ? "• " + event.optString("text") : latest == null ? "No completed runs on main" : "Last: " + latest.optString("name") + " " + pip(latest.optString("conclusion")) + " " + WidgetRows.clock(latest.optLong("at")));
                if (open) {
                    StringBuilder detail = new StringBuilder();
                    for (int i = 0; i < Math.min(20, runs.length()); i++) { JSONObject run = runs.getJSONObject(i); detail.append(i == 0 ? "" : "\n").append(pip(run.optString("conclusion"))).append(" ").append(run.optString("name")).append(" · ").append(WidgetRows.clock(run.optLong("at"))); }
                    tile.put("detail", detail.toString());
                }
                int failed = 0; for (int i = 0; i < shown; i++) if ("✕".equals(pip(runs.getJSONObject(i).optString("conclusion")))) failed++;
                tile.put("description", "Last " + shown + " completed main runs: " + (shown - failed) + " passed or finished, " + failed + " failed" + (running > 0 ? ", " + running + " running" : "") + ". " + tile.optString("note1"));
                break;
            }
            default: {
                tile.put("key", "Players now").put("action", "logs");
                String online = snapshot.optString("active", "—");
                JSONObject rooms = snapshot.optJSONObject("rooms");
                String roomState = rooms == null ? "" : rooms.optString("state");
                String live = "ready".equals(roomState) ? rooms.optLong("live") + (rooms.optLong("live") == 1 ? " live room" : " live rooms") : rooms == null ? "live rooms after refresh" : "absent".equals(roomState) ? "live rooms: update server" : "live rooms —";
                tile.put("value", online + " online").put("valueNote", live);
                JSONArray daily = charts ? series.optJSONArray("daily") : null;
                Long[] active = null;
                if (daily != null) { active = new Long[daily.length()]; for (int i = 0; i < daily.length(); i++) { Object v = daily.getJSONObject(i).opt("active"); active[i] = v instanceof Number ? ((Number) v).longValue() : null; } }
                long peak = -1; StringBuilder perDay = new StringBuilder();
                if (active != null) for (int i = 0; i < active.length; i++) { if (active[i] != null) peak = Math.max(peak, active[i]); perDay.append(i == 0 ? "" : " ").append(active[i] == null ? "—" : Long.toString(active[i])); }
                if (active != null) {
                    JSONArray values = new JSONArray(); for (Long v : active) values.put(v == null ? JSONObject.NULL : v);
                    tile.put("chart", "bars").put("values", values);
                    tile.put("note1", "7d active accounts" + (peak >= 0 ? " · peak " + peak : ""));
                } else tile.put("note1", chartGap);
                tile.put("note2", snapshot.optString("campaigns", "—") + " campaigns · " + snapshot.optString("accounts", "—") + " accounts");
                if (open) tile.put("detail", "Online now " + online + " (signed in within 5 minutes)\nLive rooms " + ("ready".equals(roomState) ? Long.toString(rooms.optLong("live")) : "—") + " (a stored change within 5 minutes)\nCampaigns " + snapshot.optString("campaigns", "—") + " · Accounts " + snapshot.optString("accounts", "—") + " · Backups " + snapshot.optString("backups", "—")
                    + (active != null ? "\nActive accounts per day (24h peak): " + perDay : ""));
                tile.put("description", online + " accounts online, " + live + ", " + snapshot.optString("campaigns", "—") + " campaigns" + (active != null ? ". Active accounts per day: " + perDay : ""));
            }
        }
        return tile;
    }

    static String pip(String conclusion) {
        switch (conclusion == null ? "" : conclusion) {
            case "success": case "neutral": return "✓";
            case "failure": case "timed_out": case "startup_failure": return "✕";
            case "running": return "•";
            case "skipped": return "–";
            default: return "!";
        }
    }
    /** "✓✓✕✓•": one glyph per run, oldest first, each in its status colour (shape and glyph carry the meaning). */
    static CharSequence pips(JSONArray states, WidgetCharts.Palette p) {
        SpannableStringBuilder out = new SpannableStringBuilder();
        if (states == null) return out;
        for (int i = 0; i < states.length(); i++) {
            String glyph = pip(states.optString(i));
            int color = "✓".equals(glyph) ? p.ok : "✕".equals(glyph) ? p.crit : "–".equals(glyph) ? p.faint : p.warn;
            int start = out.length();
            out.append(glyph);
            out.setSpan(new ForegroundColorSpan(color), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return out;
    }

    /** The report/agent strip: daily report coverage and the development task (with its timer) or GitHub activity. */
    static JSONObject strip(JSONObject snapshot) throws Exception {
        JSONObject out = new JSONObject().put("kind", "strip").put("id", "strip").put("title", "Daily report and agent activity");
        String report = snapshot.optString("report", "No daily report yet");
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d+) of (\\d+) scheduled intervals observed").matcher(report);
        int gaps = snapshot.optInt("reportGaps", -1);
        String day = snapshot.optString("reportDay");
        String dayText = day.isEmpty() ? "" : dayName(day) + " " + day.substring(Math.max(0, day.length() - 5)).replace('-', '/');
        boolean found = m.find();
        String reportLine = found ? (gaps > 0 ? "! " : "✓ ") + dayText + " · " + m.group(1) + "/" + m.group(2) + " intervals" + (gaps >= 0 ? " · " + gaps + (gaps == 1 ? " gap" : " gaps") : "") : report;
        out.put("report", reportLine).put("reportColor", found ? (gaps > 0 ? "yellow" : "green") : "");
        JSONObject task = snapshot.optJSONObject("task");
        if (task != null && task.optBoolean("active")) {
            out.put("agent", "▶ " + task.optString("state").toUpperCase(Locale.ROOT) + " · " + task.optString("phase")).put("agentColor", "").put("agentAction", "task")
                .put("timerStart", task.optLong("startedAt")).put("timerEnd", task.optLong("completedAt", 0));
        } else {
            JSONObject activity = snapshot.optJSONObject("activity"), latest = WidgetRows.latestActivity(snapshot);
            int running = activity != null && "ready".equals(activity.optString("state")) ? activity.optInt("active") : 0;
            String text = latest == null ? WidgetRows.activityStatus(snapshot) : (running > 0 ? "• " + running + " running · " : WidgetRows.glyph(WidgetRows.activityColor(latest)) + " ") + latest.optString("text") + " · " + WidgetRows.clock(latest.optLong("at"));
            out.put("agent", text).put("agentColor", running > 0 ? "yellow" : latest == null ? "" : WidgetRows.activityColor(latest)).put("agentAction", "activity");
            if (task != null) out.put("timerStart", task.optLong("startedAt")).put("timerEnd", task.optLong("completedAt", 0)).put("timerIdle", true);
        }
        return out;
    }

    // ---------------------------------------------------------------- rendering

    static RemoteViews tilesRow(Context context, JSONObject row, int id, boolean light) throws Exception {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.owner_widget_tiles);
        WidgetCharts.Palette p = WidgetCharts.Palette.of(light);
        view.setInt(R.id.widget_row, "setBackgroundColor", p.background);
        JSONArray tiles = row.getJSONArray("tiles");
        view.removeAllViews(R.id.tiles_a); view.removeAllViews(R.id.tiles_b);
        view.addView(R.id.tiles_a, view(context, tiles.getJSONObject(0), p));
        if (tiles.length() > 1) { view.setViewVisibility(R.id.tiles_b, View.VISIBLE); view.addView(R.id.tiles_b, view(context, tiles.getJSONObject(1), p)); }
        else view.setViewVisibility(R.id.tiles_b, View.GONE);
        StringBuilder spoken = new StringBuilder();
        for (int i = 0; i < tiles.length(); i++) spoken.append(i == 0 ? "" : ". ").append(tiles.getJSONObject(i).optString("description"));
        view.setContentDescription(R.id.widget_row, spoken.toString());
        return view;
    }

    /** One tile as a nested RemoteViews. Its root toggles the tile; the 24h/7d segments set the range. */
    static RemoteViews view(Context context, JSONObject tile, WidgetCharts.Palette p) throws Exception {
        boolean usage = tile.optBoolean("usage"), open = tile.optBoolean("expanded");
        RemoteViews view = new RemoteViews(context.getPackageName(), usage ? R.layout.owner_widget_tile_usage : R.layout.owner_widget_tile);
        float density = context.getResources().getDisplayMetrics().density;
        view.setInt(R.id.tile_root, "setBackgroundResource", open ? (p.light ? R.drawable.item_tile_outlined_light : R.drawable.item_tile_outlined_dark) : (p.light ? R.drawable.item_tile_light : R.drawable.item_tile_dark));
        view.setTextViewText(R.id.tile_key, tile.optString("key").toUpperCase(Locale.ROOT));
        view.setTextColor(R.id.tile_key, p.faint);
        view.setTextViewText(R.id.tile_chevron, open ? "▴" : "▾"); view.setTextColor(R.id.tile_chevron, p.faint);
        view.setTextColor(R.id.tile_note1, p.muted);
        view.setTextViewText(R.id.tile_note1, tile.optString("note1"));
        view.setViewVisibility(R.id.tile_note1, tile.optString("note1").isEmpty() ? View.GONE : View.VISIBLE);
        view.setTextColor(R.id.tile_detail, p.muted);
        view.setViewVisibility(R.id.tile_detail, open && !tile.optString("detail").isEmpty() ? View.VISIBLE : View.GONE);
        view.setTextViewText(R.id.tile_detail, tile.optString("detail"));
        view.setContentDescription(R.id.tile_root, tile.optString("description") + (open ? ". Expanded; tap to collapse." : ". Tap to expand."));
        view.setOnClickFillInIntent(R.id.tile_root, new Intent().putExtra(OwnerWidgetProvider.ROW_ID, tile.optString("id")));
        if (usage) { gauges(view, tile, p); return view; }
        // Value line: "15.5k req · 12 err" with the error count in its status colour.
        SpannableStringBuilder value = new SpannableStringBuilder(tile.optString("value", "—"));
        value.setSpan(new ForegroundColorSpan(p.ink), 0, value.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        String errors = tile.optString("errors"), note = tile.optString("valueNote");
        if (!errors.isEmpty() || !note.isEmpty()) {
            value.append(" · ");
            int start = value.length();
            value.append(errors.isEmpty() ? note : errors);
            String errorColor = tile.optString("errorColor");
            value.setSpan(new ForegroundColorSpan(errors.isEmpty() || errorColor.isEmpty() ? p.muted : "red".equals(errorColor) ? p.crit : p.warn), start, value.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        view.setTextViewText(R.id.tile_value, value);
        view.setViewVisibility(R.id.tile_value, tile.has("value") ? View.VISIBLE : View.GONE);
        view.setTextColor(R.id.tile_note2, p.muted);
        view.setTextViewText(R.id.tile_note2, tile.optString("note2"));
        view.setViewVisibility(R.id.tile_note2, tile.optString("note2").isEmpty() ? View.GONE : View.VISIBLE);
        // Pips (Deploys).
        JSONArray pipStates = tile.optJSONArray("pipStates");
        view.setViewVisibility(R.id.tile_pips, pipStates == null ? View.GONE : View.VISIBLE);
        if (pipStates != null) { view.setTextViewText(R.id.tile_pips, pips(pipStates, p)); view.setContentDescription(R.id.tile_pips, tile.optString("description")); }
        // Charts.
        String chart = tile.optString("chart");
        int target = open ? R.id.tile_chart_large : R.id.tile_chart, other = open ? R.id.tile_chart : R.id.tile_chart_large;
        view.setViewVisibility(other, View.GONE);
        Bitmap bitmap = null;
        if ("spark".equals(chart)) bitmap = WidgetCharts.sparkline(longs(tile.optJSONArray("requests")), longs(tile.optJSONArray("errorSeries")), open ? 330 : 150, open ? 46 : 30, density, p);
        else if ("bars".equals(chart)) {
            JSONArray partial = tile.optJSONArray("partial");
            boolean[] marks = null;
            if (partial != null) { marks = new boolean[partial.length()]; for (int i = 0; i < marks.length; i++) marks[i] = partial.optBoolean(i); }
            bitmap = WidgetCharts.bars(longs(tile.optJSONArray("values")), marks, open ? 330 : 150, open ? 46 : 30, density, p, p.bar);
        }
        view.setViewVisibility(target, bitmap == null ? View.GONE : View.VISIBLE);
        if (bitmap != null) { view.setImageViewBitmap(target, bitmap); view.setContentDescription(target, tile.optString("description")); }
        // Axis (24h) or day letters (7d), as real text rather than text drawn into the bitmap.
        JSONArray axis = tile.optJSONArray("axis"), days = tile.optJSONArray("days");
        view.setViewVisibility(R.id.tile_axis, axis == null || !open ? View.GONE : View.VISIBLE);
        if (axis != null) { int[] ids = {R.id.tile_axis_start, R.id.tile_axis_mid, R.id.tile_axis_end}; for (int i = 0; i < 3; i++) { view.setTextViewText(ids[i], axis.optString(i)); view.setTextColor(ids[i], p.faint); } }
        view.setViewVisibility(R.id.tile_days, days == null || !open ? View.GONE : View.VISIBLE);
        if (days != null) { int[] ids = {R.id.tile_day0, R.id.tile_day1, R.id.tile_day2, R.id.tile_day3, R.id.tile_day4, R.id.tile_day5, R.id.tile_day6}; for (int i = 0; i < 7; i++) { view.setTextViewText(ids[i], days.optString(i, "")); view.setTextColor(ids[i], p.faint); } }
        // 24h / 7d toggle (Traffic, expanded): each segment sets its range; the selected one is highlighted.
        boolean toggle = tile.optBoolean("toggle");
        view.setViewVisibility(R.id.tile_seg_24h, toggle ? View.VISIBLE : View.GONE);
        view.setViewVisibility(R.id.tile_seg_7d, toggle ? View.VISIBLE : View.GONE);
        if (toggle) {
            boolean week = "7d".equals(tile.optString("range"));
            for (int seg : new int[]{R.id.tile_seg_24h, R.id.tile_seg_7d}) {
                boolean on = (seg == R.id.tile_seg_7d) == week;
                view.setInt(seg, "setBackgroundColor", on ? p.line : p.tile);
                view.setTextColor(seg, on ? p.ink : p.muted);
                view.setContentDescription(seg, (seg == R.id.tile_seg_7d ? "Seven days" : "Twenty-four hours") + (on ? ", selected" : ""));
                view.setOnClickFillInIntent(seg, new Intent().putExtra(OwnerWidgetProvider.ROW_ID, seg == R.id.tile_seg_7d ? RANGE_7D : RANGE_24H));
            }
        }
        return view;
    }
    private static final int[][] GAUGE_IDS = {
        {R.id.usage_label0, R.id.usage_bar0, R.id.usage_hot0, R.id.usage_value0},
        {R.id.usage_label1, R.id.usage_bar1, R.id.usage_hot1, R.id.usage_value1},
        {R.id.usage_label2, R.id.usage_bar2, R.id.usage_hot2, R.id.usage_value2},
        {R.id.usage_label3, R.id.usage_bar3, R.id.usage_hot3, R.id.usage_value3}};
    /** ProgressBar gauges (amber at 80% or more of the cycle's allowance; never red) and the pace line. */
    private static void gauges(RemoteViews view, JSONObject tile, WidgetCharts.Palette p) {
        JSONArray gauges = tile.optJSONArray("gauges");
        view.setViewVisibility(R.id.usage_gauges, gauges == null || gauges.length() == 0 ? View.GONE : View.VISIBLE);
        int row = 0;
        for (java.util.Map.Entry<String, String> entry : WidgetData.GAUGES.entrySet()) {
            JSONObject gauge = null;
            if (gauges != null) for (int i = 0; i < gauges.length(); i++) if (entry.getKey().equals(gauges.optJSONObject(i) == null ? "" : gauges.optJSONObject(i).optString("key"))) gauge = gauges.optJSONObject(i);
            int[] ids = GAUGE_IDS[row++];
            Object percent = gauge == null ? null : gauge.opt("percent");
            boolean known = percent instanceof Number, hot = known && gauge.optBoolean("hot");
            int value = known ? (int) Math.round(Math.min(100, Math.max(0, ((Number) percent).doubleValue()))) : 0;
            view.setTextViewText(ids[0], entry.getValue()); view.setTextColor(ids[0], p.muted);
            view.setTextViewText(ids[3], known ? gauge.optString("text") : "—"); view.setTextColor(ids[3], hot ? p.warn : p.ink);
            // An unknown metric has no bar at all (never an empty, zero-looking bar).
            view.setViewVisibility(ids[1], known && !hot ? View.VISIBLE : View.INVISIBLE);
            view.setViewVisibility(ids[2], hot ? View.VISIBLE : View.GONE);
            view.setProgressBar(ids[1], 100, value, false);
            view.setProgressBar(ids[2], 100, value, false);
        }
        Bitmap pace = WidgetCharts.paceStrip(tile.optDouble("pace", -1));
        view.setViewVisibility(R.id.usage_pace, pace == null ? View.GONE : View.VISIBLE);
        if (pace != null) { view.setImageViewBitmap(R.id.usage_pace, pace); view.setInt(R.id.usage_pace, "setColorFilter", p.ink); }
        view.setContentDescription(R.id.usage_gauges, tile.optString("description"));
    }

    static RemoteViews stripRow(Context context, JSONObject row, int id, boolean light) {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.owner_widget_strip);
        WidgetCharts.Palette p = WidgetCharts.Palette.of(light);
        view.setInt(R.id.widget_row, "setBackgroundColor", p.background);
        for (int half : new int[]{R.id.strip_report, R.id.strip_agent}) view.setInt(half, "setBackgroundResource", light ? R.drawable.item_tile_light : R.drawable.item_tile_dark);
        for (int key : new int[]{R.id.strip_report_key, R.id.strip_agent_key}) view.setTextColor(key, p.faint);
        String reportColor = row.optString("reportColor"), agentColor = row.optString("agentColor");
        view.setTextViewText(R.id.strip_report_text, row.optString("report"));
        view.setTextColor(R.id.strip_report_text, "yellow".equals(reportColor) ? p.warn : p.muted);
        view.setContentDescription(R.id.strip_report, "Daily report: " + row.optString("report") + ". Open daily reports");
        view.setTextViewText(R.id.strip_agent_text, row.optString("agent"));
        view.setTextColor(R.id.strip_agent_text, "red".equals(agentColor) ? p.crit : "yellow".equals(agentColor) ? p.warn : p.muted);
        view.setContentDescription(R.id.strip_agent, "Agent activity: " + row.optString("agent"));
        long start = row.optLong("timerStart", 0), end = row.optLong("timerEnd", 0);
        boolean timer = start > 0 && !row.optBoolean("timerIdle");
        view.setViewVisibility(R.id.strip_timer, timer ? View.VISIBLE : View.GONE);
        if (timer) {
            view.setChronometer(R.id.strip_timer, android.os.SystemClock.elapsedRealtime() - Math.max(0, (end > 0 ? end : System.currentTimeMillis()) - start), "%s", end == 0);
            view.setTextColor(R.id.strip_timer, p.ok);
        }
        view.setOnClickFillInIntent(R.id.strip_report, new Intent().putExtra(WidgetActions.DESTINATION, "report"));
        view.setOnClickFillInIntent(R.id.strip_agent, new Intent().putExtra(WidgetActions.DESTINATION, row.optString("agentAction", "activity")));
        return view;
    }

    static String number(long value) { return NumberFormat.getIntegerInstance().format(value); }
}
