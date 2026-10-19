import { useState } from 'react';
import { Header, PageLayout } from '../../app/layout';
import { applyTheme, initialTheme, type Theme } from '../../app/theme';
import {
  Button,
  Card,
  CardTitle,
  InfoBox,
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
import { SWATCHES } from './swatches';

/** Dev-only. Shows every base component and every state/status token with its text label. */
export function ComponentsPage() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [panel, setPanel] = useState(false);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, false);
    setTheme(next);
  };

  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Components</h1>
        <Button variant="secondary" onClick={toggleTheme}>
          Theme: {theme}. Switch to {theme === 'dark' ? 'light' : 'dark'}
        </Button>
      </header>

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
