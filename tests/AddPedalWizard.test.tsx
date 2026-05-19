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
    expect(screen.getByText('Pedal image')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue'));
    expect(screen.getByText('Name & size')).toBeInTheDocument();
  });

  it('blocks Continue on Name & size until all fields are valid', () => {
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
    // Step 1 -> 2 -> 3 -> 4
    fireEvent.click(screen.getByText('Continue'));
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
    // Defaults — phase 4 b/c/d will let users override these.
    expect(created.jackSides.top).toBe(true);
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
    expect(screen.getByText('Name & size')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Back'));
    expect(screen.getByText('Pedal image')).toBeInTheDocument();
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
    fireEvent.click(screen.getByText('Continue'));

    fireEvent.click(screen.getByText('Dual mono stereo'));
    fireEvent.click(screen.getByText('+ MIDI'));
    expect(screen.getByText(/Ports \(5\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listPedals())[0]!;
    expect(created.ports.map((p) => p.role).sort()).toEqual([
      'input',
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
    fireEvent.click(screen.getByText('Continue'));

    fireEvent.click(screen.getByText('Add port'));
    // Role picker is visible. Click Expression.
    fireEvent.click(screen.getByText('Expression'));
    // Connector picker now visible — pick TRS.
    fireEvent.click(screen.getByText(/TRS \(stereo \/ balanced\)/));
    // Side picker now visible — pick Right.
    fireEvent.click(screen.getByText('Right'));

    expect(screen.getByText(/Ports \(3\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listPedals())[0]!;
    const expr = created.ports.find((p) => p.role === 'expression');
    expect(expr).toBeDefined();
    expect(expr?.connector).toBe('trs');
    expect(expr?.signalType).toBe('expression');
    expect(expr?.side).toBe('right');
  });

  it('Required/Optional chip toggles a port between the two states', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));
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

  it('reorder arrows swap sideOrder among same-side siblings', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));
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
    fireEvent.click(screen.getByText('Continue'));
    // Default 2 ports (In + Out) are pre-seeded.
    expect(screen.getByText(/Ports \(2\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove In'));
    expect(screen.getByText(/Ports \(1\)/)).toBeInTheDocument();
  });

  it('jack step toggles audio/MIDI per side and persists power side', async () => {
    const onCreated = vi.fn();
    render(<AddPedalWizard onCreated={onCreated} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Continue'));
    fillNameSize();
    fireEvent.click(screen.getByText('Continue'));

    // Default state: Top audio is on. Two "Top" buttons exist — audio and MIDI.
    // The audio one starts pressed.
    const topButtons = screen.getAllByRole('button', { name: 'Top' });
    expect(topButtons[0]?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(topButtons[0]!); // turn off Top audio

    const rightButtons = screen.getAllByRole('button', { name: 'Right' });
    fireEvent.click(rightButtons[0]!); // Right audio on
    fireEvent.click(rightButtons[1]!); // Right MIDI on

    // Default is 'top'; move power to 'bottom' to verify the control persists.
    fireEvent.change(screen.getByDisplayValue('Top'), {
      target: { value: 'bottom' },
    });

    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listPedals())[0]!;
    expect(created.jackSides.top).toBe(false);
    expect(created.jackSides.right).toBe(true);
    expect(created.jackSides.midi_right).toBe(true);
    expect(created.powerSide).toBe('bottom');
  });
});
