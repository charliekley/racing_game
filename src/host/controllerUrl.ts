/**
 * Builds the URL that the QR code points phones to.
 *
 * In production (GitHub Pages) that's simply this site's /controller/ page.
 * In local dev the TV page is often opened as https://localhost:5173, which a
 * phone can't reach, so we substitute the laptop's LAN IP (injected by
 * vite.config.ts). Overrides, as query parameters on the host page URL:
 *   ?lan=192.168.1.50                 use a specific LAN IP
 *   ?controllerOrigin=https://x.trycloudflare.com   use a tunnel URL
 */
export function controllerUrl(room: string, loc: Location = location): string {
  const params = new URLSearchParams(loc.search);
  let origin = loc.origin;
  const override = params.get('controllerOrigin');
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(loc.hostname);
  if (override) {
    origin = override.replace(/\/$/, '');
  } else if (isLocal) {
    const ip = params.get('lan') ?? __DEV_LAN_HOSTS__[0];
    if (ip) origin = `${loc.protocol}//${ip}${loc.port ? `:${loc.port}` : ''}`;
  }
  return `${origin}${import.meta.env.BASE_URL}controller/?room=${encodeURIComponent(room)}`;
}
