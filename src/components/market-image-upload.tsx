import { useState } from "react";
import { Button } from "./ui";

export function MarketImageUpload({
  label,
  value,
  onChange,
  onBusyChange,
  disabled = false,
}: {
  label: string;
  value?: string;
  onChange: (image: string | undefined) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="space-y-2">
      {value ? (
        <img
          src={value}
          alt={`${label} preview`}
          className="max-h-48 w-full rounded-sm object-contain"
        />
      ) : null}
      <label className="block text-sm font-medium">
        {label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy || disabled}
          className="mt-1 block w-full min-w-0 text-sm file:mr-2 file:min-h-11 file:rounded-sm file:border file:border-border file:bg-subtle file:px-3 file:text-fg"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setBusy(true);
            onBusyChange?.(true);
            setError("");
            try {
              if (!/^image\/(png|jpeg|webp)$/.test(file.type))
                throw Error("Choose a PNG, JPEG or WebP image.");
              if (file.size > 10_000_000) throw Error("Choose an image smaller than 10 MB.");
              const bitmap = await createImageBitmap(file);
              try {
                const scale = Math.min(1, 768 / bitmap.width, 600 / bitmap.height);
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                const context = canvas.getContext("2d");
                if (!context) throw Error("This device could not prepare the image.");
                context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                let image = canvas.toDataURL("image/webp", 0.8);
                for (let quality = 0.65; image.length > 100000 && quality >= 0.2; quality -= 0.15)
                  image = canvas.toDataURL("image/webp", quality);
                if (image.length > 100000)
                  throw Error("This image is too detailed. Choose a smaller image.");
                onChange(image);
              } finally {
                bitmap.close();
              }
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "The image could not be read.");
            } finally {
              setBusy(false);
              onBusyChange?.(false);
            }
          }}
        />
      </label>
      <p className="text-sm text-muted">
        Players can see this image. PNG, JPEG or WebP, up to 10 MB.
      </p>
      {busy ? (
        <p role="status" className="text-sm">
          Preparing image…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {value ? (
        <Button variant="ghost" disabled={busy || disabled} onClick={() => onChange(undefined)}>
          Remove image
        </Button>
      ) : null}
    </div>
  );
}
