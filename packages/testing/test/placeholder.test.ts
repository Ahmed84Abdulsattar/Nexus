import { expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

it('loads the package', () => {
  expect(PACKAGE_NAME).toBe('@nexus/testing');
});
