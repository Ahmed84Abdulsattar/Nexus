import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Button, SidePanel, Tabs, TabsContent, TabsList, TabsTrigger } from '../src/components/ui';

const WEB = process.cwd();
const SRC = join(WEB, 'src');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokensCss = strip(readFileSync(join(SRC, 'styles/tokens.css'), 'utf8'));
const tailwindCss = strip(readFileSync(join(SRC, 'styles/tailwind.css'), 'utf8'));
const posix = (p: string) => p.replaceAll('\\', '/');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// docs/11 "Status and state tokens" table, read from the doc so a rename in either place fails.
const docs11 = readFileSync(resolve(WEB, '../../docs/11-frontend-guide.md'), 'utf8');
const docTokens = [...docs11.matchAll(/^\| `--((?:state|status)-[a-z-]+)` \|/gm)].map((m) => m[1]!);

describe('token names match docs/11 exactly', () => {
  const darkAt = tokensCss.indexOf("[data-theme='dark']");

  it('docs/11 lists nine tokens', () => {
    expect(docTokens).toHaveLength(9);
  });

  it('tokens.css declares exactly those state/status tokens, in light and dark', () => {
    const declared = (block: string) =>
      [...block.matchAll(/--((?:state|status)-[a-z-]+)\s*:/g)].map((m) => m[1]!).sort();
    expect(darkAt).toBeGreaterThan(0);
    expect(declared(tokensCss.slice(0, darkAt))).toEqual([...docTokens].sort());
    expect(declared(tokensCss.slice(darkAt))).toEqual([...docTokens].sort());
  });

  it('every colour token set in light is also set in dark (no silent fallback)', () => {
    // --brand-* are theme-independent constants (the palette); .surface-slate is its own scope.
    const names = (s: string) =>
      [...s.matchAll(/(--[a-z0-9-]+)\s*:\s*#[0-9a-fA-F]{3,8}\b/g)]
        .map((m) => m[1]!)
        .filter((n) => !n.startsWith('--brand-'))
        .sort();
    const slateAt = tokensCss.indexOf('.surface-slate');
    expect(names(tokensCss.slice(darkAt, slateAt))).toEqual(names(tokensCss.slice(0, darkAt)));
  });

  it('tailwind.css exposes each of the nine tokens as a colour utility', () => {
    for (const t of docTokens) expect(tailwindCss).toContain(`--color-${t}: var(--${t});`);
  });
});

describe('no raw colours (cases the main detector can miss)', () => {
  const NAMED =
    'white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|amber|teal|cyan|lime|navy|silver|maroon';
  const SUSPECT = [
    new RegExp(
      `\\b(?:fill|stroke|stopColor|floodColor)\\s*=\\s*["'{]+\\s*["']?(?:${NAMED})\\b`,
      'i',
    ),
    new RegExp(
      `\\b(?:color|background(?:Color)?|borderColor|fill|stroke)\\s*:\\s*["'\`](?:${NAMED})["'\`]`,
      'i',
    ),
    new RegExp(
      `\\b(?:color|background(?:-color)?|border-color|fill|stroke)\\s*:\\s*(?:${NAMED})\\s*[;}]`,
      'i',
    ),
    /\b(?:bg|text|border|fill|stroke|ring)-\[(?:#|rgb|hsl|oklch)/i,
  ];

  it('finds no named colours, SVG fills or arbitrary-value colour classes in src', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = posix(relative(SRC, file));
      if (rel === 'styles/tokens.css' || !/\.(tsx?|css|html|svg)$/.test(file)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (SUSPECT.some((re) => re.test(line)))
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('index.html and public/ carry no colour values either', () => {
    let publicFiles: string[] = [];
    try {
      publicFiles = walk(join(WEB, 'public')).filter((f) => /\.(svg|css|html)$/.test(f));
    } catch {
      /* no public/ folder yet */
    }
    const bad = [join(WEB, 'index.html'), ...publicFiles].filter((f) =>
      /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(f, 'utf8')),
    );
    expect(bad.map((f) => posix(relative(WEB, f)))).toEqual([]);
  });
});

describe('dev-only code cannot reach the production graph', () => {
  it('only router.tsx, behind import.meta.env.DEV, imports features/dev', () => {
    const importers = walk(SRC)
      .filter((f) => /\.tsx?$/.test(f) && !posix(relative(SRC, f)).startsWith('features/dev/'))
      .filter((f) => /features\/dev|dev\/swatches/.test(readFileSync(f, 'utf8')))
      .map((f) => posix(relative(SRC, f)));
    expect(importers).toEqual(['app/router.tsx']);
    expect(readFileSync(join(SRC, 'app/router.tsx'), 'utf8')).toMatch(
      /import\.meta\.env\.DEV\s*\?\s*devRoutes/,
    );
  });

  it('components/ do not import the demo swatches or label list', () => {
    for (const f of walk(join(SRC, 'components'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/swatches|demo label|features\/dev/);
    }
  });
});

describe('keyboard and focus', () => {
  it('Tabs: arrow keys move focus and selection; the panel is labelled by its tab', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="t">
          <TabsTrigger value="a">One</TabsTrigger>
          <TabsTrigger value="b">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A</TabsContent>
        <TabsContent value="b">B</TabsContent>
      </Tabs>,
    );
    await user.tab();
    expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Two' })).toHaveTextContent('B');
  });

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <SidePanel open={open} onOpenChange={setOpen} title="Panel">
          <button>Inside</button>
        </SidePanel>
      </>
    );
  }

  it('SidePanel: focus moves in and stays trapped; Esc closes and focus returns to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Panel' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus());
  });

  it('SidePanel: the close button has an accessible name and closes the panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
