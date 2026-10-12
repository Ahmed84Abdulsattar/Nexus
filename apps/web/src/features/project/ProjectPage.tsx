import { useParams } from 'react-router';

export function ProjectPage() {
  const { projectId } = useParams();
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Project</h1>
      <p>
        Project placeholder for project <code>{projectId}</code>.
      </p>
    </main>
  );
}
