/**
 * Canvas textures and small helpers for Palm Plaza's look (see mall.ts and mallShell.ts). Everything is drawn in code and
 * ORIGINAL: the display windows, awnings and wall decorations are made-up shop scenes, no real brands.
 */
import * as THREE from 'three';

export const rand = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function tex(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Bright colours of the mall's palette (signs, panels, awnings, flowers). */
export const PALETTE = ['#ff6b6b', '#2ec4b6', '#ffbe0b', '#8338ec', '#3a86ff', '#fb5607', '#06d6a0', '#ef476f'];

/**
 * The wall of the shop zone (the lower 9 m of the facade, 24 m per repeat): painted bays in the mall's colours between white
 * pilasters, a dark base board and a gold cornice, with a warm wall lamp on each pilaster.
 */
export function facadeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  const cols = ['#ff8a65', '#26c6da', '#ffd54f', '#b45fd1'];
  for (let i = 0; i < 4; i++) {
    const x = i * 128;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#fff4e0');
    grd.addColorStop(0.18, cols[i]);
    grd.addColorStop(1, cols[i]);
    g.fillStyle = grd;
    g.fillRect(x, 0, 128, 256);
    // Soft diamond pattern on each bay.
    g.fillStyle = 'rgba(255,255,255,0.16)';
    for (let k = 0; k < 4; k++) {
      for (let j = 0; j < 3; j++) {
        const cx = x + 16 + k * 32;
        const cy = 90 + j * 44;
        g.beginPath();
        g.moveTo(cx, cy - 14);
        g.lineTo(cx + 12, cy);
        g.lineTo(cx, cy + 14);
        g.lineTo(cx - 12, cy);
        g.fill();
      }
    }
    g.fillStyle = '#fffaf0';
    g.fillRect(x, 0, 8, 256); // pilaster
    g.fillStyle = 'rgba(255,230,160,1)';
    g.beginPath();
    g.arc(x + 4, 96, 9, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#4b3a33';
  g.fillRect(0, 238, 512, 18); // base board (the texture's bottom)
  g.fillStyle = '#e0b35a';
  g.fillRect(0, 0, 512, 10); // cornice (the top)
  return tex(c);
}

/**
 * The clerestory above the shops (24 m per repeat, 8 m tall): tall panes with slim dark mullions, pale sky-glass with a
 * hazy skyline and palms behind (the view "outside"), and a diagonal sun streak.
 */
export function clerestoryTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 192);
  const rnd = rand(77);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const x = i * 128;
      const y = j * 96;
      const grd = g.createLinearGradient(0, y, 0, y + 96);
      grd.addColorStop(0, '#9fd6ff');
      grd.addColorStop(1, '#f1f8ff');
      g.fillStyle = grd;
      g.fillRect(x, y, 128, 96);
      g.fillStyle = 'rgba(150,180,205,0.55)';
      for (let k = 0; k < 7; k++) {
        const w = 10 + rnd() * 14;
        const h = 14 + rnd() * 34;
        g.fillRect(x + 4 + k * 17, y + 96 - h, w, h);
      }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.moveTo(x + 20, y);
      g.lineTo(x + 50, y);
      g.lineTo(x + 100, y + 96);
      g.lineTo(x + 70, y + 96);
      g.fill();
    }
  }
  g.fillStyle = '#2f5568';
  for (let i = 0; i <= 4; i++) g.fillRect(i * 128 - 3, 0, 6, 192);
  for (let j = 0; j <= 2; j++) g.fillRect(0, j * 96 - 3, 512, 6);
  return tex(c);
}

