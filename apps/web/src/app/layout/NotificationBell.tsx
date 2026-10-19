import { Button } from '../../components/ui';

/**
 * Placeholder. No count is shown: a count must come from the API (S6-08) and is never invented.
 */
export function NotificationBell() {
  return (
    <Button variant="ghost" aria-label="Notifications" className="px-0">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    </Button>
  );
}
