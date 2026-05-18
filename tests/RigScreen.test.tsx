import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import { createRig, listRigs } from '../src/data/rigsRepo';
import { RigScreen } from '../src/screens/rig/RigScreen';
import { usePedalsStore } from '../src/stores/pedalsStore';
import { usePlacedPedalsStore } from '../src/stores/placedPedalsStore';
import { useRigsStore } from '../src/stores/rigsStore';
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
  useRigsStore.setState({ rigs: [rig], status: 'ready', error: null });
});

describe('RigScreen', () => {
  it('renders the canvas and floating actions', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByTestId('board-canvas')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Back to rigs')).toBeInTheDocument();
    expect(screen.getByLabelText('Add pedal')).toBeInTheDocument();
    expect(screen.getByLabelText('Rig settings')).toBeInTheDocument();
  });

  it('back button fires onBack', () => {
    const onBack = vi.fn();
    render(<RigScreen rig={rig} onBack={onBack} />);
    fireEvent.click(screen.getByLabelText('Back to rigs'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('opens the pedal library sheet and seeds samples on first open', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    expect(
      await screen.findByText(/Your library is empty/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Or seed 6 sample pedals'));
    await waitFor(() => {
      expect(
        screen.queryByText(/Your library is empty/),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText('DS-1')).toBeInTheDocument();
  });

  it('tapping a pedal in the library adds it to the rig and closes the sheet', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(await screen.findByText('Or seed 6 sample pedals'));
    const ds1 = await screen.findByText('DS-1');
    fireEvent.click(ds1);
    await waitFor(() => {
      expect(
        usePlacedPedalsStore.getState().byRig[rig.id]?.length,
      ).toBeGreaterThan(0);
    });
    // Sheet should be closed.
    await waitFor(() => {
      expect(screen.queryByText('Add a pedal')).not.toBeInTheDocument();
    });
  });

  it('right-click on a placed pedal opens the action sheet', async () => {
    // Seed + add a pedal first.
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(await screen.findByText('Or seed 6 sample pedals'));
    fireEvent.click(await screen.findByText('DS-1'));
    await waitFor(() => {
      expect(
        usePlacedPedalsStore.getState().byRig[rig.id]?.length,
      ).toBeGreaterThan(0);
    });
    const placedId =
      usePlacedPedalsStore.getState().byRig[rig.id]?.[0]?.id ?? '';
    fireEvent.contextMenu(
      document.querySelector(`[data-placed-id="${placedId}"]`)!,
    );
    expect(await screen.findByText('Rotate 90°')).toBeInTheDocument();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText('Remove')).toBeInTheDocument();
  });

  it('settings sheet shows the current board and renames the rig', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Rig settings'));
    const dialog = (await screen.findByText('Rig settings')).closest(
      '[role="dialog"]',
    )!;
    const nameInput = within(dialog as HTMLElement).getByDisplayValue(
      'Test rig',
    );
    fireEvent.change(nameInput, { target: { value: 'Renamed' } });
    fireEvent.click(within(dialog as HTMLElement).getByText('Apply'));
    await waitFor(async () => {
      const rigs = await listRigs();
      expect(rigs.find((r) => r.id === rig.id)?.name).toBe('Renamed');
    });
  });

  it('Change board flow swaps width / depth / style atomically', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Rig settings'));
    const dialog = (await screen.findByText('Rig settings')).closest(
      '[role="dialog"]',
    )!;
    fireEvent.click(within(dialog as HTMLElement).getByText('Change'));

    // We're now in the picker view. Pick "Classic Pro" (32 × 16 rail).
    const classicCard = (await screen.findByText('Classic Pro')).closest(
      'button',
    )!;
    fireEvent.click(classicCard);
    fireEvent.click(screen.getByText('Use this board'));
    // Back in the main view — Apply commits.
    fireEvent.click(await screen.findByText('Apply'));
    await waitFor(async () => {
      const rigs = await listRigs();
      const updated = rigs.find((r) => r.id === rig.id);
      expect(updated?.widthIn).toBe(32);
      expect(updated?.depthIn).toBe(16);
      expect(updated?.style).toBe('rail');
    });
  });

  it('Add new pedal entry opens the wizard; submit auto-adds to the rig', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(
      await screen.findByRole('button', { name: /add new pedal/i }),
    );

    // Wizard opened.
    expect(await screen.findByText('Pedal image')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue'));

    // Name & size.
    fireEvent.change(screen.getByPlaceholderText('Boss'), {
      target: { value: 'Test' },
    });
    fireEvent.change(screen.getByPlaceholderText('DS-1'), {
      target: { value: 'Model' },
    });
    fireEvent.change(screen.getByPlaceholderText('2.85'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByPlaceholderText('4.75'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));

    await waitFor(() => {
      expect(
        usePlacedPedalsStore.getState().byRig[rig.id]?.length,
      ).toBeGreaterThan(0);
    });
    // Wizard closed.
    expect(screen.queryByText('Pedal image')).not.toBeInTheDocument();
  });

  it('zoom controls appear and reset works after a Cmd+wheel zoom', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    await screen.findByTestId('board-canvas');
    expect(screen.queryByLabelText('Reset zoom')).not.toBeInTheDocument();

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const canvasArea =
      screen.getByTestId('board-canvas').parentElement?.parentElement;
    canvasArea?.dispatchEvent(wheelEvent);

    const resetBtn = await screen.findByLabelText('Reset zoom');
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);
    await waitFor(() => {
      expect(screen.queryByLabelText('Reset zoom')).not.toBeInTheDocument();
    });
  });
});
