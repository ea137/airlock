// In the Game Boy theme the screens sit inside the console's case
// (GameBoyShell's `.lcd`). A modal dialog opens in the page's top layer,
// centred on the whole phone, over the case's bezel and buttons; this puts
// it back over the case's screen. Elsewhere it does nothing.

const MARGIN = 8;

export function keepInCase(dialog: HTMLDialogElement): void {
  const screen = dialog.closest<HTMLElement>('.lcd');
  if (!screen) return;
  const box = screen.getBoundingClientRect();
  Object.assign(dialog.style, {
    position: 'fixed',
    margin: '0',
    left: `${box.left + MARGIN}px`,
    width: `${box.width - 2 * MARGIN}px`,
    maxWidth: 'none',
    maxHeight: `${box.height - 2 * MARGIN}px`,
    overflowY: 'auto',
  });
  const height = dialog.getBoundingClientRect().height;
  dialog.style.top = `${box.top + Math.max(MARGIN, (box.height - height) / 2)}px`;
}
