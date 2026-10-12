import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Lazy route chunks are transformed on first use, which can take longer than the 1 s default.
configure({ asyncUtilTimeout: 5000 });

// jsdom's AbortSignal is not Node's, and Node's Request (undici) rejects it. React Router passes
// a signal to every navigation, so drop it in tests (nothing here needs to abort a request).
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init && { ...init, signal: undefined });
  }
};

afterEach(cleanup);
