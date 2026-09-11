"use client";

import React from "react";
import { Line, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

interface ChartProps {
  type: "line" | "bar";
  data: any;
  options?: any;
}

export const Chart: React.FC<ChartProps> = ({ type, data, options }) => {
  const defaultOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        display: true,
        labels: {
          color: "#9ca3af",
          font: { family: "'Inter', sans-serif", size: 12, weight: 500 as any },
          padding: 15,
        },
      },
      tooltip: {
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        titleColor: "#ffffff",
        bodyColor: "#e5e7eb",
        borderColor: "#374151",
        borderWidth: 1,
        padding: 12,
        titleFont: { family: "'Inter', sans-serif", size: 13, weight: 600 as any },
        bodyFont: { family: "'Inter', sans-serif", size: 12, weight: 400 as any },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: "rgba(75, 85, 99, 0.2)", drawBorder: false },
        ticks: { color: "#9ca3af", font: { family: "'Inter', sans-serif", size: 12 } },
      },
      x: {
        grid: { display: false, drawBorder: false },
        ticks: { color: "#9ca3af", font: { family: "'Inter', sans-serif", size: 12 } },
      },
    },
  };

  const mergedOptions = { ...defaultOptions, ...(options || {}) };

  return type === "line" ? (
    <Line data={data} options={mergedOptions} />
  ) : (
    <Bar data={data} options={mergedOptions} />
  );
};
