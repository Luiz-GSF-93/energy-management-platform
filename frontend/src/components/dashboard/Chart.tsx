'use client';

import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

interface ChartProps {
  type: 'line' | 'bar' | 'doughnut' | 'pie';
  data: any;
  options?: any;
  title?: string;
}

export function ChartComponent({ type, data, options = {}, title }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartRef.current = new Chart(ctx, {
      type,
      data,
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: {
              color: '#e5e7eb',
            },
          },
        },
        scales: {
          y: {
            ticks: {
              color: '#9ca3af',
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.05)',
            },
          },
          x: {
            ticks: {
              color: '#9ca3af',
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.05)',
            },
          },
        },
        ...options,
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [type, data, options]);

  return (
    <div className="relative w-full h-80">
      {title && <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>}
      <canvas ref={canvasRef} />
    </div>
  );
}
