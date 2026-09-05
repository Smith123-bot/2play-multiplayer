import { cn } from '../../utils/cn';

export interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}

export function Toggle({ checked, onChange, label, description, disabled, id }: ToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      {label ? (
        <div className="min-w-0">
          <label htmlFor={id} className="block text-sm font-medium text-slate-200">
            {label}
          </label>
          {description ? <p className="text-xs text-slate-400">{description}</p> : null}
        </div>
      ) : null}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-7 w-12 min-w-touch shrink-0 items-center rounded-full border transition-colors duration-200',
          checked ? 'border-primary-400 bg-primary-500' : 'border-white/10 bg-white/10',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}
