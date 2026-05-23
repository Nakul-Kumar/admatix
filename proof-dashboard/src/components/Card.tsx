import type { ReactNode } from "react";

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  elevated?: boolean;
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  compact,
  elevated,
}: CardProps) {
  const cls = [
    "card",
    compact ? "compact" : "",
    elevated ? "elevated" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={cls}>
      {(title || actions) && (
        <header className="card-head">
          <div className="titles">
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <div className="sub">{subtitle}</div> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}
