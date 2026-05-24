export function Skeleton({ height = 120 }: { height?: number }) {
  return (
    <div
      className="skeleton"
      style={{ height, width: "100%" }}
      aria-hidden="true"
    />
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="error" role="alert">
      <strong>Could not load data.</strong> {message}
    </div>
  );
}
