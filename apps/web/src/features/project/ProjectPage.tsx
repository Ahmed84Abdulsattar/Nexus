import { useParams } from 'react-router';
import { PageLayout } from '../../app/layout';

export function ProjectPage() {
  const { projectId } = useParams();
  return (
    <PageLayout
      listLabel="Assets"
      detailsLabel="Project details"
      list={
        <p className="text-sm text-fg-muted">
          Asset list placeholder. Arrives with the project page.
        </p>
      }
      details={<p className="text-sm text-fg-muted">Info boxes placeholder (equipment, energy).</p>}
    >
      <h1 className="text-2xl font-semibold">Project</h1>
      <p className="break-words">
        Project placeholder for project <code>{projectId}</code>.
      </p>
    </PageLayout>
  );
}
