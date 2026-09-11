"use client";

import { useState, useEffect } from "react";
import { Download, Filter } from "lucide-react";

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

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
          setInvoices(data);
        }
      } catch (error) {
        console.error("Erro ao buscar faturas:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchInvoices();
  }, []);

  const totalValue = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalConsumption = invoices.reduce((sum, inv) => sum + inv.consumption, 0);

  const downloadCSV = () => {
    const csv =
      "Data,Valor,Consumo,Status\n" +
      invoices
        .map(
          (inv) =>
            `${new Date(inv.date).toLocaleDateString("pt-BR")},R$ ${inv.amount.toFixed(2)},${inv.consumption} kWh,Pago`
        )
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "faturas.csv";
    a.click();
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      {/* Title */}
      <div className="mb-8">
        <h1 className="dashboard-title text-white mb-2">Faturas</h1>
        <p className="subtitle text-gray-400">
          Gerencie e acompanhe suas faturas de energia
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <p className="menu-text text-gray-400 mb-2">Total de Faturas</p>
          <p className="card-kpi text-white">{invoices.length}</p>
        </div>
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <p className="menu-text text-gray-400 mb-2">Valor Total</p>
          <p className="card-kpi text-green-400">
            R$ {totalValue.toFixed(2)}
          </p>
        </div>
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700">
          <p className="menu-text text-gray-400 mb-2">Consumo Total</p>
          <p className="card-kpi text-blue-400">{totalConsumption} kWh</p>
        </div>
      </div>

      {/* Filters & Export */}
      <div className="flex flex-col md:flex-row gap-4 mb-6 items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`menu-text px-4 py-2 rounded-lg transition-all ${
              filter === "all"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <Filter className="w-4 h-4 inline mr-2" />
            Todas
          </button>
          <button
            onClick={() => setFilter("paid")}
            className={`menu-text px-4 py-2 rounded-lg transition-all ${
              filter === "paid"
                ? "bg-green-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            Pagas
          </button>
        </div>
        <button
          onClick={downloadCSV}
          className="menu-text px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 text-white hover:from-blue-700 hover:to-cyan-700 transition-all flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Exportar CSV
        </button>
      </div>

      {/* Invoices Table */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700 overflow-x-auto">
        {loading ? (
          <p className="table-text text-gray-400 text-center py-8">
            Carregando faturas...
          </p>
        ) : invoices.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="table-text text-gray-400 text-left py-4">
                  Data
                </th>
                <th className="table-text text-gray-400 text-left py-4">
                  Período
                </th>
                <th className="table-text text-gray-400 text-left py-4">
                  Consumo
                </th>
                <th className="table-text text-gray-400 text-left py-4">
                  Valor
                </th>
                <th className="table-text text-gray-400 text-left py-4">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice: any, idx) => (
                <tr
                  key={idx}
                  className="border-b border-gray-700 hover:bg-gray-700/20 transition-colors"
                >
                  <td className="table-text text-gray-300 py-4">
                    {new Date(invoice.date).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="table-text text-gray-300 py-4">
                    {invoice.period || "Mensal"}
                  </td>
                  <td className="table-text text-gray-300 py-4">
                    {invoice.consumption} kWh
                  </td>
                  <td className="table-text text-gray-300 py-4">
                    R$ {invoice.amount.toFixed(2)}
                  </td>
                  <td className="py-4">
                    <span className="table-text bg-green-900 text-green-200 px-3 py-1 rounded-full text-xs font-medium">
                      Pago
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="table-text text-gray-400 text-center py-8">
            Nenhuma fatura encontrada
          </p>
        )}
      </div>
    </div>
  );
}
