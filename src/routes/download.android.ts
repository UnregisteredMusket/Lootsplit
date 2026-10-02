import { createFileRoute } from '@tanstack/react-router';
import { androidDownload } from '@/lib/website/android-download';
export const Route = createFileRoute('/download/android')({
  server: { handlers: {
    GET: ({ request }) => androidDownload(request),
    HEAD: ({ request }) => androidDownload(request),
  } },
});
