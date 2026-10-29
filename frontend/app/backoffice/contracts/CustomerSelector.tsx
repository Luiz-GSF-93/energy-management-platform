'use client';

import {useEffect, useId, useRef} from 'react';
import styles from './CustomerSelector.module.css';

type Customer = {id: string; company_name: string};

export default function CustomerSelector({customers, value, onChange, label='Cliente em operação', placeholder='Selecione o cliente', emptyMessage='Nenhum cliente encontrado. Ajuste a busca acima.', disabled=false}: {
  customers: Customer[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const selected = customers.find(customer => customer.id === value);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (details.current && event.target instanceof Node && !details.current.contains(event.target)) details.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  function choose(customerId: string) {
    if (disabled) return;
    if (details.current) details.current.open = false;
    summary.current?.focus();
    onChange(customerId);
  }

  return <div className={styles.field}>
    <span id={`${id}-label`}>{label}</span>
    <details ref={details} className={styles.selector} onKeyDown={event => {
      if (event.key === 'Escape' || disabled) {
        event.preventDefault();
        if (details.current) details.current.open = false;
        summary.current?.focus();
      }
    }}>
      <summary ref={summary} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onClick={event=>{if(disabled)event.preventDefault();}} aria-labelledby={`${id}-label ${id}-value`}>
        <span id={`${id}-value`}>{selected?.company_name || placeholder}</span>
      </summary>
      <div className={styles.options} role="group" aria-labelledby={`${id}-label`}>
        <button type="button" disabled={disabled} aria-pressed={!value} onClick={() => choose('')}>{placeholder}</button>
        {customers.map(customer => <button key={customer.id} type="button" disabled={disabled} aria-pressed={value === customer.id} onClick={() => choose(customer.id)}>{customer.company_name}</button>)}
        {customers.length === 0 ? <p role="status">{emptyMessage}</p> : null}
      </div>
    </details>
  </div>;
}
