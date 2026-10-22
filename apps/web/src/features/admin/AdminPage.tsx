import { PageLayout } from '../../app/layout';
import { ComingSoon, EmptyState } from '../../components/feedback';
import { PageHeading } from '../../components/ui';

export function AdminPage() {
  return (
    <PageLayout
      listLabel="Admin sections"
      list={<EmptyState title="No sections yet" message="Admin sections arrive in S8." />}
    >
      <PageHeading
        eyebrow="Administration"
        title="Admin"
        description="Admin placeholder. Admin screens arrive in S8."
      />
      <div className="mt-6">
        <ComingSoon title="Admin screens" />
      </div>
    </PageLayout>
  );
}
