import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDbForTests, __setDbForTests } from '../src/data/db';
import { NewRigWizard } from '../src/screens/new-rig/NewRigWizard';
import { useRigsStore } from '../src/stores/rigsStore';
import { useUiStore } from '../src/stores/uiStore';
import { createFakeDb, type FakeDb } from './fakeDb';

let db: FakeDb;

beforeEach(() => {
  __resetDbForTests();
  db = createFakeDb();
  __setDbForTests(db);
  // Resolve the post-insert getRig with a row whose id matches the param.
  db.mockSelect(/SELECT \* FROM rigs WHERE id = \?/, (params) => [
    {
      id: params[0] as string,
      name: 'placeholder',
      width_in: 24,
      depth_in: 8,
      style: 'rail',
      created_at: '',
      updated_at: '',
    },
  ]);
  useRigsStore.setState({ rigs: [], status: 'idle', error: null });
  useUiStore.setState({ lastRigId: null });
});

describe('NewRigWizard', () => {
  it('blocks Continue until a name is entered', () => {
    render(<NewRigWizard onCreated={() => undefined} rigCount={3} />);
    const cont = screen.getByText('Continue');
    expect(cont).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('e.g. Main board'), {
      target: { value: 'My rig' },
    });
    expect(cont).not.toBeDisabled();
  });

  it('seeds the name with "Main board" when there are zero rigs', () => {
    render(<NewRigWizard onCreated={() => undefined} rigCount={0} />);
    expect(screen.getByDisplayValue('Main board')).toBeInTheDocument();
    expect(screen.getByText('Continue')).not.toBeDisabled();
  });

  it('advances through name → board → I/O and submits a preset selection', async () => {
    const onCreated = vi.fn();
    render(<NewRigWizard onCreated={onCreated} rigCount={3} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. Main board'), {
      target: { value: 'My rig' },
    });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Choose Your Board')).toBeInTheDocument();
    // Pedaltrain Nano+ preset card
    fireEvent.click(screen.getByText('Nano+'));
    fireEvent.click(screen.getByText('Continue'));

    expect(
      await screen.findByText("What's Outside the Board?"),
    ).toBeInTheDocument();
    const submit = screen.getByText('Create rig');
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const insert = db.executes.find((c) => c.sql.includes('INSERT INTO rigs'));
    expect(insert?.params[1]).toBe('My rig');
    // Nano+ is 18 × 5, rail
    expect(insert?.params[2]).toBe(18);
    expect(insert?.params[4]).toBe('rail');
  });

  it('requires dimensions when a custom board is chosen', async () => {
    render(<NewRigWizard onCreated={() => undefined} rigCount={3} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. Main board'), {
      target: { value: 'My rig' },
    });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(await screen.findByText('Custom size'));

    const cont = screen.getByText('Continue');
    expect(cont).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('24'), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByPlaceholderText('12'), {
      target: { value: '10' },
    });
    expect(cont).not.toBeDisabled();
  });

  it('back button returns to step 1', async () => {
    render(<NewRigWizard onCreated={() => undefined} rigCount={3} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. Main board'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByText('Continue'));
    expect(await screen.findByText('Choose Your Board')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Back'));
    expect(screen.getByText('Name Your Rig')).toBeInTheDocument();
  });
});
