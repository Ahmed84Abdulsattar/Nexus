import { useEffect, useState } from 'react';
import { Header, PageLayout } from '../../app/layout';
import { applyTheme, initialTheme, type Theme } from '../../app/theme';
import { InnovoLogo } from '../../components/brand';
import {
  Button,
  Card,
  CardTitle,
  InfoBox,
  PageHeading,
  SidePanel,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tag,
  Tr,
} from '../../components/ui';
import { BRAND_COLOURS, SWATCHES } from './swatches';

/** The value of a brand token as written in tokens.css, read at run time. */
function useTokenValues(tokens: readonly string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setValues(Object.fromEntries(tokens.map((t) => [t, style.getPropertyValue(`--${t}`).trim()])));
  }, [tokens]);
  return values;
}

const BRAND_TOKENS = BRAND_COLOURS.map((c) => c.token);

/** Dev-only. Shows every base component and every state/status token with its text label. */
export function ComponentsPage() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [panel, setPanel] = useState(false);
  const brandHex = useTokenValues(BRAND_TOKENS);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, false);
    setTheme(next);
  };

  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <PageHeading
          eyebrow="Dev"
          title="Components"
          description="Innovo brand, tokens and base components."
        />
        <Button variant="secondary" onClick={toggleTheme}>
          Theme: {theme}. Switch to {theme === 'dark' ? 'light' : 'dark'}
        </Button>
      </header>

      <Card aria-labelledby="br">
        <CardTitle id="br">Innovo brand palette</CardTitle>
        <p className="mb-4 text-sm text-fg-muted">
          Primary colours lead. Secondary colours in small amounts. Support colours are for charts
          and data only, never backgrounds, headlines or large text.
        </p>
        {(['Primary', 'Secondary', 'Support'] as const).map((group) => (
          <div key={group} className="mb-4 last:mb-0">
            <h3 className="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">
              {group}
            </h3>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {BRAND_COLOURS.filter((c) => c.group === group).map((c) => (
                <li key={c.token} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-block size-12 shrink-0 rounded-lg border border-border"
                    style={{ background: `var(--${c.token})` }}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{c.name}</span>
                    <code className="block text-xs text-fg-muted">
                      {brandHex[c.token]?.toUpperCase() ?? ''}
                    </code>
                    <span className="block truncate text-xs text-fg-muted">{c.use}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <h3 className="mt-5 mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">
          Logo
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="surface-slate flex items-center justify-center rounded-lg p-8">
            <InnovoLogo className="h-8 w-auto" />
            <span className="sr-only">Innovo logo, white on Slate</span>
          </div>
          <div className="flex items-center justify-center rounded-lg border border-border bg-surface-raised p-8 text-fg">
            <InnovoLogo className="h-8 w-auto" />
            <span className="sr-only">Innovo logo, Slate on white</span>
          </div>
        </div>
      </Card>

      <Card aria-labelledby="sw">
        <CardTitle id="sw">State and status tokens</CardTitle>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SWATCHES.map((s) => (
            <li key={s.token} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-block size-8 shrink-0 rounded-md border border-border"
                style={{ background: `var(--${s.token})` }}
              />
              <span className="min-w-0">
                <Tag label={s.label} token={s.token} hollow={'hollow' in s} />
                <code className="block truncate text-xs text-fg-muted">--{s.token}</code>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="hd">
        <CardTitle id="hd">Header (sample user)</CardTitle>
        <Header
          session={{ user: { name: 'Sample User' }, signOut: () => undefined }}
          searchLabel="Global search (sample)"
        />
      </Card>

      <Card aria-labelledby="bt">
        <CardTitle id="bt">Button</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Card>

      <Card aria-labelledby="ib">
        <CardTitle id="ib">InfoBox</CardTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoBox title="Live value" updated="14:32">
            1,250 kWh
          </InfoBox>
          <InfoBox title="Stale value" updated="09:10" stale>
            42 kW
          </InfoBox>
          <InfoBox title="No data" updated="14:30" />
          <InfoBox title="Not reported yet" updated={null} />
        </div>
      </Card>

      <Card aria-labelledby="tb">
        <CardTitle id="tb">Table</CardTitle>
        <Table label="Demo equipment">
          <caption className="sr-only">Demo equipment</caption>
          <THead>
            <Tr>
              <Th>ID</Th>
              <Th>Description</Th>
              <Th>Status</Th>
              <Th>Updated</Th>
            </Tr>
          </THead>
          <TBody>
            <Tr>
              <Td>DG-01</Td>
              <Td>Generator A</Td>
              <Td>
                <Tag label="Running (demo label)" token="status-running" />
              </Td>
              <Td>14:32</Td>
            </Tr>
            <Tr>
              <Td>DG-02</Td>
              <Td>Generator B</Td>
              <Td>
                <Tag label="Off (demo label)" token="status-off" />
              </Td>
              <Td>—</Td>
            </Tr>
          </TBody>
        </Table>
      </Card>

      <Card aria-labelledby="tt">
        <CardTitle id="tt">Tabs</CardTitle>
        <Tabs defaultValue="a">
          <TabsList aria-label="Demo tabs">
            <TabsTrigger value="a">Equipment</TabsTrigger>
            <TabsTrigger value="b">Energy</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Equipment content</TabsContent>
          <TabsContent value="b">Energy content</TabsContent>
        </Tabs>
      </Card>

      <Card aria-labelledby="pl">
        <CardTitle id="pl">PageLayout</CardTitle>
        <p className="mb-3 text-sm text-fg-muted">
          Desktop (1280+): list, content, details. Tablet: the list is a button. Phone: both open as
          bottom drawers.
        </p>
        <div className="flex overflow-hidden rounded-md border border-border">
          <PageLayout
            contentAs="div"
            listLabel="Demo list"
            detailsLabel="Demo details"
            list={<p className="text-sm">List panel content.</p>}
            details={<p className="text-sm">Details panel content.</p>}
          >
            <p className="text-sm">Content area (the map goes here).</p>
          </PageLayout>
        </div>
      </Card>

      <Card aria-labelledby="sp">
        <CardTitle id="sp">SidePanel</CardTitle>
        <Button onClick={() => setPanel(true)}>Open side panel</Button>
        <SidePanel open={panel} onOpenChange={setPanel} title="Asset panel">
          <p>Right panel on tablet and desktop, bottom sheet on phones.</p>
        </SidePanel>
      </Card>
    </main>
  );
}
