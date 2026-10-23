import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import selectionCheck from './assets/selection-check.svg';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button type="button" className={`${variant} ${className}`} {...props} />;
}

export function Choice({ selected, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return <button type="button" className={`choice ${selected ? 'selected' : ''}`} aria-pressed={selected} {...props}>
    {selected && <span className="choice-tick"><img src={selectionCheck} alt="" /></span>}<span>{children}</span>
  </button>;
}

/** Native modal dialogs provide a focus boundary, Escape and inert background. */
export function Drawer({ open, onClose, title, children, className = '' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open]);
  useEffect(() => {
    if (open && ref.current && !ref.current.contains(document.activeElement)) {
      ref.current.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    }
  }, [open, title]);
  return <dialog ref={ref} className={`virgo-dialog ${className}`} aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <div className="drawer-heading"><h2 id={id}>{title}</h2><Button variant="ghost" className="icon-button" aria-label={`关闭${title}`} onClick={onClose}><X size={20} /></Button></div>
    <div className="drawer-body">{open && children}</div>
  </dialog>;
}
