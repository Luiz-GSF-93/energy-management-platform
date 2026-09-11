"use client";

import { useState } from "react";
import { User, Bell, Lock, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "João Silva",
    email: "teste@expertenergy.com.br",
    phone: "(11) 99999-9999",
  });

  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    smsAlerts: false,
    pushNotifications: true,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleNotificationToggle = (
    key: keyof typeof notifications
  ) => {
    setNotifications({ ...notifications, [key]: !notifications[key] });
  };

  const handleLogout = () => {
    localStorage.removeItem("auth_token");
    router.push("/auth/login");
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      {/* Title */}
      <div className="mb-8">
        <h1 className="dashboard-title text-white mb-2">Configurações</h1>
        <p className="subtitle text-gray-400">
          Gerencie suas preferências e dados pessoais
        </p>
      </div>

      {/* Profile Section */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <User className="w-5 h-5 text-blue-400" />
          <h2 className="section-title text-white">Perfil</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="menu-text text-gray-400 mb-2 block">Nome</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              className="w-full table-text bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="menu-text text-gray-400 mb-2 block">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              className="w-full table-text bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="menu-text text-gray-400 mb-2 block">Telefone</label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleInputChange}
              className="w-full table-text bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>
          <button className="menu-text w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded transition-colors">
            Salvar Mudanças
          </button>
        </div>
      </div>

      {/* Notifications Section */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-5 h-5 text-yellow-400" />
          <h2 className="section-title text-white">Notificações</h2>
        </div>
        <div className="space-y-4">
          {Object.entries(notifications).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between p-3 bg-gray-800/50 rounded border border-gray-700">
              <div>
                <p className="menu-text text-white">
                  {key === "emailAlerts"
                    ? "Alertas por Email"
                    : key === "smsAlerts"
                    ? "Alertas por SMS"
                    : "Notificações Push"}
                </p>
                <p className="chart-legend text-gray-400">
                  Receba notificações sobre seu consumo e economia
                </p>
              </div>
              <button
                onClick={() =>
                  handleNotificationToggle(key as keyof typeof notifications)
                }
                className={`w-12 h-6 rounded-full transition-colors ${
                  value ? "bg-green-600" : "bg-gray-700"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    value ? "translate-x-6" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Security Section */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg p-6 backdrop-blur-sm border border-gray-700 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-5 h-5 text-red-400" />
          <h2 className="section-title text-white">Segurança</h2>
        </div>
        <button className="menu-text w-full bg-orange-600 hover:bg-orange-700 text-white py-2 rounded transition-colors">
          Alterar Senha
        </button>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="menu-text w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-2 rounded transition-colors"
      >
        <LogOut className="w-4 h-4" />
        Sair
      </button>
    </div>
  );
}
