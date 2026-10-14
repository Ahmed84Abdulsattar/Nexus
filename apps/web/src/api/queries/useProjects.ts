import { useQuery } from '@tanstack/react-query';
import { projectMapPageSchema, type ProjectMapPage } from '@nexus/shared';
import { createPendingClient } from './pendingClient';

export const projectsQueryKey = ['projects'] as const;

export async function fetchProjects(): Promise<ProjectMapPage> {
  const { data } = await createPendingClient().GET('/projects');
  return projectMapPageSchema.parse(data);
}

/** Minimal projects list for the portfolio map (S0-09). The full query arrives with S1-04. */
export function useProjects() {
  return useQuery({ queryKey: projectsQueryKey, queryFn: fetchProjects });
}
