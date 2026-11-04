// The total-size warning threshold, measured for the largest live campaign with a few archived
// sessions (the case itself is in room-memory-warning-case.mjs; the small-campaign shape runs in
// room-memory-warning-small.test.mjs so the two run in parallel). Disposable local database only.
import { thresholdCase, ROOM_LIVE_LIMIT } from "./room-memory-warning-case.mjs";

thresholdCase("the largest live campaign", Math.round(ROOM_LIVE_LIMIT * 0.95));
