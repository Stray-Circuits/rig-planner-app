import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { __resetDbForTests, __setDbForTests } from '../src/data/db';
import { useRigsStore } from '../src/stores/rigsStore';
import { useUiStore } from '../src/stores/uiStore';
import { createFakeDb, type FakeDb } from './fakeDb';

let db: FakeDb;

const fakeRow = (id: string, name = 'A') => ({
  id,
  name,
  width_in: 24,
  depth_in: 8,
  style: 'rail',
  created_at: '',
  updated_at: '',
});

beforeEach(() => {
  __resetDbForTests();
  db = createFakeDb();
  __setDbForTests(db);
  useRigsStore.setState({ rigs: [], status: 'idle', error: null });
  useUiStore.setState({ lastRigId: null });
});

describe('App boot', () => {
  it('lands on the New Rig wizard when there are no rigs', async () => {
    db.mockSelect(/FROM rigs ORDER BY/, () => []);
    render(<App />);
    expect(await screen.findByText('Name your rig')).toBeInTheDocument();
  });

  it('lands on the last-opened rig when one is set', async () => {
    db.mockSelect(/FROM rigs ORDER BY/, () => [fakeRow('r1', 'Main board')]);
    useUiStore.setState({ lastRigId: 'r1' });
    render(<App />);
    // On mobile (jsdom default), the rig name doesn't appear in the chrome —
    // we confirm the rig screen rendered by its canvas + floating Add pedal.
    expect(await screen.findByTestId('board-canvas')).toBeInTheDocument();
    expect(screen.getByLabelText('Add pedal')).toBeInTheDocument();
  });

  it('lands on the rig list when rigs exist but no last-opened is set', async () => {
    db.mockSelect(/FROM rigs ORDER BY/, () => [
      fakeRow('r1', 'Main board'),
      fakeRow('r2', 'Fly rig'),
    ]);
    render(<App />);
    expect(await screen.findByText('Your rigs')).toBeInTheDocument();
    expect(screen.getByText('Main board')).toBeInTheDocument();
    expect(screen.getByText('Fly rig')).toBeInTheDocument();
  });

  it('opens a rig when its card is clicked', async () => {
    db.mockSelect(/FROM rigs ORDER BY/, () => [fakeRow('r1', 'Main board')]);
    render(<App />);
    await screen.findByText('Your rigs');
    fireEvent.click(screen.getByText('Main board'));
    await waitFor(() =>
      expect(screen.getByLabelText('Add pedal')).toBeInTheDocument(),
    );
  });
});
