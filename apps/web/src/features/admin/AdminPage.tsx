import { PageLayout } from '../../app/layout';

export function AdminPage() {
  return (
    <PageLayout
      listLabel="Admin sections"
      list={<p className="text-sm text-fg-muted">Admin sections placeholder.</p>}
    >
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p>Admin placeholder. Admin screens arrive in S8.</p>
    </PageLayout>
  );
}
