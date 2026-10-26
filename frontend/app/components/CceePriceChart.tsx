'use client';

import {useState, type PointerEvent} from 'react';
import styles from './CceeMarketExplorer.module.css';

type Price = {at: string; submarket: string; value: string; hours: number};
const markets = ['SE_CO', 'S', 'NE', 'N'];
const names: Record<string, string> = {SE_CO: 'Sudeste/Centro-Oeste', S: 'Sul', NE: 'Nordeste', N: 'Norte'};
const colors = ['#51cfe8', '#ffc629', '#82e6b5', '#cb9dff'];
const money = (value: string) => Number(value).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 6});

export default function CceePriceChart({series, visible, granularity}: {series: Price[]; visible: string[]; granularity: string}) {
  const [active, setActive] = useState<string | null>(null);
  const values = series.filter(row => visible.includes(row.submarket));
  const times = Array.from(new Set(series.map(row => row.at))).sort();
  const max = Math.max(1, ...values.map(row => Number(row.value)));
  const x = (at: string) => 55 + (times.length < 2 ? 430 : times.indexOf(at) / (times.length - 1) * 860);
  const y = (value: number) => 235 - value / max * 205;
  const selected = active && times.includes(active) ? active : null;
  const selectedRows = values.filter(row => row.at === selected);
  const date = (at: string) => granularity === 'MONTH' ? at.slice(0, 7).split('-').reverse().join('/') : new Date(at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});

  function point(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(bounds.width / 950, bounds.height / 280);
    if (!scale) return;
    const px = (event.clientX - bounds.left - (bounds.width - 950 * scale) / 2) / scale;
    const index = times.length < 2 ? 0 : Math.max(0, Math.min(times.length - 1, Math.round((px - 55) / 860 * (times.length - 1))));
    setActive(times[index] ?? null);
  }

  if (!values.length) return <p>Nenhum preço registrado neste filtro. Lacunas não são zero.</p>;
  return <div className={styles.priceChart}>
    <svg viewBox="0 0 950 280" role="group" tabIndex={0} aria-label="Gráfico de preços PLD por submercado. Use as setas para consultar as datas." onPointerMove={point} onPointerDown={point} onPointerLeave={event => { if (event.pointerType !== 'touch') setActive(null); }} onFocus={() => setActive(previous => previous ?? times[0] ?? null)} onBlur={() => setActive(null)} onKeyDown={event => {
      if (event.key === 'Escape') { setActive(null); return; }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = selected ? times.indexOf(selected) : -1;
      setActive(times[event.key === 'Home' ? 0 : event.key === 'End' ? times.length - 1 : Math.max(0, Math.min(times.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)))] ?? null);
    }}>
      <line x1="55" x2="925" y1="235" y2="235" stroke="currentColor"/>
      <text x="5" y="30" fill="currentColor">{money(String(max))}</text><text x="20" y="238" fill="currentColor">0</text>
      {markets.filter(market => visible.includes(market)).map(market => {
        const rows = values.filter(row => row.submarket === market);
        const color = colors[markets.indexOf(market)];
        return <g key={market} stroke={color}>{rows.map((row, index) => <g key={row.at}>
          {index > 0 && Date.parse(row.at) - Date.parse(rows[index - 1].at) < (granularity === 'MONTH' ? 32 : granularity === 'DAY' ? 1.1 : 0.05) * 86400000 ? <line x1={x(rows[index - 1].at)} y1={y(Number(rows[index - 1].value))} x2={x(row.at)} y2={y(Number(row.value))}/> : null}
          <circle cx={x(row.at)} cy={y(Number(row.value))} r={selected === row.at ? 4.5 : 3} fill={color}><title>{names[market]} · {date(row.at)} · R$ {money(row.value)}/MWh · {row.hours} horas observadas</title></circle>
        </g>)}</g>;
      })}
      {selected ? <line x1={x(selected)} x2={x(selected)} y1="20" y2="235" stroke="currentColor" strokeDasharray="4 4" opacity="0.5"/> : null}
      <text x="55" y="270" fill="currentColor">{times[0]?.slice(0, 10)}</text><text x="815" y="270" fill="currentColor">{times.at(-1)?.slice(0, 10)}</text>
    </svg>
    {selected ? <div className={styles.priceTooltip} role="status" aria-live="polite"><strong>{date(selected)} · PLD · R$/MWh</strong>
      {markets.filter(market => visible.includes(market)).map(market => {
        const row = selectedRows.find(item => item.submarket === market);
        return <div key={market}><span style={{color: colors[markets.indexOf(market)]}}>{names[market]}</span><b>{row ? `R$ ${money(row.value)}` : 'Sem referência'}</b></div>;
      })}
    </div> : null}
    <p className={styles.priceHint}>Passe o mouse, toque no gráfico ou use as setas do teclado para consultar os valores por data.</p>
  </div>;
}
