'use client';

import { useState, useEffect } from 'react';

export default function ClientDashboard() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Bem-vindo!</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Gerencie suas faturas e análises de energia</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Minhas Faturas</h3>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Visualize todas as suas faturas</p>
          <p className="text-3xl font-bold text-blue-600 mt-4">0</p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Economia Total</h3>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Seu valor economizado</p>
          <p className="text-3xl font-bold text-green-600 mt-4">R$ 0,00</p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Próximo Vencimento</h3>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Fatura próxima</p>
          <p className="text-gray-600 dark:text-gray-400 mt-4">--</p>
        </div>
      </div>
    </div>
  );
}
