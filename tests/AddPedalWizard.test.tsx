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
    expect(created.powerSide).toBe('bottom');
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

  it('custom hex input invalid → Continue stays disabled', () => {
    render(
      <AddPedalWizard onCreated={() => undefined} onCancel={() => undefined} />,
    );
    fireEvent.change(screen.getByPlaceholderText('#RRGGBB'), {
      target: { value: 'nope' },
    });
    expect(screen.getByText('Continue')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('#RRGGBB'), {
      target: { value: '#00FF00' },
    });
    expect(screen.getByText('Continue')).not.toBeDisabled();
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

    fireEvent.change(screen.getByDisplayValue('Bottom'), {
      target: { value: 'top' },
    });

    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Add to library'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = (await listPedals())[0]!;
    expect(created.jackSides.top).toBe(false);
    expect(created.jackSides.right).toBe(true);
    expect(created.jackSides.midi_right).toBe(true);
    expect(created.powerSide).toBe('top');
  });
});
