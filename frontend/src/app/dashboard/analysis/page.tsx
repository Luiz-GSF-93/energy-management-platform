"use client";

import { useState, useEffect } from "react";
import { TrendingDown, Zap, Loader } from "lucide-react";
import { Chart } from "@/components/dashboard/Chart";

interface ConsumptionData {
  month: string;
  consumption: number;
  cost: number;
}

export default function AnalysisPage() {
  const [timeframe, setTimeframe] = useState("month");
  const [data, setData] = useState<ConsumptionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(
          "https://energy-management-platform.onrender.com/api/v1/reports",
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (response.ok) {
          const reportData = await response.json();
          // Formatar dados para os charts
          const formatted = reportData.slice(0, 4).map((report: any) => ({
            month: new Date(report.date).toLocaleDateString("pt-BR", {
              month: "short",
            }),
            consumption: report.consumption || 0,
            cost: report.amount || 0,
          }));
          setData(formatted);
        } else {
          setError("Erro ao carregar dados");
        }
      } catch (err) {
        console.error(err);
        setError("Erro ao conectar ao servidor");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const consumptionData = {
    labels: data.map((d) => d.month),
    datasets: [
      {
        label: "Consumo (kWh)",
        data: data.map((d) => d.consumption),
        borderColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        tension: 0.4,
      },
    ],
  };

  const costData = {
    labels: data.map((d) => d.month),
    datasets: [
      {
        label: "Custo (R$)",
        data: data.map((d) => d.cost),
        backgroundColor: data.map((_, i) =>
          i === 0
            ? "rgba(34, 197, 94, 0.2)"
            : i === 1
            ? "rgba(34, 197, 94, 0.3)"
            : i === 2
            ? "rgba(34, 197, 94, 0.2)"
            : "rgba(34, 197, 94, 0.25)"
        ),
        borderColor: "rgb(34, 197, 94)",
        borderWidth: 1,
      },
    ],
  };

  const avgConsumption =
    data.length > 0
      ? Math.round(data.reduce((sum, d) => sum + d.consumption, 0) / data.length)
      : 0;
  const avgCost =
    data.length > 0
      ? (
          data.reduce((sum, d) => sum + d.cost, 0) / data.length
        ).toFixed(2)
      : "0";
  const maxConsumption =
    data.length > 0
      ? Math.max(...data.map((d) => d.consumption))
      : 0;

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="mb-8">
        <h1 className="dashboard-title text-white mb-2">Análise de Consumo</h1>
        <p className="subtitle text-gray-400">
          Visualize suas tendências e economia de energia
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <p className="menu-text text-gray-400 mb-2">Consumo Médio</p>
          <p className="card-kpi text-blue-400">
            {loading ? <Loader className="w-6 h-6 animate-spin" /> : `${avgConsumption} kWh`}
          </p>
          <p className="chart-legend text-gray-500 mt-2">↑ 5% vs período anterior</p>
        </div>
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <p className="menu-text text-gray-400 mb-2">Custo Médio</p>
          <p className="card-kpi text-green-400">
            {loading ? <Loader className="w-6 h-6 animate-spin" /> : `R$ ${avgCost}`}
          </p>
          <p className="chart-legend text-gray-500 mt-2">↓ 3% vs período anterior</p>
        </div>
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <p className="menu-text text-gray-400 mb-2">Pico de Consumo</p>
          <p className="card-kpi text-orange-400">
            {loading ? (
              <Loader className="w-6 h-6 animate-spin" />
            ) : (
              `${maxConsumption} kWh`
            )}
          </p>
          <p className="chart-legend text-gray-500 mt-2">Semana com maior consumo</p>
        </div>
      </div>

      {/* Timeframe Selector */}
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

      {/* Charts */}
      {error ? (
        <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-400">
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
            <h2 className="section-title text-white mb-4">Consumo por Período</h2>
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <Loader className="w-8 h-8 animate-spin text-blue-400" />
              </div>
            ) : (
              <Chart type="line" data={consumptionData} />
            )}
          </div>
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
            <h2 className="section-title text-white mb-4">Custo por Período</h2>
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <Loader className="w-8 h-8 animate-spin text-green-400" />
              </div>
            ) : (
              <Chart type="bar" data={costData} />
            )}
          </div>
        </div>
      )}

      {/* Insights */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
        <h2 className="section-title text-white mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          Insights e Recomendações
        </h2>
        <div className="space-y-3">
          <div className="flex gap-3 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <TrendingDown className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="subtitle text-white">Economia detectada</p>
              <p className="chart-legend text-gray-400">
                Redução consistente de consumo nas últimas semanas
              </p>
            </div>
          </div>
          <div className="flex gap-3 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <Zap className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="subtitle text-white">Pico de consumo detectado</p>
              <p className="chart-legend text-gray-400">
                Considere revisar uso de equipamentos em horários de pico
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
