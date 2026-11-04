// The total-size warning threshold, measured for a small live campaign with many archived sessions
// (archived sessions cost more memory per byte: they are projected one by one). The case is in
// room-memory-warning-case.mjs. Disposable local database only.
import { thresholdCase } from "./room-memory-warning-case.mjs";

thresholdCase("a small live campaign", 1_000_000);
