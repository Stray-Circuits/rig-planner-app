import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import { createRig } from '../src/data/rigsRepo';
import { RigScreen } from '../src/screens/rig/RigScreen';
import { usePedalsStore } from '../src/stores/pedalsStore';
import { usePlacedPedalsStore } from '../src/stores/placedPedalsStore';
import type { Rig } from '../src/data/schema';

let rig: Rig;

beforeEach(async () => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
  usePedalsStore.setState({ pedals: [], status: 'idle', error: null });
  usePlacedPedalsStore.setState({ byRig: {}, loadingRig: null });
  rig = await createRig({
    name: 'Test rig',
    widthIn: 24,
    depthIn: 8,
    style: 'rail',
  });
});

describe('RigScreen', () => {
  it('renders the rig name, dims, and the board canvas', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    expect(screen.getByText('Test rig')).toBeInTheDocument();
    expect(screen.getByText(/24" × 8"/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('board-canvas')).toBeInTheDocument();
    });
  });

  it('shows the empty-library overlay when no pedals exist', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    expect(
      await screen.findByText(/Your library is empty/),
    ).toBeInTheDocument();
  });

  it('seed-samples button populates the sidebar and dismisses the overlay', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    await screen.findByText(/Your library is empty/);
    fireEvent.click(screen.getByText('Seed sample pedals'));
    await waitFor(() => {
      expect(
        screen.queryByText(/Your library is empty/),
      ).not.toBeInTheDocument();
    });
    // 6 pedals seeded; sidebar should list them.
    expect(screen.getByText('DS-1')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
  });

  it('back button fires onBack', () => {
    const onBack = vi.fn();
    render(<RigScreen rig={rig} onBack={onBack} />);
    fireEvent.click(screen.getByLabelText('Back to rigs'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('tapping a sidebar pedal adds it to the rig at the center', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(await screen.findByText('Seed sample pedals'));
    await screen.findByText('DS-1');

    fireEvent.click(screen.getByTitle('Add DS-1 to rig'));
    await waitFor(() => {
      const byRig = usePlacedPedalsStore.getState().byRig[rig.id] ?? [];
      expect(byRig).toHaveLength(1);
    });
    const placed = usePlacedPedalsStore.getState().byRig[rig.id]?.[0];
    // 24" × 8" rig, DS-1 is 2.85 × 4.75. Center should be ~(10.575, 1.625).
    expect(placed?.xIn).toBeCloseTo((24 - 2.85) / 2, 1);
    expect(placed?.yIn).toBeCloseTo((8 - 4.75) / 2, 1);
  });
});
