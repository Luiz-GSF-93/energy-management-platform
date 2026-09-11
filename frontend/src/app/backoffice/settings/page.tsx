'use client';
import { useState, useEffect } from 'react';
import { Settings, Save } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="text-orange-500" size={32} />
        <h1 className="text-3xl font-bold">Configurações</h1>
      </div>
      <div className="bg-gray-800 rounded-lg p-6 space-y-6">
        <div>
          <label className="block text-sm text-gray-300 mb-2">Nome da Empresa</label>
          <input
            type="text"
            placeholder="Expert Energy"
            className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-2">Email de Contato</label>
          <input
            type="email"
            placeholder="contato@expertenergy.com.br"
            className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white"
          />
        </div>
        <button className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 px-6 py-2 rounded transition">
          <Save size={18} />
          Salvar
        </button>
      </div>
    </div>
  );
}
