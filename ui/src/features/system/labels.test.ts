import { describe, expect, it } from 'vitest';

import { bytes, diskSize, duration, exposureLabel, shortHome } from './labels';

describe('system labels', () => {
  it('says who can reach a port', () => {
    expect(exposureLabel('laptop')).toBe('laptop only');
    expect(exposureLabel('all')).toBe('all networks');
    expect(exposureLabel('tailnet')).toBe('tailnet');
  });

  it.each([
    [45, '45 s'],
    [720, '12 min'],
    [3 * 3600, '3 h'],
    [2 * 86_400, '2 days'],
  ])('reads %i seconds as %s', (seconds, want) => {
    expect(duration(seconds)).toBe(want);
  });

  it('sizes memory', () => {
    expect(bytes(8_482_000_000)).toBe('7.9 GB');
    expect(bytes(512 * 1_048_576)).toBe('512 MB');
    expect(bytes(237_000_000_000)).toBe('221 GB');
  });

  it('sizes disks the way the Files app does', () => {
    expect(diskSize(236_300_000_000)).toBe('236 GB');
    expect(diskSize(13_100_000_000)).toBe('13.1 GB');
    expect(diskSize(840_000_000)).toBe('840 MB');
    expect(diskSize(0)).toBe('0 MB');
  });

  it('shortens paths in your home', () => {
    expect(shortHome('/home/me/Projects/app', '/home/me')).toBe('~/Projects/app');
    expect(shortHome('/srv/app', '/home/me')).toBe('/srv/app');
    expect(shortHome(null, '/home/me')).toBe('');
  });
});
