import { describe, expect, it } from 'vitest';

import type { ServiceView, UnitWhy } from '../../lib/api';
import { serviceStory } from './services';

function service(unit: string, scope: ServiceView['scope'] = 'system'): ServiceView {
  return {
    unit,
    scope,
    description: '',
    active: 'failed',
    sub: 'failed',
    enabled: 'enabled',
    since: null,
    pid: null,
    memory: null,
    cpu_seconds: null,
    restarts: null,
    keep: null,
  };
}

function why(facts: Partial<UnitWhy>): UnitWhy {
  return { result: 'exit-code', exit_status: null, log: [], log_note: null, package: null, file: null, ...facts };
}

describe('serviceStory', () => {
  it("says VirtualBox's driver is safe to ignore, and how to remove the package it came from", () => {
    const story = serviceStory(
      service('vboxdrv.service'),
      why({ package: 'virtualbox-6.1', file: '/usr/lib/virtualbox/vboxdrv.sh' }),
    );
    expect(story.verdict.headline).toBe('Safe to ignore');
    expect(story.what).toContain('VirtualBox');
    expect(story.command).toBe('sudo apt purge virtualbox-6.1');
    expect(story.ended).toBe('It ended with an error.');
  });

  it("removes Guest Additions with the installer's own uninstaller", () => {
    const story = serviceStory(
      service('vboxadd-service.service'),
      why({ file: '/opt/VBoxGuestAdditions-6.1.26/init/vboxadd-service' }),
    );
    expect(story.verdict.level).toBe('safe');
    expect(story.command).toBe('sudo /opt/VBoxGuestAdditions-6.1.26/uninstall.sh');
  });

  it('says how it ended, with the exit status when there is one', () => {
    expect(serviceStory(service('x.service'), why({ exit_status: 3 })).ended).toBe(
      'It ended with an error (exit status 3).',
    );
    expect(serviceStory(service('x.service'), why({ result: 'start-limit-hit' })).ended).toContain('again and again');
    expect(serviceStory(service('x.service'), null).ended).toBeNull();
  });

  it('takes one of yours seriously, and one it does not know as worth a look', () => {
    const yours = serviceStory(service('backup.service', 'user'), null);
    expect(yours.verdict.level).toBe('worry');
    expect(yours.command).toBe('systemctl --user restart backup.service');
    const unknown = serviceStory(service('acme-agent.service'), null);
    expect(unknown.verdict.level).toBe('look');
    expect(unknown.command).toBeNull();
  });
});
