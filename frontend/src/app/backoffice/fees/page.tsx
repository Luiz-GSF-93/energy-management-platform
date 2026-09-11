'use client';
import { useState, useEffect } from 'react';
import { DollarSign } from 'lucide-react';

export default function FeesPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign className="text-orange-500" size={32} />
        <h1 className="text-3xl font-bold">Gestão de Faturas</h1>
      </div>
      <div className="bg-gray-800 rounded-lg p-6 text-center text-gray-400">
        <p>Nenhuma fatura encontrada</p>
        <a href="#" className="text-orange-500 hover:underline mt-2 inline-block">
          Criar primeira fatura
        </a>
      </div>
    </div>
  );
}
