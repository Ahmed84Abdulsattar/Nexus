import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { expect, it } from 'vitest';
import { App } from '../src/app/App';

it('renders the placeholder', () => {
  expect(renderToString(createElement(App))).toContain('Nexus by Innovo');
});
