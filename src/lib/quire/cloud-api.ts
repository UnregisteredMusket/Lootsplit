import { createServerFn } from "@tanstack/react-start";
import type { CloudTable } from "./cloud.ts";
import type { BillFile } from "./table.ts";

export const rollCampaignCharacter = createServerFn({ method: "POST" })
  .validator(
    (input: {
      code: string;
      token: string;
      purseId: string;
      log?: boolean;
      before?: number;
      [key: string]: unknown;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { characterRoll } = await import("./cloud.server.ts");
    return characterRoll(data);
  });

export const openCloudTable = createServerFn({ method: "POST" })
  .validator((input: { name: string; table: CloudTable }) => input)
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { limitRoomEntry } = await import("./room-limits.server.ts");
    await limitRoomEntry("open");
    const { openRoom } = await import("./cloud.server.ts");
    const { currentAccountId } = await import("./member-access.server.ts");
    const userId = await currentAccountId();
    if (!userId) throw Error("Create an account or sign in to proceed as a Dungeon Master in your own campaign");
    return openRoom({ ...data, userId });
  });

export const previewCloudTable = createServerFn({ method: "POST" })
  .validator((input: { code: string; sessionId?: string }) => input)
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { limitRoomEntry } = await import("./room-limits.server.ts");
    await limitRoomEntry("lookup");
    const { previewRoom } = await import("./cloud.server.ts");
    const { currentAccountId } = await import("./member-access.server.ts");
    return previewRoom(data.code, data.sessionId, await currentAccountId());
  });

export const joinCloudTable = createServerFn({ method: "POST" })
  .validator((input: { code: string; purseId: string; name: string; invitation?: string; sessionId?: string }) => input)
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { limitRoomEntry } = await import("./room-limits.server.ts");
    await limitRoomEntry("join");
    const { joinRoom } = await import("./cloud.server.ts");
    const { currentAccountId } = await import("./member-access.server.ts");
    return joinRoom({ ...data, userId: await currentAccountId() });
  });

export const pullCloudTable = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string }) => input)
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
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
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { publishTurn } = await import("./cloud.server.ts");
    return publishTurn(data);
  });

export const setCloudPace = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string; live: boolean }) => input)
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { choosePace } = await import("./cloud.server.ts");
    return choosePace(data);
  });

export const closeCloudTable = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string }) => input)
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { closeRoom } = await import("./cloud.server.ts");
    await closeRoom(data);
  });

export const skipCloudTurn = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string }) => input)
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
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
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { submitCommands } = await import("./cloud.server.ts");
    return submitCommands(data);
  });
export const manageCloudRoom = createServerFn({ method: "POST" })
  .validator(
    (input: {
      code: string;
      token: string;
      action: "release" | "leave" | "kick" | "ban" | "invite" | "permission" | "start" | "discard";
      seatId: string;
      allowParty?: boolean;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { manageRoom } = await import("./cloud.server.ts");
    return manageRoom(data);
  });

export const getRoomPushSettings = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string; endpoint?: string }) => input)
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { pushSettings } = await import("./push.server.ts");
    return pushSettings(data);
  });
export const updateRoomPushSubscription = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string; endpoint: string; enabled: boolean }) => input)
  .handler(async ({ data }) => {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat(data);
    const { setPushSubscription } = await import("./push.server.ts");
    return setPushSubscription(data);
  });
