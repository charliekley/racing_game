/**
 * TURN relay settings (optional, but needed for "works on any network").
 *
 * Web concept: WebRTC first tries a DIRECT path between the phone and the TV (same Wi-Fi, or through the router).
 * Some networks block that (client isolation, strict routers, mobile data, some Android/Wi-Fi combos). A TURN
 * server is a relay on the internet that both devices CAN reach; the data then goes phone -> relay -> TV.
 * The browser only uses the relay when no direct path works, so on a good Wi-Fi nothing changes.
 *
 * We use Metered.ca's TURN service (free tier is plenty: controller input is tiny). Their API key is MEANT to
 * be used from a web page: it only lets the page fetch short-lived relay passwords, and you can restrict it to
 * your domain in their dashboard. Fill in the two values below to turn it on; leave them empty to skip it.
 *
 * Setup: metered.ca -> sign up (free) -> TURN Server -> create an app -> copy the app name (the part before
 * ".metered.live") and an API key.
 */
export const METERED_APP = 'tiltkart'; // https://tiltkart.metered.live
export const METERED_API_KEY = '0ab8ea9c0f03100b1a533892fb7139e97fc6'; // credential API key (safe for a web page; NOT the account secret key)

/** Free public STUN servers: they only tell a device its public address (several, in case one is down). */
const STUN: RTCIceServer = {
  urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'],
};
/** PeerJS's own free relays: best effort only (often overloaded), used when no Metered key is set. */
const PEERJS_TURN: RTCIceServer = {
  urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
  username: 'peerjs',
  credential: 'peerjsp',
};

/** Keep anything that looks like a valid ICE server entry from the network response (never trust it blindly). */
function cleanServers(x: unknown): RTCIceServer[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((s) => {
    if (typeof s !== 'object' || s === null) return [];
    const o = s as Record<string, unknown>;
    const urls = typeof o.urls === 'string' ? [o.urls] : Array.isArray(o.urls) ? o.urls.filter((u) => typeof u === 'string') : [];
    if (!urls.every((u) => /^(stun|turns?):/.test(u)) || urls.length === 0) return [];
    const out: RTCIceServer = { urls };
    if (typeof o.username === 'string') out.username = o.username;
    if (typeof o.credential === 'string') out.credential = o.credential;
    return [out];
  });
}

let cached: { servers: RTCIceServer[]; at: number } | null = null;

/**
 * The ICE servers to use: STUN + (Metered relays if configured, else PeerJS's free relays).
 * Metered passwords are fetched once and reused for 30 minutes; if the fetch fails or takes over 4 s we fall
 * back to the free relays, so a slow network never blocks joining.
 */
export async function iceServers(): Promise<RTCIceServer[]> {
  if (!METERED_APP || !METERED_API_KEY) return [STUN, PEERJS_TURN];
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.servers;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const url = `https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(METERED_API_KEY)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const relays = cleanServers(await res.json());
    if (relays.length === 0) throw new Error('no relay servers in the answer');
    cached = { servers: [STUN, ...relays], at: Date.now() };
    return cached.servers;
  } catch (err) {
    console.warn('TURN relay unavailable, using the free fallback', err);
    return [STUN, PEERJS_TURN];
  }
}
