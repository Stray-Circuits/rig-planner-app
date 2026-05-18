import type { ButtonHTMLAttributes } from 'react';
import styles from './Chip.module.css';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({
  selected,
  className,
  type = 'button',
  ...rest
}: ChipProps) {
  const cls = [styles.chip, selected ? styles.selected : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={cls} {...rest} />;
}
