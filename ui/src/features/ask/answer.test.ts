import { describe, expect, it } from 'vitest';

import { blocks, inline } from './answer';

describe('an answer', () => {
  it('reads code and bold in a line', () => {
    expect(inline('Run `sudo apt purge virtualbox` **now**.')).toEqual([
      { kind: 'text', text: 'Run ' },
      { kind: 'code', text: 'sudo apt purge virtualbox' },
      { kind: 'text', text: ' ' },
      { kind: 'strong', text: 'now' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('reads paragraphs, lists and code blocks', () => {
    const answer = [
      '## Safe to ignore',
      'It is VirtualBox',
      "and you don't use it.",
      '',
      '- no VMs',
      '- old version',
      '1. remove it',
      '```',
      'sudo apt purge virtualbox-6.1',
      '```',
    ].join('\n');
    expect(blocks(answer)).toEqual([
      { kind: 'para', parts: [{ kind: 'strong', text: 'Safe to ignore' }] },
      { kind: 'para', parts: [{ kind: 'text', text: "It is VirtualBox and you don't use it." }] },
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', text: 'no VMs' }], [{ kind: 'text', text: 'old version' }]],
      },
      { kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'remove it' }]] },
      { kind: 'code', text: 'sudo apt purge virtualbox-6.1' },
    ]);
  });

  it('draws a code block still coming as one', () => {
    expect(blocks('Run:\n```\ndf -h')).toEqual([
      { kind: 'para', parts: [{ kind: 'text', text: 'Run:' }] },
      { kind: 'code', text: 'df -h' },
    ]);
  });
});
