interface StateProps {
  title: string;
  description?: string;
}

export function LoadingState({
  title = 'Carregando...',
  description,
}: Partial<StateProps>) {
  return (
    <div
      className="ds-state"
      role="status"
      aria-live="polite"
    >
      <div
        className="ds-spinner"
        aria-hidden="true"
      />

      <div>
        <h2 className="ds-state__title">
          {title}
        </h2>

        {description ? (
          <p className="ds-state__description">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: StateProps) {
  return (
    <div className="ds-state">
      <div>
        <h2 className="ds-state__title">
          {title}
        </h2>

        {description ? (
          <p className="ds-state__description">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ErrorState({
  title,
  description,
}: StateProps) {
  return (
    <div
      className="ds-state"
      role="alert"
    >
      <div>
        <h2 className="ds-state__title">
          {title}
        </h2>

        {description ? (
          <p className="ds-state__description">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
