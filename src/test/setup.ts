import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/*
 * Testing Library only auto-cleans when vitest runs with `globals: true`, and
 * this project does not. Without it every render stays in `document.body` for
 * the rest of the file, so `screen` queries see elements from earlier tests and
 * fail with "found multiple elements" — a failure that looks like a component
 * bug rather than leaked state.
 */
afterEach(cleanup);
