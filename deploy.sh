#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  deploy.sh — Deploy completo do CH Geladas PDV para Firebase Hosting
#  Uso: bash deploy.sh
# ═══════════════════════════════════════════════════════════════════
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   CH GELADAS PDV — DEPLOY PARA FIREBASE  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Verificar dependências ─────────────────────────────────────
echo "▶ Verificando dependências..."

if ! command -v node &> /dev/null; then
  echo "❌ Node.js não encontrado. Instale em https://nodejs.org"
  exit 1
fi

if ! command -v firebase &> /dev/null; then
  echo "📦 Instalando Firebase CLI..."
  npm install -g firebase-tools
fi

echo "✅ Node $(node -v) | Firebase CLI $(firebase --version)"

# ── 2. Instalar dependências do projeto ───────────────────────────
echo ""
echo "▶ Instalando dependências..."
npm install

# ── 3. Gerar ícones PWA ───────────────────────────────────────────
echo ""
echo "▶ Gerando ícones PWA..."
node generate-icons.js

# ── 4. Build CSS (Tailwind purge) ─────────────────────────────────
echo ""
echo "▶ Compilando CSS otimizado..."
npm run build:css

# Substitui CDN do Tailwind pelo CSS local no index.html de produção
# (cria uma cópia — não altera o original de desenvolvimento)
echo ""
echo "▶ Preparando index.html para produção..."
cp index.html index.html.dev.bak
sed -i 's|<script src="https://cdn.tailwindcss.com"></script>|<link rel="stylesheet" href="/dist/app.css">|g' index.html
echo "✅ CSS otimizado injetado (backup salvo em index.html.dev.bak)"

# ── 5. Login Firebase (se necessário) ─────────────────────────────
echo ""
echo "▶ Verificando autenticação Firebase..."
if ! firebase projects:list &> /dev/null; then
  echo "🔐 Fazendo login no Firebase..."
  firebase login
fi

# ── 6. Deploy ─────────────────────────────────────────────────────
echo ""
echo "▶ Fazendo deploy para Firebase Hosting..."
firebase deploy --only hosting

# ── 7. Restaura index.html de desenvolvimento ─────────────────────
cp index.html.dev.bak index.html
rm index.html.dev.bak
echo "✅ index.html de desenvolvimento restaurado"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅ DEPLOY CONCLUÍDO COM SUCESSO!        ║"
echo "║                                          ║"
echo "║   https://ch-geladas.web.app             ║"
echo "║   https://ch-geladas.firebaseapp.com     ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "📱 Para instalar no celular:"
echo "   Android: Chrome → menu (⋮) → 'Adicionar à tela inicial'"
echo "   iPhone:  Safari → Compartilhar (□↑) → 'Adicionar à tela de início'"
echo ""
