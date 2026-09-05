import type { InputHTMLAttributes } from 'react';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  format?: (value: number) => string;
}

export function Slider({ label, value, onValueChange, format, ...rest }: SliderProps) {
  return (
    <div className="w-full py-2">
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor={rest.id} className="text-sm font-medium text-slate-200">
          {label}
        </label>
        <span className="text-xs tabular-nums text-slate-400">
          {format ? format(value) : `${Math.round(value * 100)}%`}
        </span>
      </div>
      <input
        {...rest}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onValueChange(Number(event.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-primary-500"
      />
    </div>
  );
}
