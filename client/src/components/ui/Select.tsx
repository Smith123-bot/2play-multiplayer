import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  hint?: string;
}

export function Select({ label, options, hint, className, id, ...rest }: SelectProps) {
  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={id} className="label">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select
          id={id}
          className={cn('input appearance-none pr-10', className)}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-surface text-slate-100">
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
      </div>
      {hint ? <p className="mt-1.5 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
