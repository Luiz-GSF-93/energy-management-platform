"use client";

import { useEffect, useState } from "react";
import { Chart } from "@/components/dashboard/Chart";
import { AlertCircle, TrendingUp, Zap, DollarSign } from "lucide-react";

interface Report {
  period: string;
  consumption: number;
  cost: number;
}

export default function AnalysisPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState("week");

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoading(true);
        setError(null);

        const token = localStorage.getItem("auth_token");
        if (!token) {
          setError("Autenticação necessária");
          return;
        }

        const response = await fetch(
          "https://energy-management-platform.onrender.com/api/v1/reports",
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Erro da API: ${response.status}`);
        }

        const data = await response.json();

        // Validar dados
        if (!Array.isArray(data)) {
          setReports([]);
          setError("Formato de dados inválido da API");
          return;
        }

        // Validar cada item
        const validReports = data.filter(
          (item: any) =>
            item &&
            typeof item.consumption === "number" &&
            typeof item.cost === "number"
        );

        if (validReports.length === 0) {
          setReports([]);
          setError("Nenhum dado de relatório disponível");
          return;
        }

        setReports(validReports);
      } catch (err) {
        console.error("Erro ao carregar relatórios:", err);
        setError(
          err instanceof Error ? err.message : "Erro ao carregar dados"
        );
        setReports([]);
      } finally {
        setLoading(false);
      }
    };

    fetchReports();
  }, []);

  // Preparar dados para o gráfico
  const chartData = {
    labels: reports.map((r) => r.period || "Sem data"),
    datasets: [
      {
        label: "Consumo (kWh)",
        data: reports.map((r) => r.consumption || 0),
        borderColor: "#06b6d4",
        backgroundColor: "rgba(6, 182, 212, 0.1)",
        tension: 0.4,
      },
    ],
  };

  const costChartData = {
    labels: reports.map((r) => r.period || "Sem data"),
    datasets: [
      {
        label: "Custo (R$)",
        data: reports.map((r) => r.cost || 0),
        backgroundColor: "#10b981",
        borderColor: "#10b981",
      },
    ],
  };

  // KPIs calculados
  const avgConsumption =
    reports.length > 0
      ? Math.round(
          reports.reduce((sum, r) => sum + (r.consumption || 0), 0) /
            reports.length
        )
      : 0;

  const totalCost =
    reports.length > 0
      ? reports.reduce((sum, r) => sum + (r.cost || 0), 0)
      : 0;

  const maxConsumption =
    reports.length > 0
      ? Math.max(...reports.map((r) => r.consumption || 0))
      : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Cabeçalho */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Análise de Consumo
          </h1>
          <p className="text-slate-400">
            Visualize suas tendências e economia de energia
          </p>
        </div>

        {/* Seletor de período */}
        <div className="mb-6 flex gap-2">
          {["Semana", "Mês", "Trimestre"].map((label, idx) => (
            <button
              key={idx}
              onClick={() => setTimeframe(["week", "month", "quarter"][idx])}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                timeframe === ["week", "month", "quarter"][idx]
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Mensagem de erro */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700/50 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p className="text-slate-400 mt-4">Carregando dados...</p>
          </div>
        )}

        {/* KPI Cards */}
        {!loading && !error && reports.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 backdrop-blur">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-slate-400 text-sm">Consumo Médio</p>
                  <Zap className="w-5 h-5 text-yellow-500" />
                </div>
                <p className="text-3xl font-bold text-white">{avgConsumption}</p>
                <p className="text-slate-500 text-xs mt-1">kWh</p>
              </div>

              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 backdrop-blur">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-slate-400 text-sm">Custo Total</p>
                  <DollarSign className="w-5 h-5 text-green-500" />
                </div>
                <p className="text-3xl font-bold text-white">
                  R$ {totalCost.toFixed(2)}
                </p>
                <p className="text-slate-500 text-xs mt-1">período</p>
              </div>

              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 backdrop-blur">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-slate-400 text-sm">Pico de Consumo</p>
                  <TrendingUp className="w-5 h-5 text-cyan-500" />
                </div>
                <p className="text-3xl font-bold text-white">{maxConsumption}</p>
                <p className="text-slate-500 text-xs mt-1">kWh</p>
              </div>
            </div>

            {/* Gráficos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 backdrop-blur">
                <h3 className="text-lg font-semibold text-white mb-4">
                  Consumo (kWh)
                </h3>
                <Chart
                  type="line"
                  data={chartData}
                  options={{ responsive: true }}
                />
              </div>

              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 backdrop-blur">
                <h3 className="text-lg font-semibold text-white mb-4">
                  Custo (R$)
                </h3>
                <Chart
                  type="bar"
                  data={costChartData}
                  options={{ responsive: true }}
                />
              </div>
            </div>
          </>
        )}

        {/* Sem dados */}
        {!loading && !error && reports.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p>Nenhum dado disponível para este período.</p>
          </div>
        )}
      </div>
    </div>
  );
}
