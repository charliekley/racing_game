import { describe, expect, it } from 'vitest';
import { presetNameForGpu } from './gpuTier';

describe('presetNameForGpu', () => {
  it('puts integrated Intel GPUs on Medium', () => {
    expect(presetNameForGpu('ANGLE (Intel, Intel(R) Iris(R) Plus Graphics (0x00008A52) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('Medium');
    expect(presetNameForGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)')).toBe('Medium');
    expect(presetNameForGpu('Intel(R) Iris(R) Xe Graphics')).toBe('Medium');
  });

  it('puts old Intel HD and software renderers on Low', () => {
    expect(presetNameForGpu('ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11)')).toBe('Low');
    expect(presetNameForGpu('Google SwiftShader')).toBe('Low');
    expect(presetNameForGpu('Mali-G52')).toBe('Low');
  });

  it('puts discrete GPUs and Apple silicon on High', () => {
    expect(presetNameForGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)')).toBe('High');
    expect(presetNameForGpu('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11)')).toBe('High');
    expect(presetNameForGpu('Apple M2')).toBe('High');
  });

  it('keeps Medium for laptop MX cards, AMD APUs and unknown names', () => {
    expect(presetNameForGpu('NVIDIA GeForce MX150')).toBe('Medium');
    expect(presetNameForGpu('AMD Radeon(TM) Vega 8 Graphics')).toBe('Medium');
    expect(presetNameForGpu('')).toBe('Medium');
    expect(presetNameForGpu('Mystery GPU')).toBe('Medium');
  });
});
