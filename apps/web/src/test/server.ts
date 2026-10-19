import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** The Node MSW server for component tests. Tests override with `server.use(...)`. */
export const server = setupServer(...handlers);
