"use client";

import { useState, useEffect } from "react";
import { TrendingUp, AlertCircle, Zap, Activity } from "lucide-react";
import { Chart } from "@/components/dashboard/Chart";

export default function DashboardHome() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInvoices = async () => {
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
          const data = await response.json();
          setInvoices(data.slice(0, 5));
        }
      } catch (error) {
        console.error("Erro ao buscar faturas:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchInvoices();
  }, []);

  const kpis = [
    {
      label: "Economia Total",
      value: "R$ 2,450.00",
      trend: "+12%",
      icon: TrendingUp,
      color: "from-green-500 to-emerald-600",
    },
    {
      label: "Total de Faturas",
      value: "24",
      trend: "↑ 3 este mês",
      icon: Zap,
      color: "from-blue-500 to-cyan-600",
    },
    {
      label: "Consumo Médio",
      value: "1,240 kWh",
      trend: "-8% vs mês anterior",
      icon: Activity,
      color: "from-purple-500 to-pink-600",
    },
    {
      label: "Alertas Ativos",
      value: "2",
      trend: "Atenção necessária",
      icon: AlertCircle,
      color: "from-orange-500 to-red-600",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      {/* Dashboard Title */}
      <div className="mb-8">
        <h1 className="dashboard-title text-white mb-2">Dashboard</h1>
        <p className="subtitle text-gray-400">
          Bem-vindo de volta! Aqui está seu resumo de consumo e economia.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700 hover:border-gray-600 transition-all duration-300"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="menu-text text-gray-400 mb-2">{kpi.label}</p>
                  <p className="card-kpi text-white">{kpi.value}</p>
                </div>
                <div
                  className={`bg-gradient-to-br ${kpi.color} p-3 rounded-lg`}
                >
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
              <p className="chart-legend text-gray-500">{kpi.trend}</p>
            </div>
          );
        })}
      </div>

      {/* Cost & Forecast Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Custo Este Mês */}
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <h2 className="section-title text-white mb-4">Custo Este Mês</h2>
          <p className="card-kpi text-green-400">R$ 1,890.50</p>
          <p className="subtitle text-gray-400 mt-2">
            ↓ 15% vs mês anterior
          </p>
        </div>

        {/* Economia Projetada */}
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <h2 className="section-title text-white mb-4">Economia Projetada</h2>
          <p className="card-kpi text-blue-400">R$ 560.00</p>
          <p className="subtitle text-gray-400 mt-2">
            Com implementação de recomendações
          </p>
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
        <h2 className="section-title text-white mb-4">Faturas Recentes</h2>
        {loading ? (
          <p className="table-text text-gray-400">Carregando...</p>
        ) : invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="table-text text-gray-400 text-left py-3">
                    Data
                  </th>
                  <th className="table-text text-gray-400 text-left py-3">
                    Valor
                  </th>
                  <th className="table-text text-gray-400 text-left py-3">
                    Consumo
                  </th>
                  <th className="table-text text-gray-400 text-left py-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice: any, idx) => (
                  <tr key={idx} className="border-b border-gray-700 hover:bg-gray-700/20 transition-colors">
                    <td className="table-text text-gray-300 py-3">
                      {new Date(invoice.date).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="table-text text-gray-300 py-3">
                      R$ {invoice.amount.toFixed(2)}
                    </td>
                    <td className="table-text text-gray-300 py-3">
                      {invoice.consumption} kWh
                    </td>
                    <td className="py-3">
                      <span className="table-text bg-green-900 text-green-200 px-3 py-1 rounded-full text-xs font-medium">
                        Pago
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="table-text text-gray-400">Nenhuma fatura encontrada</p>
        )}
      </div>
    </div>
  );
}
