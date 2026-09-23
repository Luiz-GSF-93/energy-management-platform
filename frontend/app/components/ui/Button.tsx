import {
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger';

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className = '',
  variant = 'primary',
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = [
    'ds-button',
    `ds-button--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      {...props}
    >
      {children}
    </button>
  );
}
