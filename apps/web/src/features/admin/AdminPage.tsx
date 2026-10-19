import { PageLayout } from '../../app/layout';
import { ComingSoon, EmptyState } from '../../components/feedback';

export function AdminPage() {
  return (
    <PageLayout
      listLabel="Admin sections"
      list={<EmptyState title="No sections yet" message="Admin sections arrive in S8." />}
    >
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p>Admin placeholder. Admin screens arrive in S8.</p>
      <ComingSoon title="Admin screens" />
    </PageLayout>
  );
}
