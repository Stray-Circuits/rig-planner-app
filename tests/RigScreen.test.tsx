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
import { createPedal } from '../src/data/pedalsRepo';
import { seedSamplePedals } from './helpers/seedPedals';
import { RigScreen } from '../src/screens/rig/RigScreen';
import { usePedalsStore } from '../src/stores/pedalsStore';
import { usePlacedPedalsStore } from '../src/stores/placedPedalsStore';
import { useRigsStore } from '../src/stores/rigsStore';
import { useSignalChainStore } from '../src/stores/signalChainStore';
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
  useSignalChainStore.setState({
    connectionsByRig: {},
    endpointsByRig: {},
    loading: null,
  });
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

  it('opens the pedal library sheet and lists existing pedals', async () => {
    await seedSamplePedals();
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    expect(await screen.findByText('DS-1')).toBeInTheDocument();
  });

  it('shows the empty-library state when no pedals exist', async () => {
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    expect(
      await screen.findByText(/Your library is empty/),
    ).toBeInTheDocument();
  });

  it('tapping a pedal in the library adds it to the rig and closes the sheet', async () => {
    await seedSamplePedals();
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    const ds1 = await screen.findByText('DS-1');
    fireEvent.click(ds1);
    await waitFor(() => {
      expect(
        usePlacedPedalsStore.getState().byRig[rig.id]?.length,
      ).toBeGreaterThan(0);
    });
    // Sheet should be closed.
    await waitFor(() => {
      expect(screen.queryByText('Add a Pedal')).not.toBeInTheDocument();
    });
  });

  it('right-click on a placed pedal opens the action sheet', async () => {
    await seedSamplePedals();
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
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
    const dialog = (await screen.findByText('Rig Settings')).closest(
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
    const dialog = (await screen.findByText('Rig Settings')).closest(
      '[role="dialog"]',
    )!;
    fireEvent.click(within(dialog as HTMLElement).getByText('Change'));

    // Picker is multi-stage. The current rig fuzzy-matches Pedaltrain
    // Metro 24, so we land on the Pedaltrain view with the Metro series
    // pre-expanded. Expand Classic to reveal Classic Pro.
    fireEvent.click(await screen.findByText('Classic'));
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
    expect(await screen.findByText('Pedal Image')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue'));

    // Name & Size.
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
    fireEvent.click(screen.getByText('Add to library'));

    await waitFor(() => {
      expect(
        usePlacedPedalsStore.getState().byRig[rig.id]?.length,
      ).toBeGreaterThan(0);
    });
    // Wizard closed.
    expect(screen.queryByText('Pedal Image')).not.toBeInTheDocument();
  });

  it('tap-to-connect: arm an output, tap an input → connection created', async () => {
    await seedSamplePedals();
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    // Add two pedals to the rig.
    fireEvent.click(await screen.findByText('DS-1'));
    await waitFor(() => {
      expect(usePlacedPedalsStore.getState().byRig[rig.id]?.length).toBe(1);
    });
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(await screen.findByText('Phase 90'));
    await waitFor(() => {
      expect(usePlacedPedalsStore.getState().byRig[rig.id]?.length).toBe(2);
    });

    // Turn on chain mode. Connection grammar is now pedal-tap → sheet → port row.
    fireEvent.click(screen.getByLabelText('Show signal chain'));
    fireEvent.click(await screen.findByLabelText('Boss DS-1'));
    fireEvent.click(await screen.findByRole('button', { name: /^Out\b/ }));
    fireEvent.click(screen.getByLabelText('MXR Phase 90'));
    fireEvent.click(await screen.findByRole('button', { name: /^In\b/ }));

    await waitFor(() => {
      const conns = useSignalChainStore.getState().connectionsByRig[rig.id];
      expect(conns).toHaveLength(1);
    });
    const conn = useSignalChainStore.getState().connectionsByRig[rig.id]?.[0];
    expect(conn?.fromNodeKind).toBe('pedal');
    expect(conn?.toNodeKind).toBe('pedal');
  });

  it('endpoint chip: arm an input → tap From Guitar creates external→pedal connection', async () => {
    await seedSamplePedals();
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(await screen.findByText('DS-1'));
    await waitFor(() => {
      expect(usePlacedPedalsStore.getState().byRig[rig.id]?.length).toBe(1);
    });
    fireEvent.click(screen.getByLabelText('Show signal chain'));
    fireEvent.click(await screen.findByLabelText('Boss DS-1'));
    fireEvent.click(await screen.findByRole('button', { name: /^In\b/ }));
    fireEvent.click(await screen.findByText('From Guitar'));

    await waitFor(() => {
      const conns = useSignalChainStore.getState().connectionsByRig[rig.id];
      expect(conns).toHaveLength(1);
    });
    const conn = useSignalChainStore.getState().connectionsByRig[rig.id]?.[0];
    expect(conn?.fromNodeKind).toBe('external');
    expect(conn?.toNodeKind).toBe('pedal');
  });

  it('endpoint chip: arming an output then tapping From Guitar is rejected (two sources)', async () => {
    await seedSamplePedals();
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(await screen.findByText('DS-1'));
    await waitFor(() => {
      expect(usePlacedPedalsStore.getState().byRig[rig.id]?.length).toBe(1);
    });
    fireEvent.click(screen.getByLabelText('Show signal chain'));
    fireEvent.click(await screen.findByLabelText('Boss DS-1'));
    // Arm the OUTPUT port. Guitar is also a source — direction conflict.
    fireEvent.click(await screen.findByRole('button', { name: /^Out\b/ }));
    fireEvent.click(await screen.findByText('From Guitar'));

    // The connection store must stay empty — the picker filter doesn't
    // apply on the chip-tap path, so the handler itself rejects.
    await new Promise((r) => setTimeout(r, 50));
    const conns = useSignalChainStore.getState().connectionsByRig[rig.id];
    expect(conns ?? []).toHaveLength(0);
  });

  it('TRS output accepts two cables via splitter; third attempt surfaces the saturation notice', async () => {
    // Custom pedal with a TRS-jack output — none of the seed pedals use
    // 'trs' (they use 'ts' or 'midi_trs'), so the splitter case has to
    // be set up explicitly.
    await createPedal({
      brand: 'Acme',
      name: 'TRS Out Box',
      widthIn: 3,
      depthIn: 4,
      imagePath: null,
      jackSides: {
        top: false,
        bottom: true,
        left: false,
        right: false,
        midi_top: false,
        midi_bottom: false,
        midi_left: false,
        midi_right: false,
      },
      powerSide: null,
      ports: [
        {
          label: 'TRS Out',
          role: 'stereo_output',
          signalType: 'instrument',
          connector: 'trs',
          side: 'bottom',
          sideOrder: 0,
          optional: false,
        },
      ],
    });
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(await screen.findByText('TRS Out Box'));
    await waitFor(() => {
      expect(usePlacedPedalsStore.getState().byRig[rig.id]?.length).toBe(1);
    });

    fireEvent.click(screen.getByLabelText('Show signal chain'));
    // First cable: TRS Out → Amp. Source should stay armed afterwards
    // (TRS at 1 of 2).
    fireEvent.click(await screen.findByLabelText('Acme TRS Out Box'));
    fireEvent.click(await screen.findByRole('button', { name: /^TRS Out\b/ }));
    fireEvent.click(await screen.findByText('To Amp'));
    await waitFor(() => {
      expect(
        useSignalChainStore.getState().connectionsByRig[rig.id],
      ).toHaveLength(1);
    });
    // Second cable: same TRS Out → Amp again. Endpoints don't have a
    // cable cap, so wiring the splitter into the same sink twice is
    // fine and saturates the source-side TRS port.
    fireEvent.click(await screen.findByText('To Amp'));
    await waitFor(() => {
      expect(
        useSignalChainStore.getState().connectionsByRig[rig.id],
      ).toHaveLength(2);
    });

    // The TRS port is now full. Reopening the picker on this pedal
    // should show the disconnect affordance with the correct count.
    fireEvent.click(screen.getByLabelText('Acme TRS Out Box'));
    expect(
      await screen.findByText(/2 cables · tap to disconnect/),
    ).toBeInTheDocument();
  });

  it('signal-chain FAB toggles chain mode + port dots', async () => {
    await seedSamplePedals();
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(await screen.findByText('DS-1'));
    await waitFor(() => {
      expect(
        usePlacedPedalsStore.getState().byRig[rig.id]?.length,
      ).toBeGreaterThan(0);
    });
    // Default: chain mode off → port-picker sheet doesn't open when tapping a pedal.
    fireEvent.click(screen.getByLabelText('Boss DS-1'));
    expect(screen.queryByText('Pick a port to start a connection')).toBeNull();

    // Toggle chain mode on → tapping the pedal opens the port picker sheet
    // with rows for each port.
    fireEvent.click(screen.getByLabelText('Show signal chain'));
    fireEvent.click(screen.getByLabelText('Boss DS-1'));
    expect(
      await screen.findByText('Pick a port to start a connection'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^In\b/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Out\b/ })).toBeInTheDocument();
  });

  it('removing a pedal from the library cascades through placements + connections', async () => {
    await seedSamplePedals();
    render(<RigScreen rig={rig} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    // Place DS-1 on the rig.
    fireEvent.click(await screen.findByText('DS-1'));
    await waitFor(() => {
      expect(usePlacedPedalsStore.getState().byRig[rig.id]?.length).toBe(1);
    });
    // Connect Guitar → DS-1 In so we have a connection that will be cascaded.
    fireEvent.click(screen.getByLabelText('Show signal chain'));
    fireEvent.click(await screen.findByLabelText('Boss DS-1'));
    fireEvent.click(await screen.findByRole('button', { name: /^In\b/ }));
    fireEvent.click(await screen.findByText('From Guitar'));
    await waitFor(() => {
      expect(
        useSignalChainStore.getState().connectionsByRig[rig.id],
      ).toHaveLength(1);
    });

    // Reopen library, then ⋯ → Remove → confirm.
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(await screen.findByLabelText('DS-1 actions'));
    fireEvent.click(await screen.findByText('Remove from collection'));
    expect(
      await screen.findByText(/currently placed on 1 rig\. Those placements/i),
    ).toBeInTheDocument();
    const dialog = screen
      .getByText('Remove Pedal?')
      .closest('[role="dialog"]')!;
    fireEvent.click(within(dialog as HTMLElement).getByText('Remove'));

    await waitFor(() => {
      // Library lost the pedal …
      expect(
        usePedalsStore.getState().pedals.some((p) => p.name === 'DS-1'),
      ).toBe(false);
      // … the rig lost its placement …
      expect(usePlacedPedalsStore.getState().byRig[rig.id]).toEqual([]);
      // … and the connection went with it.
      expect(useSignalChainStore.getState().connectionsByRig[rig.id]).toEqual(
        [],
      );
    });
  });

  it('refuses a rotation that would exceed the board and surfaces a notice', async () => {
    // Shrink the board so the rotated DS-1 (4.75 × 2.85) is wider than the
    // 4" board → rotation should be refused.
    const narrow = await createRig({
      name: 'Tiny',
      widthIn: 4,
      depthIn: 4,
      style: 'rail',
    });
    useRigsStore.setState({
      rigs: [narrow, rig],
      status: 'ready',
      error: null,
    });

    await seedSamplePedals();
    render(<RigScreen rig={narrow} onBack={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(await screen.findByText('DS-1'));
    await waitFor(() => {
      expect(usePlacedPedalsStore.getState().byRig[narrow.id]?.length).toBe(1);
    });

    const placedId =
      usePlacedPedalsStore.getState().byRig[narrow.id]?.[0]?.id ?? '';
    fireEvent.contextMenu(
      document.querySelector(`[data-placed-id="${placedId}"]`)!,
    );
    fireEvent.click(await screen.findByText('Rotate 90°'));

    expect(await screen.findByText(/won't fit rotated/i)).toBeInTheDocument();
    // Rotation was not applied.
    expect(
      usePlacedPedalsStore.getState().byRig[narrow.id]?.[0]?.rotation,
    ).toBe(0);
  });

  it('Delete Rig in Settings cascades and routes back', async () => {
    const onBack = vi.fn();
    await seedSamplePedals();
    render(<RigScreen rig={rig} onBack={onBack} />);
    // Place a pedal so we exercise the cascade warning.
    fireEvent.click(screen.getByLabelText('Add pedal'));
    fireEvent.click(await screen.findByText('DS-1'));
    await waitFor(() => {
      expect(usePlacedPedalsStore.getState().byRig[rig.id]?.length).toBe(1);
    });

    fireEvent.click(screen.getByLabelText('Rig settings'));
    const dialog = (await screen.findByText('Rig Settings')).closest(
      '[role="dialog"]',
    )!;
    fireEvent.click(within(dialog as HTMLElement).getByText('Delete Rig'));

    expect(await screen.findByText('Delete Rig?')).toBeInTheDocument();
    expect(
      screen.getByText(/1 placed pedal and their signal-chain connections/i),
    ).toBeInTheDocument();

    const confirmDialog = screen
      .getByText('Delete Rig?')
      .closest('[role="dialog"]')!;
    fireEvent.click(
      within(confirmDialog as HTMLElement).getByRole('button', {
        name: /Delete Rig/,
      }),
    );

    await waitFor(() => {
      expect(onBack).toHaveBeenCalledOnce();
    });
    await waitFor(async () => {
      const rigs = await listRigs();
      expect(rigs.find((r) => r.id === rig.id)).toBeUndefined();
    });
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
