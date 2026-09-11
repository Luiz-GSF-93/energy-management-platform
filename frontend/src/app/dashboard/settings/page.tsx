'use client';
import { Settings, Save } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-blue-900">Configurações</h1>
      <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
        <div>
          <label className="block text-sm text-gray-700 mb-2">Nome Completo</label>
          <input
            type="text"
            placeholder="Seu nome"
            className="w-full border border-gray-300 rounded px-4 py-2 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-2">Email</label>
          <input
            type="email"
            placeholder="seu.email@example.com"
            className="w-full border border-gray-300 rounded px-4 py-2 focus:outline-none focus:border-blue-500"
          />
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded transition">
          <Save size={18} />
          Salvar
        </button>
      </div>
    </div>
  );
}
