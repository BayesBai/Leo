/** An automatic step change must not interrupt the independent background control. */
export function focusWorkbenchMain(main: HTMLElement | null) {
  if (document.activeElement?.matches('button.workbench-background-control')) return;
  main?.focus({ preventScroll: true });
}
