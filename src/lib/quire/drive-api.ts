import { createServerFn } from "@tanstack/react-start";
import type { DriveKind } from "./drive.ts";

export const checkDrive = createServerFn({ method: "POST" }).handler(async () => {
  const { driveStatus } = await import("./drive.server.ts");
  return driveStatus();
});

export const uploadDriveFile = createServerFn({ method: "POST" })
  .validator((input: { kind: DriveKind; name: string; body: string }) => input)
  .handler(async ({ data }) => {
    const { putDriveFile } = await import("./drive.server.ts");
    return putDriveFile(data);
  });
