import { createServerFn } from "@tanstack/react-start";
import type { CloudTable } from "./cloud.ts";
import type { BillFile } from "./table.ts";

export const openCloudTable = createServerFn({ method: "POST" })
  .validator((input: { name: string; table: CloudTable }) => input)
  .handler(async ({ data }) => {
    const { limitRoomEntry } = await import("./room-limits.server.ts");
    await limitRoomEntry("open");
    const { openRoom } = await import("./cloud.server.ts");
    return openRoom(data);
  });

export const previewCloudTable = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => input)
  .handler(async ({ data }) => {
    const { limitRoomEntry } = await import("./room-limits.server.ts");
    await limitRoomEntry("lookup");
    const { previewRoom } = await import("./cloud.server.ts");
    return previewRoom(data.code);
  });

export const joinCloudTable = createServerFn({ method: "POST" })
  .validator((input: { code: string; purseId: string; name: string }) => input)
  .handler(async ({ data }) => {
    const { limitRoomEntry } = await import("./room-limits.server.ts");
    await limitRoomEntry("join");
    const { joinRoom } = await import("./cloud.server.ts");
    return joinRoom(data);
  });

export const pullCloudTable = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string }) => input)
  .handler(async ({ data }) => {
    const { roomState } = await import("./cloud.server.ts");
    return roomState(data);
  });

export const finishCloudTurn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      code: string;
      token: string;
      baseRevision?: number;
      table?: CloudTable;
      bill?: BillFile;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { publishTurn } = await import("./cloud.server.ts");
    return publishTurn(data);
  });

export const setCloudPace = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string; live: boolean }) => input)
  .handler(async ({ data }) => {
    const { choosePace } = await import("./cloud.server.ts");
    return choosePace(data);
  });

export const closeCloudTable = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string }) => input)
  .handler(async ({ data }) => {
    const { closeRoom } = await import("./cloud.server.ts");
    await closeRoom(data);
  });

export const skipCloudTurn = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string }) => input)
  .handler(async ({ data }) => {
    const { passTurn } = await import("./cloud.server.ts");
    return passTurn(data);
  });

export const submitCloudCommands = createServerFn({ method: "POST" })
  .validator(
    (input: {
      code: string;
      token: string;
      batchId: string;
      commands: unknown[];
      endTurn?: boolean;
      stage?: boolean;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { submitCommands } = await import("./cloud.server.ts");
    return submitCommands(data);
  });
export const manageCloudRoom = createServerFn({ method: "POST" })
  .validator(
    (input: {
      code: string;
      token: string;
      action: "release" | "permission" | "start" | "discard";
      seatId: string;
      allowParty?: boolean;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { manageRoom } = await import("./cloud.server.ts");
    return manageRoom(data);
  });

export const getRoomPushSettings = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string; endpoint?: string }) => input)
  .handler(async ({ data }) => { const { pushSettings } = await import("./push.server.ts"); return pushSettings(data); });
export const updateRoomPushSubscription = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string; endpoint: string; enabled: boolean }) => input)
  .handler(async ({ data }) => { const { setPushSubscription } = await import("./push.server.ts"); return setPushSubscription(data); });
