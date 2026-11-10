/// <reference types="vitest/config" />
/**
 * Vite configuration.
 *
 * Web concept: Vite is the dev server + bundler. In dev it serves our TypeScript
 * straight to the browser (compiling on the fly); `vite build` produces static
 * files in dist/ that can be hosted anywhere (we use GitHub Pages).
 *
 * This is a "multi-page app": several HTML entry points
 *   /            -> index.html            (tiny landing page)
 *   /host/       -> host/index.html       (the game, on the TV)
 *   /controller/ -> controller/index.html (the phone controller)
 *   /karts/      -> karts/index.html      (dev page: kart model preview)
 */
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Find this laptop's LAN IPv4 addresses so the host page can put a QR code
 * that phones can actually reach (a phone can't open "localhost" - that would
 * be the phone itself). Home-network ranges (192.168.x) are preferred over
 * virtual adapters (WSL / Hyper-V / Docker usually use 172.x).
 */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  const rank = (ip: string) =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 3 : 2;
  out.sort((a, b) => rank(a) - rank(b));
  // Allow forcing a specific IP: LAN_IP=192.168.1.42 npm run dev
  if (process.env.LAN_IP) out.unshift(process.env.LAN_IP);
  return out;
}

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the site from /<repo-name>/, so the deploy workflow sets
  // BASE_PATH=/racing_game/. Locally it's just "/".
  base: process.env.BASE_PATH ?? '/',
  // Self-signed HTTPS for the dev/preview server: phones refuse motion sensors on
  // plain http. Set NO_SSL=1 to serve plain http (fine for localhost-only testing).
  plugins: command === 'serve' && !process.env.NO_SSL ? [basicSsl()] : [],
  define: {
    __DEV_LAN_HOSTS__: JSON.stringify(command === 'serve' ? lanAddresses() : []),
  },
  server: {
    host: true, // listen on all interfaces so phones on the Wi-Fi can connect
    port: 5173,
    strictPort: true,
    // Allow Cloudflare quick-tunnel hostnames (see README fallback).
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    target: 'es2022',
    // Three.js alone is ~550 kB minified (~150 kB gzipped); that's expected.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        host: `${root}host/index.html`,
        controller: `${root}controller/index.html`,
        karts: `${root}karts/index.html`,
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Some tests simulate whole 3-lap races with four bots. On a busy laptop (or a slow
    // CI runner) those can take longer than Vitest's default 5 s limit, so allow 60 s.
    testTimeout: 60_000,
  },
}));
