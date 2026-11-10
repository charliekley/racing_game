/**
 * Guess a sensible first-run quality preset from the graphics chip's name.
 *
 * Browsers can tell a page which GPU is drawing it (the "unmasked renderer" string, for example
 * "ANGLE (Intel, Intel(R) Iris(R) Plus Graphics ...)"). We only use it to pick a starting preset
 * the first time the game runs; a preset the player chose with Q is always honoured, and the
 * adaptive-quality system still steps down by itself if the guess was too optimistic.
 */
import { QUALITY_PRESETS, type QualitySettings } from './scene';

/** Read the GPU name, or '' when the browser hides it. */
export function gpuName(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // do not keep a second context alive
    return name;
  } catch {
    return '';
  }
}

/**
 * Preset name for a GPU name:
 *  - software renderers, old Intel HD, phones/tablets chips        -> Low
 *  - other integrated GPUs (Intel UHD/Iris/Xe, AMD APUs, unknown)  -> Medium
 *  - discrete NVIDIA / AMD cards and Apple M-series                -> High
 */
export function presetNameForGpu(name: string): QualitySettings['name'] {
  const n = name.toLowerCase();
  if (!n) return 'Medium';
  if (/swiftshader|llvmpipe|software|microsoft basic|softpipe/.test(n)) return 'Low';
  if (/mali|adreno|powervr|videocore|vivante/.test(n)) return 'Low';
  if (/intel/.test(n)) {
    // "HD Graphics" without UHD (Intel HD 3000..6000) is a few generations old.
    if (/hd graphics/.test(n) && !/uhd/.test(n)) return 'Low';
    if (/arc\b|arc\(tm\)/.test(n)) return 'High';
    return 'Medium';
  }
  if (/nvidia|geforce|rtx|gtx|quadro|titan/.test(n)) return /mx\d{2,3}\b/.test(n) ? 'Medium' : 'High';
  if (/radeon|amd/.test(n)) {
    // Vega/Graphics (APU) and old R-series cards are integrated-class; RX / Pro / big numbers are discrete.
    if (/\brx\b|radeon pro|rx \d|\b(6[5-9]|7|9)\d{2}\b/.test(n)) return 'High';
    return 'Medium';
  }
  if (/apple/.test(n)) return /apple m\d|apple gpu/.test(n) ? 'High' : 'Medium';
  return 'Medium';
}

export function presetByName(name: string | null | undefined): QualitySettings | undefined {
  return QUALITY_PRESETS.find((q) => q.name.toLowerCase() === (name ?? '').toLowerCase());
}
