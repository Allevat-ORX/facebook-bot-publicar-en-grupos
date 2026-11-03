#!/bin/bash
set -e

export PATH=/home/aleix/.local/bin:$PATH
SCRIPT_DIR="/home/aleix/Proyectos-Claude/fb-group-poster"
cd "$SCRIPT_DIR"

echo "=================================================="
echo "🕒 [$(date '+%Y-%m-%d %H:%M:%S')] INICIANDO TANDA REMOTA SERVER2026"
echo "=================================================="

# 1. Sincronizar cola y scripts desde GitHub
git pull origin feat/onrentx-modo-asistido || true

# 2. Ejecutar lanzador en modo headless
node lanzador_arturo_tanda.js

# 3. Sincronizar posts completados hacia la base de datos de Postiz
python3 sync_cola_to_postiz.py

echo "=================================================="
echo "🏁 [$(date '+%Y-%m-%d %H:%M:%S')] TANDA REMOTA FINALIZADA CON ÉXITO"
echo "=================================================="
