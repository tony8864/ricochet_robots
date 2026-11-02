// Nested result/confirmation dialogs must restore scrolling regardless of cleanup order.
let locks = 0;
let previousOverflow = '';

export function openModalDialog(dialog: HTMLDialogElement): () => void {
  if (!dialog.open) dialog.showModal();
  if (locks++ === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    dialog.close();
    if (--locks === 0) document.body.style.overflow = previousOverflow;
  };
}
