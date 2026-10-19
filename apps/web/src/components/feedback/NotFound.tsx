import { Link } from 'react-router';

export function NotFound({
  title = 'Page not found',
  message = 'The page you asked for does not exist, or it is not available to you.',
}: {
  title?: string;
  message?: string;
} = {}) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p>{message}</p>
      <p>
        <Link to="/" className="underline">
          Back to the portfolio
        </Link>
      </p>
    </main>
  );
}
