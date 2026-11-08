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

/** Speckled ground texture in any base color (grass, sand, …). */
export function grassTexture(base = '#5fae4a', seed = 1): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, n) => {
    const c = new THREE.Color(base);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, n, n);
    const rnd = seededRandom(seed);
    const tmp = new THREE.Color();
    for (let i = 0; i < 2600; i++) {
      tmp.copy(c).offsetHSL((rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.14);
      ctx.fillStyle = `#${tmp.getHexString()}`;
      ctx.fillRect(rnd() * n, rnd() * n, 2 + rnd() * 3, 2 + rnd() * 3);
    }
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

/** Yellow/black chevrons for jump ramps (V along the ramp). */
export function rampTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, n) => {
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = '#222';
    for (let k = -1; k < 3; k++) {
      ctx.beginPath();
      const y = k * (n / 2);
      ctx.moveTo(0, y + n * 0.35);
      ctx.lineTo(n / 2, y);
      ctx.lineTo(n, y + n * 0.35);
      ctx.lineTo(n, y + n * 0.55);
      ctx.lineTo(n / 2, y + n * 0.2);
      ctx.lineTo(0, y + n * 0.55);
      ctx.fill();
    }
  });
}

/** Stacked tire barrier: alternating red/white blocks with dark tire bands. */
export function wallTexture(): THREE.CanvasTexture {
  return canvasTexture(64, (ctx, n) => {
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = '#d33';
    ctx.fillRect(0, 0, n, n / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, (i * n) / 4, n, 3);
  });
}

/** Glowing arrows for boost pads; scroll texture.offset.y to animate. */
export function boostTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, n) => {
    const g = ctx.createLinearGradient(0, 0, n, 0);
    g.addColorStop(0, '#ff6a00');
    g.addColorStop(0.5, '#ffd000');
    g.addColorStop(1, '#ff6a00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let k = 0; k < 2; k++) {
      const y = k * (n / 2) + n * 0.1;
      ctx.beginPath();
      ctx.moveTo(n * 0.15, y + n * 0.3);
      ctx.lineTo(n / 2, y);
      ctx.lineTo(n * 0.85, y + n * 0.3);
      ctx.lineTo(n * 0.85, y + n * 0.42);
      ctx.lineTo(n / 2, y + n * 0.12);
      ctx.lineTo(n * 0.15, y + n * 0.42);
      ctx.fill();
    }
  });
}

/** Blue water with light ripple streaks (scroll offset to animate). */
export function waterTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, n) => {
    ctx.fillStyle = '#1f6fb8';
    ctx.fillRect(0, 0, n, n);
    const rnd = seededRandom(9);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(200, 235, 255, ${0.15 + rnd() * 0.3})`;
      ctx.fillRect(rnd() * n, rnd() * n, 10 + rnd() * 24, 2);
    }
  });
}

/**
 * Banner sheet for the made-up "TILT KART" brand, two designs stacked:
 *   top half    (v 0.5..1): "TILT KART" logo on blue
 *   bottom half (v 0..0.5): "FULL TILT!" on red
 * Use BANNER_LOGO / BANNER_SLOGAN as UV rectangles (see MeshBatch.add).
 */
export function bannerTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(512, (ctx, n) => {
    const row = n / 2;
    const drawRow = (y: number, bg0: string, bg1: string, text: string, fill: string) => {
      const g = ctx.createLinearGradient(0, y, n, y + row);
      g.addColorStop(0, bg0);
      g.addColorStop(1, bg1);
      ctx.fillStyle = g;
      ctx.fillRect(0, y, n, row);
      // Diagonal speed stripes in the background.
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      for (let k = -2; k < 10; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 64, y + row);
        ctx.lineTo(k * 64 + 40, y);
        ctx.lineTo(k * 64 + 64, y);
        ctx.lineTo(k * 64 + 24, y + row);
        ctx.fill();
      }
      // Checkered ends.
      const c = row / 8;
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = (i + j) % 2 ? '#111' : '#fafafa';
          ctx.fillRect(i * c, y + j * c, c, c);
          ctx.fillRect(n - (i + 1) * c, y + j * c, c, c);
        }
      // Slanted logo text with a dark outline.
      ctx.save();
      ctx.translate(n / 2, y + row / 2);
      ctx.transform(1, 0, -0.18, 1, 0, 0);
      // Start big, then shrink the font until the text fits between the checkered ends.
      let size = Math.round(row * 0.62);
      const font = () => `900 ${size}px "Arial Black", Impact, sans-serif`;
      ctx.font = font();
      while (ctx.measureText(text).width > n - 4 * c - 40 && size > 10) {
        size -= 2;
        ctx.font = font();
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = row * 0.08;
      ctx.strokeStyle = '#1a1a2e';
      ctx.strokeText(text, 0, 4);
      ctx.fillStyle = fill;
      ctx.fillText(text, 0, 4);
      ctx.restore();
    };
    drawRow(0, '#1d3fa0', '#2f7be0', 'TILT KART', '#ffd23a');
    drawRow(row, '#c62828', '#ff7a1a', 'FULL TILT!', '#ffffff');
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
export const BANNER_LOGO = { u: 0, v: 0.5, w: 1, h: 0.5 };
export const BANNER_SLOGAN = { u: 0, v: 0, w: 1, h: 0.5 };
