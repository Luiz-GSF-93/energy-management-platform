import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  title?: string;
}

export function Card({
  children,
  title,
}: CardProps) {
  return (
    <section className="ds-card">
      {title ? (
        <header className="ds-card__header">
          <h2>{title}</h2>
        </header>
      ) : null}

      <div className="ds-card__content">
        {children}
      </div>
    </section>
  );
}
