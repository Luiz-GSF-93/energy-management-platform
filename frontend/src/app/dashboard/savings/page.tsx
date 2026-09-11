'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function SavingsPage() {
  const [selectedSimulation, setSelectedSimulation] = useState<string>('default');

  const savingsData = {
    totalSavings: 2847.50,
    savingsThisMonth: 123.45,
    savingsPercentage: 12.5,
    projectedAnnualSavings: 1485.60,
  };

  const simulations = [
    {
      id: 'default',
      name: 'Baseline',
      description: 'Seu consumo atual',
      annualCost: 5860,
      annualSavings: 0,
      projectedConsumption: 1250,
    },
    {
      id: 'reducao10',
      name: 'Redução 10%',
      description: 'Reduzindo em 10%',
      annualCost: 5274,
      annualSavings: 586,
      projectedConsumption: 1125,
    },
    {
      id: 'reducao20',
      name: 'Redução 20%',
      description: 'Reduzindo em 20%',
      annualCost: 4688,
      annualSavings: 1172,
      projectedConsumption: 1000,
    },
    {
      id: 'reducao30',
      name: 'Redução 30%',
      description: 'Reduzindo em 30%',
      annualCost: 4102,
      annualSavings: 1758,
      projectedConsumption: 875,
    },
  ];

  const selectedSim = simulations.find(s => s.id === selectedSimulation)!;
  const strategies = [
    { icon: '🌙', title: 'AC Inteligente', desc: 'Economiza 15-20%' },
    { icon: '💡', title: 'Trocar para LEDs', desc: 'Economiza 5-10%' },
    { icon: '🔌', title: 'Desconectar Standby', desc: 'Economiza 3-5%' },
    { icon: '🌍', title: 'Painéis Solares', desc: 'Economiza 40-60%' },
  ];

  return (
    <div className="p-6 sm:p-8 bg-gray-950 min-h-full">
      {/* Back Button */}
      <Link href="/dashboard">
        <button className="flex items-center gap-2 mb-6 text-orange-400 hover:text-orange-300 transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Voltar ao Dashboard</span>
        </button>
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Economia</h1>
        <p className="text-gray-400 text-sm sm:text-base">Visualize e simule suas economias</p>
      </div>

      {/* Summary Cards - Responsivo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        {[
          { label: 'Total Economizado', value: `R$ ${savingsData.totalSavings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
          { label: 'Este Mês', value: `R$ ${savingsData.savingsThisMonth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
          { label: 'Percentual', value: `${savingsData.savingsPercentage}%` },
          { label: 'Projeção Anual', value: `R$ ${savingsData.projectedAnnualSavings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
        ].map((card, i) => (
          <div key={i} className="relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10 group-hover:border-white/20 transition-all"></div>
            <div className="relative p-3 sm:p-4">
              <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">{card.label}</p>
              <p className="text-lg sm:text-2xl font-bold text-green-400 break-words">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Simulation Section */}
      <div className="mb-8">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-4 sm:mb-6">Simule suas economias</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {simulations.map((sim) => (
            <button
              key={sim.id}
              onClick={() => setSelectedSimulation(sim.id)}
              className={`p-3 sm:p-4 rounded-lg border transition-all text-left ${
                selectedSimulation === sim.id
                  ? 'bg-gradient-to-r from-orange-500/30 to-red-600/20 border-orange-500'
                  : 'bg-white/5 border-white/10 hover:border-white/20'
              }`}
            >
              <h3 className="font-semibold text-white text-sm sm:text-base mb-1">{sim.name}</h3>
              <p className="text-gray-400 text-xs sm:text-sm mb-2 sm:mb-3">{sim.description}</p>
              <div className="text-xl sm:text-2xl font-bold text-green-400">R$ {sim.annualSavings}</div>
            </button>
          ))}
        </div>

        {/* Details and Comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Details */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10"></div>
            <div className="relative p-4 sm:p-6">
              <h3 className="text-base sm:text-lg font-semibold text-white mb-4 sm:mb-6">Detalhes</h3>
              <div className="space-y-3 sm:space-y-4">
                <div>
                  <p className="text-gray-400 text-xs sm:text-sm">Consumo Mensal</p>
                  <p className="text-2xl sm:text-3xl font-bold text-white">{selectedSim.projectedConsumption} kWh</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs sm:text-sm">Custo Anual</p>
                  <p className="text-2xl sm:text-3xl font-bold text-white">R$ {selectedSim.annualCost}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs sm:text-sm">Economia</p>
                  <p className="text-2xl sm:text-3xl font-bold text-green-400">R$ {selectedSim.annualSavings}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Comparison */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10"></div>
            <div className="relative p-4 sm:p-6">
              <h3 className="text-base sm:text-lg font-semibold text-white mb-4 sm:mb-6">Comparação</h3>
              <div className="space-y-3 sm:space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <p className="text-gray-400 text-xs sm:text-sm">Cenário Atual</p>
                    <p className="text-white text-xs sm:text-sm font-semibold">R$ {simulations[0].annualCost}</p>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-red-500" style={{ width: '100%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <p className="text-gray-400 text-xs sm:text-sm">Selecionada</p>
                    <p className="text-white text-xs sm:text-sm font-semibold">R$ {selectedSim.annualCost}</p>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500" style={{ width: `${(selectedSim.annualCost / simulations[0].annualCost) * 100}%` }}></div>
                  </div>
                </div>
              </div>
              <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-green-400 font-semibold text-xs sm:text-sm">
                  💰 Economizaria R$ {(simulations[0].annualCost - selectedSim.annualCost).toLocaleString('pt-BR')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strategies */}
      <div className="relative group">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10"></div>
        <div className="relative p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold text-white mb-4 sm:mb-6">Estratégias Recomendadas</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {strategies.map((s, i) => (
              <div key={i} className="p-3 sm:p-4 bg-white/5 border border-white/10 rounded-lg hover:border-white/20 transition-all">
                <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">{s.icon}</div>
                <h4 className="font-semibold text-white text-sm sm:text-base mb-1">{s.title}</h4>
                <p className="text-green-400 font-semibold text-xs sm:text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
