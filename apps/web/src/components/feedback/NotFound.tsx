import { Link } from 'react-router';

export function NotFound() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p>The page you asked for does not exist.</p>
      <p>
        <Link to="/" className="underline">
          Back to the portfolio
        </Link>
      </p>
    </main>
  );
}
