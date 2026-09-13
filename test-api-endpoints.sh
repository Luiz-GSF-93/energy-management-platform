#!/bin/bash

API_URL="https://energy-management-platform-backend.onrender.com"

echo "🧪 === TESTANDO ENDPOINTS DA API ==="
echo ""

# 1. Testar raiz
echo "1️⃣ Testando GET /api/v1"
curl -s "${API_URL}/api/v1" | jq . 2>/dev/null || echo "❌ Erro ao testar raiz"
echo ""

# 2. Testar health
echo "2️⃣ Testando GET /api/v1/health"
curl -s "${API_URL}/api/v1/health" | jq . 2>/dev/null || echo "❌ Erro ao testar health"
echo ""

# 3. Testar lista de documentos
echo "3️⃣ Testando GET /api/v1/document-processing"
curl -s "${API_URL}/api/v1/document-processing" | jq . 2>/dev/null || echo "❌ Erro ao listar documentos"
echo ""

# 4. Testar upload do PDF (se o arquivo existir)
if [ -f "26_08_festball.pdf" ]; then
  echo "4️⃣ Testando POST /api/v1/document-processing/upload"
  curl -s -X POST \
    -F "file=@26_08_festball.pdf" \
    -H "x-organization-id: org-expertev-test-001" \
    -H "x-empresa-id: default-empresa" \
    "${API_URL}/api/v1/document-processing/upload" | jq . 2>/dev/null || echo "❌ Erro ao fazer upload"
else
  echo "4️⃣ ⚠️ Arquivo 26_08_festball.pdf não encontrado"
fi

echo ""
echo "✅ Testes concluídos!"
