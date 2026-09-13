import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  icon?: ReactNode;
  /**
   * Shows a clear (×) button whenever the field has a value. Used by the game
   * search so a query can be emptied in one tap without reaching for the
   * on-screen keyboard's backspace.
   */
  onClear?: () => void;
  clearLabel?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, onClear, clearLabel = 'Clear', className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  const showClear = Boolean(onClear) && String(rest.value ?? '').length > 0;

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={inputId} className="label">
          {label}
        </label>
      ) : null}
      <div className="relative">
        {icon ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'input',
            icon && 'pl-10',
            showClear && 'pr-11',
            error && 'border-danger focus:border-danger',
            className,
          )}
          {...rest}
        />
        {showClear ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={clearLabel}
            className="absolute right-1.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
