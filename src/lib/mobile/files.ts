import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

function safeName(filename: string): string {
  const cleaned = filename.replace(/[^\w.-]+/g, "_").replace(/^_+/, "");
  return cleaned || "lootsplit.json";
}

function dismissed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|dismiss/i.test(message);
}

async function writeAndShare(filename: string, data: string, encoding?: Encoding): Promise<boolean> {
  const written = await Filesystem.writeFile({
    path: safeName(filename),
    data,
    directory: Directory.Cache,
    encoding,
  });
  try {
    await Share.share({ title: filename, url: written.uri, dialogTitle: filename });
    return true;
  } catch (error) {
    if (dismissed(error)) return false;
    throw error;
  }
}

export async function saveTextFile(filename: string, text: string): Promise<boolean> {
  return writeAndShare(filename, text, Encoding.UTF8);
}

export async function saveBinaryFile(filename: string, binary: string): Promise<boolean> {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index) & 0xff;
  let raw = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    raw += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return writeAndShare(filename, btoa(raw));
}
