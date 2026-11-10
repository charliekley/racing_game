/**
 * Tiny smooth noise for procedural shapes (no textures needed).
 *
 * "Value noise": a random number sits on every integer grid point and we blend
 * smoothly between them. fbm ("fractal Brownian motion") stacks several
 * octaves of it (each twice as detailed and half as strong), which gives the
 * lumpy-but-natural look of rocks, clouds and hills.
 */

/** Deterministic hash of an integer grid point to 0..1. */
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2147483647) ^ Math.imul(seed + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Smooth value noise, 0..1. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}

/** Fractal noise, roughly 0..1 (centred on 0.5). */
export function fbm3(x: number, y: number, z: number, seed = 0, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * f, y * f, z * f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Ridged noise (sharp creases), 0..1: good for rock faces and lava cracks. */
export function ridged3(x: number, y: number, z: number, seed = 0, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (1 - Math.abs(noise3(x * f, y * f, z * f, seed + o * 31) * 2 - 1));
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
