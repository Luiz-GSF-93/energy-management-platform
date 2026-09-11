'use client';

import { useState } from 'react';
import { Save, Bell, Lock, User, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    fullName: 'João Silva',
    email: 'teste@expertenergy.com.br',
    phone: '(11) 98765-4321',
  });

  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    smsAlerts: false,
    pushNotifications: true,
  });

  const [saved, setSaved] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleNotificationChange = (key: string) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    router.push('/auth/login');
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Configurações</h1>
        <p className="text-gray-400">Gerencie seu perfil e preferências</p>
      </div>

      {saved && (
        <div className="mb-6 p-4 bg-green-500/20 border border-green-500/30 rounded-lg">
          <p className="text-green-400 font-medium">✓ Alterações salvas!</p>
        </div>
      )}

      <div className="relative group mb-8">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10"></div>
        <div className="relative p-6">
          <div className="flex items-center gap-3 mb-6">
            <User className="w-6 h-6 text-orange-500" />
            <h2 className="text-xl font-semibold text-white">Perfil</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-gray-300 font-medium mb-2">Nome</label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleInputChange}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-orange-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-gray-300 font-medium mb-2">Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-orange-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-gray-300 font-medium mb-2">Telefone</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-orange-500 transition-all"
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            className="mt-6 flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white rounded-lg font-semibold transition-all"
          >
            <Save className="w-5 h-5" />
            Salvar
          </button>
        </div>
      </div>

      <div className="relative group mb-8">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10"></div>
        <div className="relative p-6">
          <div className="flex items-center gap-3 mb-6">
            <Bell className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-semibold text-white">Notificações</h2>
          </div>

          <div className="space-y-4">
            {[
              { key: 'emailAlerts', label: 'Email', desc: 'Alertas por email' },
              { key: 'smsAlerts', label: 'SMS', desc: 'Alertas por SMS' },
              { key: 'pushNotifications', label: 'Push', desc: 'Notificações push' },
            ].map((n) => (
              <div key={n.key} className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-lg">
                <div>
                  <p className="text-white font-medium">{n.label}</p>
                  <p className="text-gray-400 text-sm">{n.desc}</p>
                </div>
                <button
                  onClick={() => handleNotificationChange(n.key)}
                  className={`w-12 h-6 rounded-full transition-all ${
                    notifications[n.key as keyof typeof notifications]
                      ? 'bg-orange-500'
                      : 'bg-white/10'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      notifications[n.key as keyof typeof notifications]
                        ? 'translate-x-6'
                        : 'translate-x-0.5'
                    }`}
                  ></div>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="relative group">
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-red-600/5 rounded-xl backdrop-blur-md border border-red-500/20"></div>
        <div className="relative p-6">
          <h2 className="text-xl font-semibold text-red-400 mb-6">Sair</h2>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-6 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg font-medium transition-all"
          >
            <LogOut className="w-5 h-5" />
            Sair da Conta
          </button>
        </div>
      </div>
    </div>
  );
}
