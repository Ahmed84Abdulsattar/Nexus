import { Link } from 'react-router';
import { BrandRings } from '../brand';

export function NotFound({
  title = 'Page not found',
  message = 'The page you asked for does not exist, or it is not available to you.',
}: {
  title?: string;
  message?: string;
} = {}) {
  return (
    <main className="surface-slate relative flex flex-1 items-end overflow-hidden p-6 md:items-center md:p-16">
      <BrandRings />
      <div className="relative max-w-lg pt-48 md:pt-0">
        <span aria-hidden="true" className="mb-4 block size-3 rounded-full bg-brand-aqua" />
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-fg-muted">{message}</p>
        <p className="mt-6">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-fg hover:bg-primary-hover"
          >
            Back to the portfolio
          </Link>
        </p>
      </div>
    </main>
  );
}
