'use client';

import { useState } from 'react';
import { X, Plus, Trash2, Edit2 } from 'lucide-react';

interface Distributor {
  id: string;
  name: string;
  cnpj: string;
}

interface DistributorModalProps {
  isOpen: boolean;
  onClose: () => void;
  distributors: Distributor[];
  onAddDistributor: (distributor: Distributor) => void;
  onDeleteDistributor: (id: string) => void;
  onSelectDistributor: (distributor: Distributor) => void;
}

export function DistributorModal({
  isOpen,
  onClose,
  distributors,
  onAddDistributor,
  onDeleteDistributor,
  onSelectDistributor,
}: DistributorModalProps) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', cnpj: '' });
  const [editingId, setEditingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.cnpj) {
      alert('Preencha todos os campos');
      return;
    }

    const newDistributor = {
      id: editingId || Date.now().toString(),
      ...formData,
    };

    onAddDistributor(newDistributor);
    setFormData({ name: '', cnpj: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (distributor: Distributor) => {
    setFormData({ name: distributor.name, cnpj: distributor.cnpj });
    setEditingId(distributor.id);
    setShowForm(true);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900 rounded-lg shadow-xl border border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between p-6 bg-slate-800 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">🏢 Gerenciar Concessionárias</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Add Form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="bg-slate-800 p-4 rounded-lg border border-slate-700 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Nome da Concessionária *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: CPFL, Enel, Cemig"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CNPJ *</label>
                  <input
                    type="text"
                    value={formData.cnpj}
                    onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                    placeholder="00.000.000/0000-00"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition font-medium"
                >
                  {editingId ? '✏️ Atualizar' : '➕ Adicionar'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setFormData({ name: '', cnpj: '' });
                    setEditingId(null);
                  }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-medium"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {/* Add Button */}
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="w-full px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition font-medium flex items-center justify-center gap-2"
            >
              <Plus size={20} /> Nova Concessionária
            </button>
          )}

          {/* List */}
          {distributors.length === 0 ? (
            <div className="text-center py-8 text-slate-400">Nenhuma concessionária cadastrada</div>
          ) : (
            <div className="space-y-2">
              {distributors.map((dist) => (
                <div
                  key={dist.id}
                  className="flex items-center justify-between p-4 bg-slate-800 border border-slate-700 rounded-lg hover:border-slate-600 transition"
                >
                  <div className="flex-1">
                    <h3 className="font-semibold text-white">{dist.name}</h3>
                    <p className="text-sm text-slate-400">{dist.cnpj}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(dist)}
                      className="p-2 text-blue-400 hover:bg-slate-700 rounded transition"
                      title="Editar"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Deseja deletar esta concessionária?')) {
                          onDeleteDistributor(dist.id);
                        }
                      }}
                      className="p-2 text-red-400 hover:bg-slate-700 rounded transition"
                      title="Deletar"
                    >
                      <Trash2 size={18} />
                    </button>
                    <button
                      onClick={() => {
                        onSelectDistributor(dist);
                        onClose();
                      }}
                      className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition"
                    >
                      Selecionar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
