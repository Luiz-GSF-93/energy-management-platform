"use client";

import { useState } from "react";
import { TrendingDown, Zap } from "lucide-react";
import { Chart } from "@/components/dashboard/Chart";

export default function AnalysisPage() {
  const [timeframe, setTimeframe] = useState("month");

  const consumptionData = {
    labels: ["Sem 1", "Sem 2", "Sem 3", "Sem 4"],
    datasets: [
      {
        label: "Consumo (kWh)",
        data: [280, 310, 290, 250],
        borderColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        tension: 0.4,
      },
    ],
  };

  const costData = {
    labels: ["Sem 1", "Sem 2", "Sem 3", "Sem 4"],
    datasets: [
      {
        label: "Custo (R$)",
        data: [420, 465, 435, 375],
        backgroundColor: ["rgba(34, 197, 94, 0.2)", "rgba(34, 197, 94, 0.3)", "rgba(34, 197, 94, 0.2)", "rgba(34, 197, 94, 0.25)"],
        borderColor: "rgb(34, 197, 94)",
        borderWidth: 1,
      },
    ],
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="mb-8">
        <h1 className="dashboard-title text-white mb-2">Análise de Consumo</h1>
        <p className="subtitle text-gray-400">
          Visualize suas tendências e economia de energia
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <p className="menu-text text-gray-400 mb-2">Consumo Médio</p>
          <p className="card-kpi text-blue-400">1,130 kWh</p>
          <p className="chart-legend text-gray-500 mt-2">↑ 5% vs período anterior</p>
        </div>
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <p className="menu-text text-gray-400 mb-2">Custo Médio</p>
          <p className="card-kpi text-green-400">R$ 424.25</p>
          <p className="chart-legend text-gray-500 mt-2">↓ 3% vs período anterior</p>
        </div>
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <p className="menu-text text-gray-400 mb-2">Pico de Consumo</p>
          <p className="card-kpi text-orange-400">310 kWh</p>
          <p className="chart-legend text-gray-500 mt-2">Segunda semana do mês</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {["week", "month", "quarter"].map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`menu-text px-4 py-2 rounded-lg transition-all ${
              timeframe === tf
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {tf === "week" ? "Semana" : tf === "month" ? "Mês" : "Trimestre"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <h2 className="section-title text-white mb-4">Consumo por Semana</h2>
          <Chart type="line" data={consumptionData} />
        </div>
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <h2 className="section-title text-white mb-4">Custo por Semana</h2>
          <Chart type="bar" data={costData} />
        </div>
      </div>

      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
        <h2 className="section-title text-white mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          Insights e Recomendações
        </h2>
        <div className="space-y-3">
          <div className="flex gap-3 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <TrendingDown className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="subtitle text-white">Economia detectada na semana 4</p>
              <p className="chart-legend text-gray-400">Redução de 14% em relação à semana anterior</p>
            </div>
          </div>
          <div className="flex gap-3 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <Zap className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="subtitle text-white">Pico de consumo na semana 2</p>
              <p className="chart-legend text-gray-400">Considere revisar uso de equipamentos neste período</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
