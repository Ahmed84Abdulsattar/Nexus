import { useParams } from 'react-router';
import { PageLayout } from '../../app/layout';
import { EmptyState } from '../../components/feedback';
import { Card, PageHeading } from '../../components/ui';

/**
 * Placeholder until the project endpoints exist. Its panels show the "no data yet" state rather
 * than any number. When the project query lands it renders through `QueryState`, so a missing or
 * out-of-scope project (404) shows the not-found message and a failure shows a retry.
 *
 * TODO(S2-01): the 404 view shows the API's problem title/detail, so the API must send an identical
 * problem body for an out-of-scope project and a missing one (hard rule 6), or it leaks existence.
 */
export function ProjectPage() {
  const { projectId } = useParams();
  return (
    <PageLayout
      listLabel="Assets"
      detailsLabel="Project details"
      list={
        <EmptyState title="No assets yet" message="Asset list arrives with the project page." />
      }
      details={
        <EmptyState title="No data yet" message="Info boxes (equipment, energy) arrive later." />
      }
    >
      <PageHeading
        eyebrow="Innovo Nexus"
        title="Project"
        description={
          <>
            Project placeholder for project{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs break-all text-fg">
              {projectId}
            </code>
            .
          </>
        }
      />
      <Card className="mt-6" aria-label="Project overview">
        <EmptyState
          title="Site map and live boxes arrive later"
          message="The site map, equipment and energy boxes appear here once the project endpoints exist."
        />
      </Card>
    </PageLayout>
  );
}
