import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDbForTests, __setDbForTests } from '../src/data/db';
import { RigList } from '../src/screens/rigs/RigList';
import { useRigsStore } from '../src/stores/rigsStore';
import type { Rig } from '../src/data/schema';
import { createFakeDb, type FakeDb } from './fakeDb';

let db: FakeDb;

const mkRig = (
  id: string,
  name: string,
  overrides: Partial<Rig> = {},
): Rig => ({
  id,
  name,
  widthIn: 24,
  depthIn: 8,
  style: 'rail',
  presetId: null,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

beforeEach(() => {
  __resetDbForTests();
  db = createFakeDb();
  __setDbForTests(db);
});

describe('RigList', () => {
  it('shows the "create your first rig" card when there are no rigs', () => {
    useRigsStore.setState({ rigs: [], status: 'ready', error: null });
    const onCreate = vi.fn();
    render(<RigList onOpenRig={() => undefined} onCreateRig={onCreate} />);
    const card = screen.getByText('Create your first rig');
    expect(card).toBeInTheDocument();
    fireEvent.click(card);
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('renders a "New rig" card alongside existing rigs', () => {
    const rig = mkRig('a', 'Main board');
    useRigsStore.setState({ rigs: [rig], status: 'ready', error: null });
    const onCreate = vi.fn();
    render(<RigList onOpenRig={() => undefined} onCreateRig={onCreate} />);
    fireEvent.click(screen.getByText('New rig'));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('renders cards and triggers onOpenRig', () => {
    const rig = mkRig('a', 'Main board');
    useRigsStore.setState({ rigs: [rig], status: 'ready', error: null });
    const onOpen = vi.fn();
    render(<RigList onOpenRig={onOpen} onCreateRig={() => undefined} />);
    fireEvent.click(screen.getByText('Main board'));
    expect(onOpen).toHaveBeenCalledWith(rig);
  });

  it('opens the actions sheet and can rename', async () => {
    const rig = mkRig('a', 'Old name');
    useRigsStore.setState({ rigs: [rig], status: 'ready', error: null });
    render(
      <RigList onOpenRig={() => undefined} onCreateRig={() => undefined} />,
    );

    fireEvent.click(screen.getByLabelText('Rig actions'));
    fireEvent.click(screen.getByText('Rename'));

    const input = await screen.findByDisplayValue('Old name');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(useRigsStore.getState().rigs[0]?.name).toBe('New name');
    });
  });

  it('confirms before deleting', async () => {
    const rig = mkRig('a', 'Doomed');
    useRigsStore.setState({ rigs: [rig], status: 'ready', error: null });
    render(
      <RigList onOpenRig={() => undefined} onCreateRig={() => undefined} />,
    );

    fireEvent.click(screen.getByLabelText('Rig actions'));
    fireEvent.click(screen.getByText('Delete'));
    const confirmTitle = await screen.findByText('Delete Rig?');
    // Click the Delete button in the confirm dialog, scoped to that dialog.
    const dialog =
      confirmTitle.closest<HTMLElement>('[role="dialog"]') ?? confirmTitle;
    fireEvent.click(within(dialog).getByText('Delete'));

    await waitFor(() => {
      expect(useRigsStore.getState().rigs).toHaveLength(0);
    });
  });
});
