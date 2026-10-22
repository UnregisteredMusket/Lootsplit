import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { DM_SEAT, resumedPlayerSeat, type Seat } from "./table.ts";
import { chatSenderPurseId } from "./chat-composer.ts";

// The campaign gate starts every reloaded player document with this seat.
const gateSeat: Seat = { role: "player", purseIds: [], shopIds: [], openedAt: 1 };

test("a resumed player session restores the seat's characters from the saved ticket", () => {
  const seat = resumedPlayerSeat(gateSeat, { role: "player", purseIds: ["other"] });
  assert.deepEqual(seat?.purseIds, ["other"]);
  assert.equal(seat?.role, "player");
  assert.equal(seat?.elevated, false);
  // Party chat can then name its sender before any room data has loaded.
  assert.equal(chatSenderPurseId(seat!.purseIds, []), "other");
  assert.equal(chatSenderPurseId(gateSeat.purseIds, []), "", "the unrestored seat is refused");
});

test("resume never grants a seat that the saved session does not describe", () => {
  assert.equal(resumedPlayerSeat(DM_SEAT, { role: "dm", purseIds: [] }), null);
  assert.equal(resumedPlayerSeat(gateSeat, { role: "dm", purseIds: ["hero"] }), null);
  assert.equal(resumedPlayerSeat(gateSeat, { role: "player", purseIds: [] }), null);
  assert.equal(resumedPlayerSeat(gateSeat, { role: "player" }), null);
  assert.equal(resumedPlayerSeat(gateSeat, null), null);
  assert.deepEqual(
    resumedPlayerSeat(gateSeat, { role: "player", purseIds: ["hero", 7, "", null] })?.purseIds,
    ["hero"],
  );
  const current: Seat = { ...gateSeat, purseIds: ["hero"] };
  assert.equal(resumedPlayerSeat(current, { role: "player", purseIds: ["hero"] }), null);
});

test("actual resumeTable sets the player's seat before the room is published as joined", () => {
  const source = readFileSync(new URL("./cloud-client.ts", import.meta.url), "utf8");
  const body = source.slice(
    source.indexOf("export function resumeTable()"),
    source.indexOf("export function pendingActions()"),
  );
  const events: string[] = [];
  let seat: Seat = gateSeat;
  const resumeTable = new Function(
    "context",
    stripTypeScriptTypes(`
      const {resumedPlayerSeat,events,getSeat,setSeat}=context;
      const localStorage={};
      let sessionKey="";
      const key=()=>"campaign";
      const stopPolling=()=>{};
      const session=()=>({code:"ROOM",seatId:"member",token:"t",role:"player",purseIds:["other"],pending:[]});
      const publish=(patch)=>events.push("publish:"+(patch.joined?"joined":"other")+":"+getSeat().purseIds.join(","));
      const start=()=>events.push("start");
      const serial=()=>Promise.resolve();
      const refresh=()=>{};
      const fail=()=>{};
      ${body.replace("export function", "function")}
    `) + "; return resumeTable;",
  )({
    resumedPlayerSeat,
    events,
    getSeat: () => seat,
    setSeat: (next: Seat) => {
      seat = next;
      events.push("seat:" + next.purseIds.join(","));
    },
  });
  resumeTable();
  assert.deepEqual(events.slice(0, 2), ["seat:other", "publish:joined:other"]);
});
