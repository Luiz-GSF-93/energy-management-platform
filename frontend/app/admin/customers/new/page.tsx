'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/auth-context';

export default function NewCustomerPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    organizationId: 'org-default',
    name: '',
    email: '',
    document: '',
    phone: '',
    address: '',
    city: '',
    state: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL;
      const res = await fetch(`${API_URL}/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        alert('Cliente criado com sucesso!');
        router.push('/admin/customers');
      } else {
        alert('Erro ao criar cliente');
      }
    } catch (error) {
      console.error('Erro:', error);
      alert('Erro ao criar cliente');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '600px' }}>
      <h1>Novo Cliente</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div>
          <label>Nome *</label>
          <input type="text" name="name" value={formData.name} onChange={handleChange} required style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #ddd', borderRadius: '4px' }} />
        </div>

        <div>
          <label>Email *</label>
          <input type="email" name="email" value={formData.email} onChange={handleChange} required style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #ddd', borderRadius: '4px' }} />
        </div>

        <div>
          <label>Documento (CNPJ/CPF)</label>
          <input type="text" name="document" value={formData.document} onChange={handleChange} style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #ddd', borderRadius: '4px' }} />
        </div>

        <div>
          <label>Telefone</label>
          <input type="tel" name="phone" value={formData.phone} onChange={handleChange} style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #ddd', borderRadius: '4px' }} />
        </div>

        <div>
          <label>Endereço</label>
          <input type="text" name="address" value={formData.address} onChange={handleChange} style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #ddd', borderRadius: '4px' }} />
        </div>

        <div>
          <label>Cidade</label>
          <input type="text" name="city" value={formData.city} onChange={handleChange} style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #ddd', borderRadius: '4px' }} />
        </div>

        <div>
          <label>Estado</label>
          <input type="text" name="state" value={formData.state} onChange={handleChange} style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #ddd', borderRadius: '4px' }} />
        </div>

        <button type="submit" disabled={loading} style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          {loading ? 'Salvando...' : 'Salvar Cliente'}
        </button>

        <a href="/admin/customers" style={{ padding: '10px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', textDecoration: 'none', textAlign: 'center' }}>Cancelar</a>
      </form>
    </div>
  );
}
