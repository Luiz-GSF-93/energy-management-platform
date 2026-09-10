'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Invoice } from '@/types';
import { Calendar, DollarSign, CheckCircle, Clock, FileText } from 'lucide-react';

interface InvoicesListProps {
  invoices: Invoice[];
  isLoading: boolean;
}

export function InvoicesList({ invoices, isLoading }: InvoicesListProps) {
  if (isLoading) {
    return <div className="text-center py-8">Carregando faturas...</div>;
  }

  if (invoices.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-gray-500">Nenhuma fatura disponível</p>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'approved':
        return 'bg-blue-100 text-blue-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid':
        return 'Pago';
      case 'approved':
        return 'Aprovado';
      case 'pending':
        return 'Pendente';
      default:
        return status;
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold mb-4">Faturas Recentes</h2>
      <div className="space-y-4">
        {invoices.slice(0, 5).map((invoice) => (
          <div
            key={invoice.id}
            className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
          >
            <div className="flex items-center space-x-4">
              <FileText className="w-8 h-8 text-gray-400" />
              <div>
                <p className="font-medium">{invoice.invoiceNumber}</p>
                <p className="text-sm text-gray-500">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  {new Date(invoice.referenceMonth).toLocaleDateString('pt-BR')}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="font-semibold">
                  <DollarSign className="w-4 h-4 inline mr-1" />
                  R$ {invoice.totalAmount.toFixed(2)}
                </p>
                <p className="text-sm text-gray-500">
                  {invoice.consumptionKwh} kWh
                </p>
              </div>
              <Badge className={getStatusColor(invoice.status)}>
                {getStatusLabel(invoice.status)}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
