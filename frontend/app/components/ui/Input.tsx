import {
  InputHTMLAttributes,
  useId,
} from 'react';

interface InputProps
  extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Input({
  id,
  label,
  className = '',
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  const classes = [
    'ds-input',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="ds-field">
      <label
        className="ds-label"
        htmlFor={inputId}
      >
        {label}
      </label>

      <input
        id={inputId}
        className={classes}
        {...props}
      />
    </div>
  );
}
