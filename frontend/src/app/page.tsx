'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (isClient) {
      const token = localStorage.getItem('authToken');
      if (token) {
        router.push('/dashboard');
      } else {
        router.push('/auth/login');
      }
    }
  }, [isClient, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">⚡ Energy Management</h1>
        <p className="text-gray-400">Carregando...</p>
      </div>
    </div>
  );
}
