// An answer's Markdown, as far as Claude uses it on a phone: paragraphs,
// lists, code blocks, `code` and **bold**. Read into blocks the screen draws
// itself, never inserted as HTML. A code block still open (the answer is
// still coming) is drawn as one.

export type Inline = { kind: 'text' | 'code' | 'strong'; text: string };

export type Block =
  | { kind: 'para'; parts: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string };

/** `code` and **bold** in a line of text. */
export function inline(text: string): Inline[] {
  const parts: Inline[] = [];
  for (const piece of text.split(/(`[^`]+`|\*\*[^*]+\*\*)/)) {
    if (!piece) continue;
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
      parts.push({ kind: 'code', text: piece.slice(1, -1) });
    } else if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
      parts.push({ kind: 'strong', text: piece.slice(2, -2) });
    } else {
      parts.push({ kind: 'text', text: piece });
    }
  }
  return parts;
}

const ITEM = /^\s*([-*•]|\d+[.)])\s+(.*)$/;

export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;
  const endParagraph = () => {
    if (paragraph.length > 0) out.push({ kind: 'para', parts: inline(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const line of markdown.split('\n')) {
    if (code !== null) {
      if (line.trim().startsWith('```')) {
        out.push({ kind: 'code', text: code.join('\n') });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (line.trim().startsWith('```')) {
      endParagraph();
      code = [];
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      endParagraph();
      const ordered = /\d/.test(item[1] ?? '');
      const last = out[out.length - 1];
      const parts = inline(item[2] ?? '');
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(parts);
      else out.push({ kind: 'list', ordered, items: [parts] });
      continue;
    }
    if (line.trim() === '') {
      endParagraph();
      continue;
    }
    // A heading reads as a bold line.
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      endParagraph();
      out.push({ kind: 'para', parts: [{ kind: 'strong', text: heading[1] ?? '' }] });
      continue;
    }
    paragraph.push(line.trim());
  }
  endParagraph();
  if (code !== null) out.push({ kind: 'code', text: code.join('\n') });
  return out;
}
