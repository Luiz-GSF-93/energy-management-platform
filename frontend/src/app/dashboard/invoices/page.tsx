"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Download, Filter } from "lucide-react";

interface Invoice {
  id: string;
  date: string;
  period?: string;
  consumption: number;
  amount: number;
  status?: "paid" | "pending";
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const fetchInvoices = async () => {
      try {
        setLoading(true);
        setError(null);

        const token = localStorage.getItem("auth_token");
        if (!token) {
          setError("Autenticação necessária");
          return;
        }

        const response = await fetch(
          "https://energy-management-platform.onrender.com/api/v1/invoices",
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
          setInvoices([]);
          setError("Formato de dados inválido da API");
          return;
        }

        // Validar cada fatura
        const validInvoices = data.filter(
          (item: any) =>
            item &&
            typeof item.consumption === "number" &&
            typeof item.amount === "number"
        );

        if (validInvoices.length === 0) {
          setInvoices([]);
          setError("Nenhuma fatura disponível");
          return;
        }

        setInvoices(validInvoices);
      } catch (err) {
        console.error("Erro ao carregar faturas:", err);
        setError(
          err instanceof Error ? err.message : "Erro ao carregar dados"
        );
        setInvoices([]);
      } finally {
        setLoading(false);
      }
    };

    fetchInvoices();
  }, []);

  // Filtrar faturas
  const filteredInvoices =
    filter === "all"
      ? invoices
      : invoices.filter((inv) => inv.status === filter);

  // Calcular totais
  const totalAmount = filteredInvoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalConsumption = filteredInvoices.reduce(
    (sum, inv) => sum + inv.consumption,
    0
  );

  // Exportar CSV
  const exportCSV = () => {
    const csv = [
      ["Data", "Período", "Consumo (kWh)", "Valor (R$)", "Status"],
      ...filteredInvoices.map((inv) => [
        inv.date,
        inv.period || "-",
        inv.consumption,
        inv.amount.toFixed(2),
        inv.status || "Sem status",
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `faturas-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Cabeçalho */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Faturas</h1>
            <p className="text-slate-400">
              Histórico de consumo e valores cobrados
            </p>
          </div>
          <button
            onClick={exportCSV}
            disabled={invoices.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white rounded-lg font-medium transition"
          >
            <Download className="w-4 h-4" />
            Exportar CSV
          </button>
        </div>

        {/* Filtro */}
        <div className="mb-6 flex gap-2">
          {["Todas", "Paga", "Pendente"].map((label, idx) => (
            <button
              key={idx}
              onClick={() => setFilter(["all", "paid", "pending"][idx])}
              className={`px-4 py-2 rounded-lg font-medium transition flex items-center gap-2 ${
                filter === ["all", "paid", "pending"][idx]
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              <Filter className="w-4 h-4" />
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
            <p className="text-slate-400 mt-4">Carregando faturas...</p>
          </div>
        )}

        {/* Resumo KPI */}
        {!loading && !error && invoices.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 backdrop-blur">
              <p className="text-slate-400 text-sm mb-1">Total Consumido</p>
              <p className="text-3xl font-bold text-white">
                {totalConsumption.toLocaleString()}
              </p>
              <p className="text-slate-500 text-xs mt-1">kWh</p>
            </div>

            <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 backdrop-blur">
              <p className="text-slate-400 text-sm mb-1">Total Devido</p>
              <p className="text-3xl font-bold text-white">
                R$ {totalAmount.toFixed(2)}
              </p>
              <p className="text-slate-500 text-xs mt-1">
                {filteredInvoices.length} faturas
              </p>
            </div>
          </div>
        )}

        {/* Tabela de Faturas */}
        {!loading && !error && filteredInvoices.length > 0 && (
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg overflow-hidden backdrop-blur">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-900/50 border-b border-slate-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">
                      Data
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">
                      Período
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-slate-300">
                      Consumo (kWh)
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-slate-300">
                      Valor (R$)
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-slate-300">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {filteredInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="hover:bg-slate-800/50 transition"
                    >
                      <td className="px-6 py-4 text-sm text-slate-200">
                        {new Date(invoice.date).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-400">
                        {invoice.period || "-"}
                      </td>
                      <td className="px-6 py-4 text-sm text-right text-slate-200">
                        {invoice.consumption.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-6 py-4 text-sm text-right font-medium text-green-400">
                        R$ {invoice.amount.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-sm text-center">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            invoice.status === "paid"
                              ? "bg-green-900/30 text-green-400"
                              : "bg-yellow-900/30 text-yellow-400"
                          }`}
                        >
                          {invoice.status === "paid" ? "Paga" : "Pendente"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sem dados */}
        {!loading && !error && invoices.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p>Nenhuma fatura disponível.</p>
          </div>
        )}
      </div>
    </div>
  );
}
