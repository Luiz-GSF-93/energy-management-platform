'use client';

import { useState } from 'react';
import { Calendar, User, Edit, CheckCircle, Eye } from 'lucide-react';

interface AuditLog {
  id: string;
  timestamp: Date;
  user: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE';
  entityName: string;
  changes: Record<string, { old: any; new: any }>;
  status: 'success' | 'failed';
}

export default function AuditPage() {
  const [filter, setFilter] = useState<'all' | 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE'>('all');
  const [selectedLog, setSelectedLog] = useState<string | null>(null);

  const mockLogs: AuditLog[] = [
    {
      id: '1',
      timestamp: new Date('2026-06-15T14:30:00'),
      user: 'João Silva (admin@expertenergy.com.br)',
      action: 'CREATE',
      entityName: 'INV-202606-0001',
      changes: { invoiceNumber: { old: null, new: 'INV-202606-0001' }, totalAmount: { old: null, new: 2150.50 } },
      status: 'success',
    },
    {
      id: '2',
      timestamp: new Date('2026-06-15T15:45:00'),
      user: 'Maria Santos (gerente@expertenergy.com.br)',
      action: 'UPDATE',
      entityName: 'INV-202606-0001',
      changes: { status: { old: 'draft', new: 'issued' }, dueDate: { old: '2026-07-15', new: '2026-07-20' } },
      status: 'success',
    },
    {
      id: '3',
      timestamp: new Date('2026-06-16T09:15:00'),
      user: 'System',
      action: 'APPROVE',
      entityName: 'INV-202606-0001',
      changes: { approvedBy: { old: null, new: 'admin@expertenergy.com.br' }, approvedAt: { old: null, new: '2026-06-16T09:15:00' } },
      status: 'success',
    },
  ];

  const getActionColor = (action: string) => {
    const colors: Record<string, string> = {
      CREATE: 'bg-green-900/30 text-green-300 border-green-700',
      UPDATE: 'bg-blue-900/30 text-blue-300 border-blue-700',
      DELETE: 'bg-red-900/30 text-red-300 border-red-700',
      APPROVE: 'bg-emerald-900/30 text-emerald-300 border-emerald-700',
    };
    return colors[action] || 'bg-slate-700 text-slate-300';
  };

  const getActionIcon = (action: string) => {
    const icons: Record<string, React.ReactNode> = {
      CREATE: <Edit size={16} />,
      UPDATE: <Edit size={16} />,
      DELETE: <Edit size={16} />,
      APPROVE: <CheckCircle size={16} />,
    };
    return icons[action];
  };

  const filteredLogs = filter === 'all' ? mockLogs : mockLogs.filter(log => log.action === filter);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-white">🔍 Auditoria e Histórico</h1>
        <p className="text-slate-400 mt-1">Histórico completo de todas as alterações</p>
      </div>

      {/* Filtros */}
      <div className="flex gap-4 flex-wrap">
        {['all', 'CREATE', 'UPDATE', 'APPROVE'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f as any)}
            className={`px-4 py-2 rounded-lg transition ${
              filter === f
                ? 'bg-orange-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {f === 'all' ? 'Todos' : f}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="space-y-4">
        {filteredLogs.map((log, index) => (
          <div key={log.id} className="bg-slate-800 rounded-lg shadow-lg border border-slate-700 overflow-hidden hover:border-slate-600 transition">
            <div className="p-6 flex items-start gap-4">
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getActionColor(log.action)} border`}>
                  {getActionIcon(log.action)}
                </div>
                {index < filteredLogs.length - 1 && (
                  <div className="w-1 h-8 bg-slate-700 mt-2"></div>
                )}
              </div>

              <div className="flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {log.action} - {log.entityName}
                    </h3>
                    <div className="flex items-center gap-4 mt-2 text-sm text-slate-400">
                      <div className="flex items-center gap-1">
                        <User size={14} /> {log.user}
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar size={14} /> {log.timestamp.toLocaleString('pt-BR')}
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setSelectedLog(selectedLog === log.id ? null : log.id)} className="text-blue-400 hover:text-blue-300">
                    <Eye size={20} />
                  </button>
                </div>

                {selectedLog === log.id && (
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <h4 className="font-semibold text-white mb-2">Detalhes das Alterações:</h4>
                    <div className="space-y-2 text-sm">
                      {Object.entries(log.changes).map(([field, change]) => (
                        <div key={field} className="bg-slate-900 p-2 rounded text-slate-300">
                          <span className="font-semibold">{field}:</span>
                          <div className="ml-2 mt-1">
                            <div className="text-red-400">❌ Antes: {JSON.stringify(change.old)}</div>
                            <div className="text-green-400">✅ Depois: {JSON.stringify(change.new)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
