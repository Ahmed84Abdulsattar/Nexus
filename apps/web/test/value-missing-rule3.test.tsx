import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Value } from '../src/components/feedback';

// docs/11 rule 3: "No data" is shown as "—", never as 0. The mapping drops null parameter values
// (docs/07 §4.7), so a missing parameter reaches the UI as an absent key (undefined) or as null.
const latestValues: Record<string, number | null> = { mpow_r: null };

it.each([
  ['null from the API', latestValues['mpow_r']],
  ['absent key', latestValues['fuel_level']],
])('a %s renders "—" and never 0', (_case, value) => {
  const { container } = render(<Value value={value} unit="kW" />);
  expect(container.textContent).toContain('—');
  expect(container.textContent).not.toMatch(/\b0\b/);
  expect(container.textContent).not.toContain('kW');
});

it('a real 0 still renders 0', () => {
  const { container } = render(<Value value={0} unit="kW" />);
  expect(container.textContent).toContain('0 kW');
  expect(container.textContent).not.toContain('—');
});
