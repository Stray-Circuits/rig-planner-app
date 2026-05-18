import type { InputHTMLAttributes } from 'react';
import styles from './TextField.module.css';

type Size = 'md' | 'lg';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: Size;
  invalid?: boolean;
}

export function TextField({
  inputSize = 'md',
  invalid,
  className,
  ...rest
}: TextFieldProps) {
  const cls = [
    styles.input,
    styles[inputSize],
    invalid ? styles.invalid : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return <input className={cls} {...rest} />;
}
