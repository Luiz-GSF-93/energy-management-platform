'use client';

export default function CreateContractForm() {
  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h2 className="text-xl font-bold text-white mb-6">Criar Contrato</h2>
      <form className="space-y-6">
        <input type="text" placeholder="Número do Contrato" className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" />
        <input type="text" placeholder="Cliente" className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" />
        <button type="button" className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg">
          Salvar Contrato
        </button>
      </form>
    </div>
  );
}
