"use client";

import dynamic from "next/dynamic";
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

const Line = dynamic(() => import("react-chartjs-2").then((mod) => mod.Line), {
  ssr: false,
});

const Bar = dynamic(() => import("react-chartjs-2").then((mod) => mod.Bar), {
  ssr: false,
});

interface ChartProps {
  type: "line" | "bar";
  data: any;
  options?: any;
}

export function Chart({ type, data, options }: ChartProps) {
  const defaultOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        display: true,
        labels: {
          color: "#9ca3af",
          font: {
            family: "'Inter', sans-serif",
            size: 12,
            weight: "500" as const,
          },
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
        titleFont: {
          family: "'Inter', sans-serif",
          size: 13,
          weight: "600" as const,
        },
        bodyFont: {
          family: "'Inter', sans-serif",
          size: 12,
          weight: "400" as const,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: "rgba(75, 85, 99, 0.2)",
          drawBorder: false,
        },
        ticks: {
          color: "#9ca3af",
          font: {
            family: "'Inter', sans-serif",
            size: 12,
          },
        },
      },
      x: {
        grid: {
          display: false,
          drawBorder: false,
        },
        ticks: {
          color: "#9ca3af",
          font: {
            family: "'Inter', sans-serif",
            size: 12,
          },
        },
      },
    },
  };

  const mergedOptions = {
    ...defaultOptions,
    ...options,
  };

  if (type === "line") {
    return <Line data={data} options={mergedOptions} />;
  }

  return <Bar data={data} options={mergedOptions} />;
}
