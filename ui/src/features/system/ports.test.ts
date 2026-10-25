import { describe, expect, it } from 'vitest';

import type { PortView } from '../../lib/api';
import { portStory } from './ports';

function port(overrides: Partial<PortView>): PortView {
  return {
    port: 8080,
    address: '0.0.0.0',
    exposure: 'all',
    name: 'another user\'s program',
    pid: null,
    started: null,
    dev: false,
    terminal: null,
    kind: 'unknown',
    verdict: 'look',
    owner: 'system',
    container: null,
    image: null,
    ...overrides,
  };
}

describe('portStory', () => {
  it('says a database in Docker open to every network is worth fixing, and how', () => {
    const redis = port({
      port: 6379,
      name: 'shop-cache',
      kind: 'redis',
      verdict: 'worry',
      owner: 'docker',
      container: 'shop-cache',
      image: 'redis:7-alpine',
    });
    const story = portStory(redis, false);
    expect(story.title).toBe('Redis');
    expect(story.verdict.headline).toBe('Worth fixing');
    expect(story.verdict.why).toMatch(/no password/);
    expect(story.reach).toMatch(/get past the laptop's firewall/);
    expect(story.todo).toMatch(/"127\.0\.0\.1:6379:6379" instead of "6379:6379"/);
    expect(story.stop).toBe('container');
  });

  it("gives the command to turn off what the system runs, and doesn't offer to stop it", () => {
    const ssh = portStory(port({ port: 22, kind: 'ssh', name: 'SSH' }), false);
    expect(ssh.title).toBe('SSH');
    expect(ssh.verdict.headline).toBe('Worth a look');
    expect(ssh.reach).toMatch(/firewall is off/);
    expect(ssh.command).toBe('sudo systemctl disable --now ssh.socket ssh.service');
    expect(ssh.stop).toBeNull();

    const unknown = portStory(port({ port: 40000 }), true);
    expect(unknown.title).toBe("another user's program");
    expect(unknown.reach).toMatch(/firewall may block it/);
    expect(unknown.command).toBe("sudo ss -tlnp 'sport = :40000'");
  });

  it('calls a port kept to the laptop or the tailnet safe, with nothing to do', () => {
    const local = portStory(port({ port: 5433, exposure: 'laptop', address: '127.0.0.1', kind: 'postgres', verdict: 'safe' }), false);
    expect(local.verdict).toEqual({ level: 'safe', headline: 'Safe', why: 'Nothing outside this laptop can reach it.' });
    expect(local.todo).toBeNull();
    expect(local.command).toBeNull();

    const airlock = portStory(port({ port: 443, exposure: 'tailnet', kind: 'airlock', verdict: 'safe', owner: 'you', pid: 7, started: 9 }), null);
    expect(airlock.reach).toBe('Only your own devices on Tailscale can connect to it.');
    expect(airlock.stop).toBeNull();
  });

  it('offers to stop your own program, named as it runs', () => {
    const vite = portStory(port({ port: 5173, name: 'vite', kind: 'dev', owner: 'you', pid: 4242, started: 99, dev: true }), false);
    expect(vite.title).toBe('vite');
    expect(vite.what).toMatch(/one of your projects \(vite\)/);
    expect(vite.todo).toMatch(/without --host/);
    expect(vite.stop).toBe('process');
  });
});
