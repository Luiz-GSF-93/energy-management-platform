import { ReactNode } from 'react';

type AlertVariant = 'info' | 'error';

interface AlertProps {
  children: ReactNode;
  variant?: AlertVariant;
}

export function Alert({
  children,
  variant = 'info',
}: AlertProps) {
  return (
    <div
      className={`ds-alert ds-alert--${variant}`}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
