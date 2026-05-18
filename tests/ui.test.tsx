import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  Chip,
  Sheet,
  SheetItem,
  TextField,
  WizardShell,
} from '../src/ui';

describe('Button', () => {
  it('renders children and triggers onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByText('Save'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('respects disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Chip', () => {
  it('reflects selected state via class', () => {
    const { rerender } = render(<Chip>One</Chip>);
    const btn = screen.getByText('One');
    expect(btn.className).not.toMatch(/selected/);
    rerender(<Chip selected>One</Chip>);
    expect(screen.getByText('One').className).toMatch(/selected/);
  });
});

describe('TextField', () => {
  it('forwards value and onChange', () => {
    const onChange = vi.fn();
    render(<TextField value="" onChange={onChange} placeholder="x" />);
    fireEvent.change(screen.getByPlaceholderText('x'), {
      target: { value: 'hi' },
    });
    expect(onChange).toHaveBeenCalled();
  });
});

describe('WizardShell', () => {
  it('renders title, step label, body, and action', () => {
    render(
      <WizardShell
        step={0}
        totalSteps={2}
        title="Hello"
        subtitle="Sub"
        footerAction={<Button>Continue</Button>}
      >
        <p>Body content</p>
      </WizardShell>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Sub')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
    expect(screen.getByText('Continue')).toBeInTheDocument();
  });

  it('shows the back button only when onBack is provided', () => {
    const onBack = vi.fn();
    const { rerender } = render(
      <WizardShell
        step={1}
        totalSteps={2}
        title="x"
        footerAction={<Button>OK</Button>}
        onBack={onBack}
      >
        <p />
      </WizardShell>,
    );
    fireEvent.click(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledOnce();

    rerender(
      <WizardShell
        step={1}
        totalSteps={2}
        title="x"
        footerAction={<Button>OK</Button>}
      >
        <p />
      </WizardShell>,
    );
    expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
  });
});

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    render(
      <Sheet open={false} onClose={() => undefined}>
        <p>Hidden</p>
      </Sheet>,
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('renders items and calls onClose on backdrop click', () => {
    const onClose = vi.fn();
    const onClick = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Actions">
        <SheetItem label="Rename" onClick={onClick} />
        <SheetItem label="Delete" destructive onClick={onClick} />
      </Sheet>,
    );
    expect(screen.getByText('Rename')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
