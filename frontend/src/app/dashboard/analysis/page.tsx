'use client';

import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Calendar } from 'lucide-react';

export default function AnalysisPage() {
  const [consumptionData, setConsumptionData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const mockData = [
      { month: 'Abril', consumption: 1100, cost: 450 },
      { month: 'Maio', consumption: 1200, cost: 490 },
      { month: 'Junho', consumption: 1350, cost: 550 },
      { month: 'Julho', consumption: 1200, cost: 498 },
      { month: 'Agosto', consumption: 1380, cost: 512 },
      { month: 'Setembro', consumption: 1250, cost: 488 },
    ];
    setConsumptionData(mockData);
    setLoading(false);
  }, []);

  const avgConsumption = consumptionData.reduce((sum, d) => sum + d.consumption, 0) / consumptionData.length;
  const maxConsumption = Math.max(...consumptionData.map(d => d.consumption));
  const minConsumption = Math.min(...consumptionData.map(d => d.consumption));
  const consumptionDifference = ((maxConsumption - minConsumption) / minConsumption * 100).toFixed(1);

  return (
    <div className="p-6 sm:p-8 bg-gray-950 min-h-full">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Análise de Consumo</h1>
        <p className="text-gray-400 text-sm sm:text-base">Tendências e insights sobre seu consumo de energia</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        {[
          { title: 'Média de Consumo', value: Math.round(avgConsumption), unit: 'kWh' },
          { title: 'Pico de Consumo', value: maxConsumption, unit: 'kWh' },
          { title: 'Menor Consumo', value: minConsumption, unit: 'kWh' },
          { title: 'Variação', value: consumptionDifference, unit: '%' },
        ].map((kpi, i) => (
          <div key={i} className="relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10 group-hover:border-white/20 transition-all"></div>
            <div className="relative p-3 sm:p-4">
              <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">{kpi.title}</p>
              <p className="text-lg sm:text-2xl font-bold text-white break-words">{kpi.value} {kpi.unit}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10"></div>
          <div className="relative p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-white mb-4 sm:mb-6">Consumo por Mês</h3>
            {loading ? (
              <div className="flex justify-center h-80">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
              </div>
            ) : (
              <div className="h-60 sm:h-80 flex items-end gap-1 sm:gap-2">
                {consumptionData.map((data, idx) => {
                  const maxVal = 1500;
                  const height = (data.consumption / maxVal) * 100;
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center">
                      <div
                        className="w-full bg-gradient-to-t from-orange-500 to-red-600 rounded-t-lg hover:from-orange-600 hover:to-red-700 transition-all"
                        style={{ height: `${height}%`, minHeight: '20px' }}
                        title={`${data.month}: ${data.consumption} kWh`}
                      ></div>
                      <p className="text-xs text-gray-400 mt-2">{data.month.slice(0, 3)}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10"></div>
          <div className="relative p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-white mb-4 sm:mb-6">Custo por Mês</h3>
            {loading ? (
              <div className="flex justify-center h-80">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
              </div>
            ) : (
              <div className="h-60 sm:h-80 flex items-end gap-1 sm:gap-2">
                {consumptionData.map((data, idx) => {
                  const maxCost = 600;
                  const height = (data.cost / maxCost) * 100;
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center">
                      <div
                        className="w-full bg-gradient-to-t from-blue-500 to-cyan-400 rounded-t-lg hover:from-blue-600 hover:to-cyan-500 transition-all"
                        style={{ height: `${height}%`, minHeight: '20px' }}
                        title={`${data.month}: R$ ${data.cost}`}
                      ></div>
                      <p className="text-xs text-gray-400 mt-2">{data.month.slice(0, 3)}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative group mt-6 sm:mt-8">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10"></div>
        <div className="relative p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold text-white mb-4">Insights</h3>
          <ul className="space-y-3">
            <li className="flex items-start gap-3 p-3 sm:p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <span className="text-lg sm:text-2xl flex-shrink-0">💡</span>
              <p className="text-gray-300 text-xs sm:text-sm">
                Seu consumo pico é às <strong>18h</strong>. Tente usar aparelhos de alto consumo fora deste horário.
              </p>
            </li>
            <li className="flex items-start gap-3 p-3 sm:p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
              <span className="text-lg sm:text-2xl flex-shrink-0">✓</span>
              <p className="text-gray-300 text-xs sm:text-sm">
                Seu consumo <strong>diminuiu 3.2%</strong> em relação ao mês anterior.
              </p>
            </li>
            <li className="flex items-start gap-3 p-3 sm:p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <span className="text-lg sm:text-2xl flex-shrink-0">⚠️</span>
              <p className="text-gray-300 text-xs sm:text-sm">
                Setembro teve um consumo <strong>9% acima da média</strong> de seus últimos 6 meses.
              </p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
