import release from './release.json';

/** Fixed, checksum-verified release proxy. Never accepts a URL or filename from the request. */
export async function androidDownload(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const headers = {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${release.filename}"`,
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'X-Release-SHA256': release.sha256,
  };
  try {
    const upstream = await fetcher(release.apkUrl, { signal: AbortSignal.timeout(25000), headers: { Accept: 'application/octet-stream' } });
    if (!upstream.ok) throw new Error('Release unavailable');
    const bytes = await upstream.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== release.sha256) throw new Error('Release checksum mismatch');
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: { ...headers, 'Content-Length': String(bytes.byteLength) } });
  } catch {
    return new Response('The Android download is temporarily unavailable. Return to /downloads and use the GitHub download link, or try again later.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' } });
  }
}
