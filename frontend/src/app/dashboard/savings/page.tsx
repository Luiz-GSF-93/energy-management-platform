"use client";

import { useState } from "react";
import { TrendingUp, Target } from "lucide-react";
import { Chart } from "@/components/dashboard/Chart";

export default function SavingsPage() {
  const [scenario, setScenario] = useState(10);

  const scenarioData = {
    labels: ["Consumo Atual", "Economia -10%", "Economia -20%", "Economia -30%"],
    datasets: [
      {
        label: "Custo Mensal (R$)",
        data: [1890, 1701, 1512, 1323],
        backgroundColor: [
          "rgba(99, 102, 241, 0.2)",
          "rgba(34, 197, 94, 0.2)",
          "rgba(34, 197, 94, 0.3)",
          "rgba(34, 197, 94, 0.4)",
        ],
        borderColor: [
          "rgb(99, 102, 241)",
          "rgb(34, 197, 94)",
          "rgb(34, 197, 94)",
          "rgb(34, 197, 94)",
        ],
        borderWidth: 1,
      },
    ],
  };

  const savings = {
    10: 189,
    20: 378,
    30: 567,
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      {/* Title */}
      <div className="mb-8">
        <h1 className="dashboard-title text-white mb-2">Simulador de Economia</h1>
        <p className="subtitle text-gray-400">
          Veja quanto você pode economizar com nossas recomendações
        </p>
      </div>

      {/* Scenario Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[10, 20, 30].map((pct) => (
          <button
            key={pct}
            onClick={() => setScenario(pct)}
            className={`p-6 rounded-lg backdrop-blur-sm border transition-all ${
              scenario === pct
                ? "bg-gradient-to-br from-green-600 to-emerald-700 border-green-400"
                : "bg-gradient-to-br from-gray-900 to-gray-800 border-gray-700 hover:border-gray-600"
            }`}
          >
            <p className="menu-text mb-2 text-gray-200">Economia de {pct}%</p>
            <p className={`card-kpi ${scenario === pct ? "text-white" : "text-green-400"}`}>
              R$ {savings[pct as keyof typeof savings].toFixed(2)}
            </p>
            <p className="chart-legend text-gray-400 mt-2">por mês</p>
          </button>
        ))}
      </div>

      {/* Comparison Chart */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700 mb-8">
        <h2 className="section-title text-white mb-4">Comparação de Cenários</h2>
        <Chart type="bar" data={scenarioData} />
      </div>

      {/* Strategies */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-blue-400" />
            <h3 className="section-title text-white">Estratégia -10%</h3>
          </div>
          <ul className="space-y-2">
            <li className="table-text text-gray-300">
              ✓ Otimizar uso de horários fora de pico
            </li>
            <li className="table-text text-gray-300">
              ✓ Revisar equipamentos antigos
            </li>
            <li className="table-text text-gray-300">
              ✓ Desligar standby desnecessário
            </li>
          </ul>
        </div>

        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-green-400" />
            <h3 className="section-title text-white">Estratégia -30%</h3>
          </div>
          <ul className="space-y-2">
            <li className="table-text text-gray-300">
              ✓ Instalar energia solar (painéis)
            </li>
            <li className="table-text text-gray-300">
              ✓ Trocar iluminação por LED
            </li>
            <li className="table-text text-gray-300">
              ✓ Implementar sistema de controle inteligente
            </li>
          </ul>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 rounded-lg p-6 backdrop-blur-sm border border-blue-700/50">
        <h2 className="section-title text-white mb-3">Economia Anual Potencial</h2>
        <p className="card-kpi text-green-400 mb-2">
          R$ {(savings[scenario as keyof typeof savings] * 12).toFixed(2)}
        </p>
        <p className="subtitle text-gray-300">
          Com cenário de {scenario}% de redução de consumo
        </p>
      </div>
    </div>
  );
}
