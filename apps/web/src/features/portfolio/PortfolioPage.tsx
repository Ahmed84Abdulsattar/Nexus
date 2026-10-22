import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useConfig, useProjects } from '../../api/queries';
import { QueryState } from '../../components/feedback';
import { MapView, markerToken, ModeSwitch } from '../../components/map';
import type { MapFocus, MapMarker, MapMode } from '../../components/map';
import { PageHeading, Tag } from '../../components/ui';

/**
 * Placeholder portfolio (S0-09): the wrapper, the mode switch and a project list that does every
 * map action too (docs/09 section 7). The real UAE site map is S2-03; it is 2D only in the product,
 * the 3-mode switch here proves the wrapper for the project page.
 */
export function PortfolioPage() {
  const projects = useProjects();
  const config = useConfig();
  const [mode, setMode] = useState<MapMode>('2d');
  const [focus, setFocus] = useState<MapFocus | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const items = useMemo(() => projects.data?.items ?? [], [projects.data]);
  const labelFor = (state: string) =>
    config.data?.enums.projectStates.find((entry) => entry.key === state)?.label ?? state;

  // A project without coordinates is listed but never placed on the map.
  const markers = useMemo<MapMarker[]>(
    () =>
      items.flatMap((p) =>
        p.latitude === null || p.longitude === null
          ? []
          : [
              {
                id: p.id,
                kind: 'project' as const,
                lat: p.latitude,
                lng: p.longitude,
                icon: 'generic',
                colorKey: p.state,
                label: p.name,
              },
            ],
      ),
    [items],
  );
  const offMap = items.filter((p) => p.latitude === null || p.longitude === null);
  const selected = items.find((p) => p.id === selectedId);

  function select(id: string) {
    setSelectedId(id);
    const p = items.find((item) => item.id === id);
    if (p && p.latitude !== null && p.longitude !== null) {
      setFocus({ lat: p.latitude, lng: p.longitude, zoom: 12 });
    }
  }

  return (
    <main className="mx-auto w-full max-w-[110rem] min-w-0 p-4 md:p-6">
      <PageHeading
        eyebrow="Innovo Nexus"
        title="Portfolio"
        description="Construction sites across the UAE."
      />
      <div className="mt-5 grid gap-4 md:gap-6 lg:grid-cols-[1fr_22rem]">
        <MapView
          label="Project map"
          mode={mode}
          markers={markers}
          cluster
          focus={focus}
          onMarkerClick={(marker) => select(marker.id)}
          className="h-[60vh] min-h-96 lg:h-[calc(100dvh-14rem)]"
          overlays={<ModeSwitch mode={mode} onChange={setMode} className="absolute top-3 left-3" />}
        />
        <section
          aria-labelledby="project-list-title"
          className="min-w-0 rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="project-list-title" className="text-lg font-semibold tracking-tight">
            Projects
          </h2>
          {/* Loading, error with retry, or empty (never a zero). The list below shows the data. */}
          {items.length === 0 ? (
            <QueryState
              query={projects}
              loadingLabel="Loading projects"
              emptyTitle="No projects yet"
              isEmpty={(page) => page.items.length === 0}
            >
              {() => null}
            </QueryState>
          ) : null}
          <ul className="mt-3 flex max-h-[50vh] lg:max-h-[calc(100dvh-24rem)] flex-col gap-2 overflow-auto p-1">
            {items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => select(p.id)}
                  aria-pressed={p.id === selectedId}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-4 py-2 text-left text-sm font-medium text-fg shadow-card transition hover:border-border-strong hover:shadow-pop aria-pressed:border-primary aria-pressed:bg-selected aria-pressed:font-semibold aria-pressed:ring-1 aria-pressed:ring-primary"
                >
                  <span className="min-w-0 truncate">{p.name}</span>
                  <Tag
                    label={labelFor(p.state)}
                    token={markerToken({ kind: 'project', colorKey: p.state })}
                    hollow={
                      markerToken({ kind: 'project', colorKey: p.state }) === 'status-unknown'
                    }
                  />
                </button>
              </li>
            ))}
          </ul>
          {offMap.length > 0 ? (
            <p className="mt-2 text-sm text-fg-muted">
              Not on map (no coordinates): {offMap.map((p) => p.name).join(', ')}
            </p>
          ) : null}
          {selected ? (
            <p className="mt-4 rounded-lg bg-selected p-3 text-sm" aria-live="polite">
              Selected: {selected.name}.{' '}
              <Link
                className="font-semibold underline underline-offset-2"
                to={`/projects/${selected.id}`}
              >
                Open project
              </Link>
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