/** 8 made-up display windows (4 x 2 of 256 x 192): clothes, shoes, books, toys, ice cream, plants, gadgets, hats. */
export function displayAtlas(): { map: THREE.CanvasTexture; uv: (i: number) => [number, number, number, number] } {
  const [c, g] = canvas(1024, 384);
  const rnd = rand(31);
  const walls = ['#ffe3ee', '#e6f0ff', '#fff0cf', '#e7f8e6', '#fff4ea', '#e8fbe8', '#e5e8ff', '#fde8d4'];
  for (let i = 0; i < 8; i++) {
    const x = (i % 4) * 256;
    const y = Math.floor(i / 4) * 192;
    // The shop's inside: a warm wall, a shiny floor, a bright ceiling lamp strip.
    const wall = g.createLinearGradient(0, y, 0, y + 192);
    wall.addColorStop(0, '#ffffff');
    wall.addColorStop(0.15, walls[i]);
    wall.addColorStop(1, walls[i]);
    g.fillStyle = wall;
    g.fillRect(x, y, 256, 192);
    g.fillStyle = 'rgba(120,90,70,0.35)';
    g.fillRect(x, y + 168, 256, 24);
    g.fillStyle = '#fff6c8';
    g.fillRect(x + 20, y + 4, 216, 6);
    const shelf = (sy: number) => {
      g.fillStyle = '#9b7653';
      g.fillRect(x + 14, y + sy, 228, 5);
    };
    const pick = () => PALETTE[Math.floor(rnd() * PALETTE.length)];
    if (i === 0) {
      // Clothes: three mannequins in dresses on a pedestal row.
      for (let k = 0; k < 3; k++) {
        const cx = x + 50 + k * 78;
        g.fillStyle = '#e8d9c4';
        g.beginPath();
        g.arc(cx, y + 52, 10, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = pick();
        g.beginPath();
        g.moveTo(cx - 12, y + 66);
        g.lineTo(cx + 12, y + 66);
        g.lineTo(cx + 26, y + 150);
        g.lineTo(cx - 26, y + 150);
        g.fill();
        g.fillStyle = '#6b5846';
        g.fillRect(cx - 22, y + 150, 44, 10);
      }
    } else if (i === 1) {
      // Shoes on three shelves.
      for (let r = 0; r < 3; r++) {
        shelf(60 + r * 36);
        for (let k = 0; k < 6; k++) {
          g.fillStyle = pick();
          g.beginPath();
          g.ellipse(x + 38 + k * 34, y + 54 + r * 36, 13, 6, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else if (i === 2) {
      // Books: coloured spines.
      for (let r = 0; r < 3; r++) {
        shelf(62 + r * 38);
        for (let k = 0; k < 16; k++) {
          g.fillStyle = pick();
          const h = 22 + rnd() * 10;
          g.fillRect(x + 18 + k * 14, y + 62 + r * 38 - h, 11, h);
        }
      }
    } else if (i === 3) {
      // Toys: blocks, balls, a teddy, balloons.
      shelf(100);
      shelf(150);
      for (let k = 0; k < 5; k++) {
        g.fillStyle = pick();
        g.fillRect(x + 24 + k * 40, y + 78, 22, 22);
        g.beginPath();
        g.arc(x + 46 + k * 40, y + 134, 12, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#b57b4a';
      g.beginPath();
      g.arc(x + 128, y + 128, 17, 0, Math.PI * 2);
      g.arc(x + 114, y + 112, 7, 0, Math.PI * 2);
      g.arc(x + 142, y + 112, 7, 0, Math.PI * 2);
      g.fill();
      for (let k = 0; k < 4; k++) {
        g.fillStyle = pick();
        g.beginPath();
        g.ellipse(x + 40 + k * 56, y + 34, 11, 14, 0, 0, Math.PI * 2);
        g.fill();
      }
    } else if (i === 4) {
      // Ice-cream parlour: a counter with cones and a menu board.
      g.fillStyle = '#ffffff';
      g.fillRect(x + 14, y + 110, 228, 58);
      g.fillStyle = '#ff8fab';
      g.fillRect(x + 14, y + 110, 228, 8);
      for (let k = 0; k < 6; k++) {
        g.fillStyle = '#e9c46a';
        g.beginPath();
        g.moveTo(x + 34 + k * 36, y + 106);
        g.lineTo(x + 52 + k * 36, y + 106);
        g.lineTo(x + 43 + k * 36, y + 134);
        g.fill();
        g.fillStyle = pick();
        g.beginPath();
        g.arc(x + 43 + k * 36, y + 100, 11, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#2b3a42';
      g.fillRect(x + 70, y + 22, 116, 44);
      g.fillStyle = '#ffe28a';
      for (let k = 0; k < 4; k++) g.fillRect(x + 80, y + 30 + k * 9, 60 + (k % 2) * 30, 4);
    } else if (i === 5) {
      // Plants: pots on tiered shelves.
      for (let r = 0; r < 3; r++) {
        shelf(70 + r * 38);
        for (let k = 0; k < 6; k++) {
          const px = x + 36 + k * 36;
          const py = y + 70 + r * 38;
          g.fillStyle = '#c8734a';
          g.fillRect(px - 8, py - 12, 16, 12);
          g.fillStyle = k % 2 ? '#2f9e4f' : '#52c26a';
          g.beginPath();
          g.arc(px, py - 20, 11, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = pick();
          g.beginPath();
          g.arc(px + 4, py - 24, 4, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else if (i === 6) {
      // Gadgets: glowing screens and headphones.
      for (let k = 0; k < 4; k++) {
        g.fillStyle = '#1f2937';
        g.fillRect(x + 18 + k * 58, y + 40, 48, 34);
        g.fillStyle = ['#4cc9f0', '#f72585', '#fee440', '#80ed99'][k];
        g.fillRect(x + 22 + k * 58, y + 44, 40, 26);
      }
      shelf(110);
      for (let k = 0; k < 4; k++) {
        g.strokeStyle = pick();
        g.lineWidth = 5;
        g.beginPath();
        g.arc(x + 44 + k * 56, y + 100, 14, Math.PI, 0);
        g.stroke();
        g.fillStyle = '#222';
        g.fillRect(x + 28 + k * 56, y + 98, 7, 12);
        g.fillRect(x + 52 + k * 56, y + 98, 7, 12);
      }
    } else {
      // Hats and bags on pegs.
      for (let k = 0; k < 5; k++) {
        const cx = x + 36 + k * 46;
        g.fillStyle = pick();
        g.beginPath();
        g.ellipse(cx, y + 62, 20, 6, 0, 0, Math.PI * 2);
        g.fill();
        g.fillRect(cx - 11, y + 46, 22, 16);
        g.fillStyle = pick();
        g.fillRect(cx - 14, y + 110, 28, 26);
        g.strokeStyle = '#6b4a2f';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, y + 110, 9, Math.PI, 0);
        g.stroke();
      }
    }
    // A glass door frame and a soft reflection streak.
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.moveTo(x + 150, y);
    g.lineTo(x + 190, y);
    g.lineTo(x + 120, y + 192);
    g.lineTo(x + 80, y + 192);
    g.fill();
  }
  return { map: tex(c, false), uv: (i) => [((i % 4) * 256) / 1024, 1 - (Math.floor(i / 4) * 192 + 192) / 384, 256 / 1024, 192 / 384] };
}

/** 8 awning stripe rows (512 x 16 each): a bright colour and white, 26 stripes across a shop's 13 m. */
export function awningAtlas(): { map: THREE.CanvasTexture; uv: (i: number) => [number, number, number, number] } {
  const [c, g] = canvas(512, 128);
  for (let i = 0; i < 8; i++) {
    for (let k = 0; k < 26; k++) {
      g.fillStyle = k % 2 ? '#fffdf6' : PALETTE[i];
      g.fillRect((k * 512) / 26, i * 16, 512 / 26 + 1, 16);
    }
  }
  return { map: tex(c, false), uv: (i) => [0, 1 - (i + 1) / 8, 1, 1 / 8] };
}

/** A soft vertical light shaft for the sunbeams (bright in the middle, fading at the sides and both ends). */
export function beamTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 256);
  const img = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 64; x++) {
      const u = 1 - Math.abs(x / 63 - 0.5) * 2;
      const v = Math.sin((y / 255) * Math.PI);
      const a = Math.min(1, u * 1.4) ** 1.5 * v ** 0.8;
      const k = (y * 64 + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, false);
}

/** The glass roof: a fine 3 m silver lattice on tinted glass (alpha), 12 m per repeat. */
export function roofTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = 'rgba(120,200,240,0.26)';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.moveTo(0, 256);
  g.lineTo(256, 0);
  g.lineTo(256, 90);
  g.lineTo(90, 256);
  g.fill();
  g.fillStyle = 'rgba(205,215,225,0.95)';
  for (let i = 0; i < 4; i++) {
    g.fillRect(i * 64 - 2, 0, 4, 256);
    g.fillRect(0, i * 64 - 2, 256, 4);
  }
  return tex(c);
}

/** Leafy hedge. */
export function hedgeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const rnd = rand(9);
  g.fillStyle = '#2f8a3f';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    const k = rnd();
    g.fillStyle = k < 0.5 ? '#3fae52' : k < 0.8 ? '#226f33' : '#68c768';
    g.beginPath();
    g.arc(rnd() * 128, rnd() * 128, 2 + rnd() * 4, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/** Water ripples (the fountain pool and the tiers). */
export function waterTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#58bdea';
  g.fillRect(0, 0, 128, 128);
  const rnd = rand(21);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    g.arc(rnd() * 128, rnd() * 128, 6 + rnd() * 18, 0, Math.PI * (0.6 + rnd()));
    g.stroke();
  }
  return tex(c);
}
