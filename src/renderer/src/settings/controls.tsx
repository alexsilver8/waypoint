/** What the Settings window's sections are made of: rows, cards and buttons. */
import { type ReactNode, useEffect, useState } from 'react';

export function Row({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="row-setting">
      <div className="row-setting__text">
        <span className="row-setting__label">{label}</span>
        {description && <span className="row-setting__description">{description}</span>}
      </div>
      <div className="row-setting__control">{children}</div>
    </div>
  );
}

/** A rounded card of settings rows, with an optional title above it. */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="group" aria-label={title}>
      {title && <h2 className="group__title">{title}</h2>}
      <div className="group__card">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  tone,
  disabled,
}: {
  children: ReactNode;
  onClick(): void;
  tone?: 'destructive';
  disabled?: boolean;
}) {
  return (
    <button type="button" className="button" data-tone={tone} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** A button that asks "are you sure" by changing its own label, instead of a dialog. */
export function ConfirmButton({
  children,
  confirm,
  disabled,
  onConfirm,
}: {
  children: ReactNode;
  confirm: string;
  disabled?: boolean;
  onConfirm(): void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <Button
      tone="destructive"
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirm : children}
    </Button>
  );
}

export function PathRow({ path }: { path: string }) {
  return (
    <span className="path" title={path}>
      {path}
    </span>
  );
}
