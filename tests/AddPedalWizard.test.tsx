import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import { listPedals } from '../src/data/pedalsRepo';
import { AddPedalWizard } from '../src/screens/add-pedal/AddPedalWizard';
import { usePedalsStore } from '../src/stores/pedalsStore';

beforeEach(() => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
  usePedalsStore.setState({ pedals: [], status: 'idle', error: null });
});

function fillNameSize() {
  fireEvent.change(screen.getByPlaceholderText('Boss'), {
    target: { value: 'Boss' },
  });
  fireEvent.change(screen.getByPlaceholderText('DS-1'), {
    target: { value: 'DS-1' },
  });
  fireEvent.change(screen.getByPlaceholderText('2.85'), {
    target: { value: '2.85' },
  });
  fireEvent.change(screen.getByPlaceholderText('4.75'), {
    target: { value: '4.75' },
  });
}

describe('AddPedalWizard', () => {
  it('opens on the image step and can walk forward without input on stub steps', () => {
    render(
      <AddPedalWizard onCreated={() => undefined} onCancel={() => undefined} />,
    );
    expect(screen.getByText('Pedal Image')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue'));
    expect(screen.getByText('Name & Size')).toBeInTheDocument();
  });

  it('blocks Continue on Name & Size until all fields are valid', () => {
    render(
      <AddPedalWizard onCreated={() => undefined} onCancel={() => undefined} />,
    );
    fireEvent.click(screen.getByText('Continue'));
    expect(screen.getByText('Continue')).toBeDisabled();
    fillNameSize();
    expect(screen.getByText('Continue')).not.toBeDisabled();
  });

  it('submits and creates a pedal with the supplied values + defaults', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);

    // Step 0 -> 1
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    // Step 1 -> 2 (Connections) -> 3 (Review)
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    expect(screen.getByText('Review')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add to library'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const all = await listPedals();
    expect(all).toHaveLength(1);
    const created = all[0]!;
    expect(created.brand).toBe('Boss');
    expect(created.name).toBe('DS-1');
    expect(created.widthIn).toBe(2.85);
    expect(created.depthIn).toBe(4.75);
    // Modern pedals jack on top, so default In + Out both land on the
    // top edge; jackSides is derived from the port list.
    expect(created.jackSides.top).toBe(true);
    expect(created.jackSides.right).toBe(false);
    expect(created.jackSides.left).toBe(false);
    expect(created.powerSide).toBe('top');
    expect(created.ports.map((p) => p.role).sort()).toEqual([
      'input',
      'output',
    ]);
    expect(created.imagePath).toBe('color:#666666');
  });

  it('back button retreats through steps', () => {
    render(
      <AddPedalWizard onCreated={() => undefined} onCancel={() => undefined} />,
    );
    fireEvent.click(screen.getByText('Continue'));
    expect(screen.getByText('Name & Size')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Back'));
    expect(screen.getByText('Pedal Image')).toBeInTheDocument();
  });

  it('cancel fires onCancel', () => {
    const onCancel = vi.fn();
    render(<AddPedalWizard onCreated={() => undefined} onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('picking a swatch updates the color used at submit', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Color #1565C0'));
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const all = await listPedals();
    expect(all[0]?.imagePath).toBe('color:#1565C0');
  });

  it('native color picker updates the saved color', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Pick a color'), {
      target: { value: '#00ff00' },
    });
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const all = await listPedals();
    expect(all[0]?.imagePath).toBe('color:#00ff00');
  });

  it('connections preset chips compose: Dual mono stereo + MIDI', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));

    fireEvent.click(screen.getByText('Dual mono stereo'));
    fireEvent.click(screen.getByText('+ MIDI'));
    expect(screen.getByText(/Ports \(6\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listPedals())[0]!;
    expect(created.ports.map((p) => p.role).sort()).toEqual([
      'input_l',
      'input_r',
      'midi_in',
      'midi_out',
      'output_l',
      'output_r',
    ]);
  });

  it('custom port picker: add an Expression jack (role → connector)', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));

    fireEvent.click(screen.getByText('Add port'));
    // Category picker → Control → Expression In → TRS. Side step is
    // skipped — every freshly-added port defaults to the top edge to
    // match modern top-jack pedals.
    fireEvent.click(screen.getByText('Control'));
    fireEvent.click(screen.getByText('Expression In'));
    fireEvent.click(screen.getByText(/TRS \(stereo \/ balanced\)/));

    expect(screen.getByText(/Ports \(3\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listPedals())[0]!;
    const expr = created.ports.find((p) => p.role === 'expression_in');
    expect(expr).toBeDefined();
    expect(expr?.connector).toBe('trs');
    expect(expr?.signalType).toBe('expression');
    expect(expr?.side).toBe('top');
  });

  it('Required/Optional chip toggles a port between the two states', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));

    // Default In + Out are both required.
    const requiredChips = screen.getAllByText('Required');
    expect(requiredChips).toHaveLength(2);
    // Click the In chip → flips to Optional.
    fireEvent.click(requiredChips[0]!);
    expect(screen.getAllByText('Required')).toHaveLength(1);
    expect(screen.getByText('Optional')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listPedals())[0]!;
    const optional = created.ports.find((p) => p.optional);
    const required = created.ports.find((p) => !p.optional);
    expect(optional).toBeDefined();
    expect(required).toBeDefined();
  });

  it('Edit on a port row lets the user rename, change side, swap connector', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));

    fireEvent.click(screen.getByLabelText('Edit In'));
    fireEvent.change(screen.getByLabelText('Port label'), {
      target: { value: 'Guitar In' },
    });
    // Default In side is 'top'; change to 'right' to exercise the editor.
    fireEvent.change(screen.getByLabelText('Port side'), {
      target: { value: 'right' },
    });
    fireEvent.change(screen.getByLabelText('Port connector'), {
      target: { value: 'trs' },
    });
    fireEvent.click(screen.getByLabelText('Done editing'));

    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listPedals())[0]!;
    const inPort = created.ports.find((p) => p.role === 'input');
    expect(inPort?.label).toBe('Guitar In');
    expect(inPort?.side).toBe('right');
    expect(inPort?.connector).toBe('trs');
  });

  it('reorder arrows swap sideOrder among same-side siblings', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));

    // Default ports: In (sideOrder 1) + Out (sideOrder 0), both top.
    // In is rendered first; "Move In later on top" should bubble it
    // past Out so In's sideOrder becomes 0 and Out's becomes 1.
    fireEvent.click(screen.getByLabelText('Move In later on top'));

    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listPedals())[0]!;
    const inPort = created.ports.find((p) => p.role === 'input');
    const outPort = created.ports.find((p) => p.role === 'output');
    expect(inPort?.sideOrder).toBe(0);
    expect(outPort?.sideOrder).toBe(1);
  });

  it('removing a port from the list updates the count', () => {
    render(
      <AddPedalWizard onCreated={() => undefined} onCancel={() => undefined} />,
    );
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));
    // Default 2 ports (In + Out) are pre-seeded.
    expect(screen.getByText(/Ports \(2\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove In'));
    expect(screen.getByText(/Ports \(1\)/)).toBeInTheDocument();
  });

  it('jackSides derive from port sides; power side picker persists', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));

    // Replace power side via the picker in the Connections step.
    fireEvent.change(screen.getByDisplayValue('Top'), {
      target: { value: 'bottom' },
    });

    // Append a MIDI preset — MIDI I/O ports land on the top edge, so
    // the derived jackSides should pick up MIDI on the top edge.
    fireEvent.click(screen.getByText('+ MIDI'));

    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listPedals())[0]!;
    // Default In + Out put audio on the top edge.
    expect(created.jackSides.top).toBe(true);
    expect(created.jackSides.right).toBe(false);
    expect(created.jackSides.left).toBe(false);
    // MIDI preset also drops MIDI ports on the top side.
    expect(created.jackSides.midi_top).toBe(true);
    expect(created.jackSides.midi_bottom).toBe(false);
    expect(created.powerSide).toBe('bottom');
  });
});
