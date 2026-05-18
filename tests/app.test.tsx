import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/App';

describe('App boot', () => {
  it('shows the welcome state after init completes', async () => {
    render(<App />);
    expect(screen.getByText('Rig Planner')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Welcome')).toBeInTheDocument();
    });
  });
});
