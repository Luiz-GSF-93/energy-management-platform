"use client";

import { useState, useEffect } from "react";
import { TrendingUp, Target, Loader } from "lucide-react";
import { Chart } from "@/components/dashboard/Chart";

interface ConsumptionData {
  consumption: number;
  cost: number;
}

export default function SavingsPage() {
  const [scenario, setScenario] = useState(10);
  const [data, setData] = useState<ConsumptionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(
          "https://energy-management-platform.onrender.com/api/v1/invoices",
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (response.ok) {
          const invoices = await response.json();
          const totalCost = invoices.reduce((sum: number, inv: any) => sum + inv.amount, 0);
          const avgCost = totalCost / (invoices.length || 1);
          
          setData({
            consumption: invoices.length > 0 ? invoices[0].consumption : 1240,
            cost: avgCost * invoices.length,
          });
        }
      } catch (err) {
        console.error(err);
        setData({ consumption: 1240, cost: 1890 }); // Fallback
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const currentCost = data?.cost || 1890;
  const savings = {
    10: Math.round(currentCost * 0.1),
    20: Math.round(currentCost * 0.2),
    30: Math.round(currentCost * 0.3),
  };

  const scenarioData = {
    labels: ["Consumo Atual", "Economia -10%", "Economia -20%", "Economia -30%"],
    datasets: [
      {
        label: "Custo Mensal (R$)",
        data: [
          currentCost,
          currentCost - savings[10],
          currentCost - savings[20],
          currentCost - savings[30],
        ],
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

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
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
              {loading ? (
                <Loader className="w-6 h-6 animate-spin" />
              ) : (
                `R$ ${savings[pct as keyof typeof savings]}`
              )}
            </p>
            <p className="chart-legend text-gray-400 mt-2">por mês</p>
          </button>
        ))}
      </div>

      {/* Comparison Chart */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700 mb-8">
        <h2 className="section-title text-white mb-4">Comparação de Cenários</h2>
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader className="w-8 h-8 animate-spin text-blue-400" />
          </div>
        ) : (
          <Chart type="bar" data={scenarioData} />
        )}
      </div>

      {/* Strategies */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-blue-400" />
            <h3 className="section-title text-white">Estratégia -10%</h3>
          </div>
          <ul className="space-y-2">
            <li className="table-text text-gray-300">✓ Otimizar uso de horários fora de pico</li>
            <li className="table-text text-gray-300">✓ Revisar equipamentos antigos</li>
            <li className="table-text text-gray-300">✓ Desligar standby desnecessário</li>
          </ul>
        </div>

        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-green-400" />
            <h3 className="section-title text-white">Estratégia -30%</h3>
          </div>
          <ul className="space-y-2">
            <li className="table-text text-gray-300">✓ Instalar energia solar (painéis)</li>
            <li className="table-text text-gray-300">✓ Trocar iluminação por LED</li>
            <li className="table-text text-gray-300">✓ Implementar sistema de controle inteligente</li>
          </ul>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 rounded-lg p-6 backdrop-blur-sm border border-blue-700/50">
        <h2 className="section-title text-white mb-3">Economia Anual Potencial</h2>
        <p className="card-kpi text-green-400 mb-2">
          {loading ? (
            <Loader className="w-6 h-6 animate-spin" />
          ) : (
            `R$ ${(savings[scenario as keyof typeof savings] * 12).toLocaleString("pt-BR")}`
          )}
        </p>
        <p className="subtitle text-gray-300">
          Com cenário de {scenario}% de redução de consumo
        </p>
      </div>
    </div>
  );
}
