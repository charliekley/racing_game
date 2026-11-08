/**
 * Procedural textures drawn on a 2D canvas at startup (no image files).
 * Repeating textures give the ground visible detail, which is what makes
 * speed readable on screen.
 */
import * as THREE from 'three';

/** Small deterministic random generator so textures/scenery look the same every load. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function grassTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, n) => {
    ctx.fillStyle = '#5fae4a';
    ctx.fillRect(0, 0, n, n);
    const rnd = seededRandom(1);
    for (let i = 0; i < 2600; i++) {
      const g = 140 + Math.floor(rnd() * 60);
      ctx.fillStyle = `rgb(${70 + rnd() * 30}, ${g}, ${50 + rnd() * 25})`;
      ctx.fillRect(rnd() * n, rnd() * n, 2 + rnd() * 3, 2 + rnd() * 3);
    }
    // Faint mowing stripes
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, n / 2, n);
  });
}

/**
 * Road texture laid out with U across the road (0 = left edge, 1 = right edge)
 * and V along it. Includes white edge lines and a dashed center line.
 */
export function roadTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, n) => {
    ctx.fillStyle = '#4b4f58';
    ctx.fillRect(0, 0, n, n);
    const rnd = seededRandom(2);
    for (let i = 0; i < 3000; i++) {
      const v = 60 + Math.floor(rnd() * 40);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 8})`;
      ctx.fillRect(rnd() * n, rnd() * n, 2, 2);
    }
    ctx.fillStyle = '#f1f1f1';
    ctx.fillRect(n * 0.03, 0, n * 0.025, n); // edge lines
    ctx.fillRect(n * 0.945, 0, n * 0.025, n);
    ctx.fillRect(n * 0.49, 0, n * 0.02, n * 0.5); // center dash
  });
}

/** Red/white curb stripes along V. */
export function curbTexture(): THREE.CanvasTexture {
  return canvasTexture(64, (ctx, n) => {
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = '#e03a3a';
    ctx.fillRect(0, 0, n, n / 2);
  });
}

export function checkerTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(64, (ctx, n) => {
    const c = n / 8;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
        ctx.fillRect(x * c, y * c, c, c);
      }
  });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
