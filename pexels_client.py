import requests
import json
import os
import sys

API_KEY = os.environ.get("PEXELS_API_KEY", "0mYNu9tM5mlHhUV7XrVx3d7NMe87CqtHesigznZWiZcblN7LBWKeXVv6")
HEADERS = {"Authorization": API_KEY}
BASE_URL = "https://api.pexels.com/v1"

def buscar_fotos(query, per_page=10, orientation=None, page=1):
    """Busca fotos en Pexels por palabra clave."""
    params = {"query": query, "per_page": per_page, "page": page}
    if orientation:
        params["orientation"] = orientation
    res = requests.get(f"{BASE_URL}/search", headers=HEADERS, params=params)
    res.raise_for_status()
    return res.json()

def descargar_foto(url, ruta_destino):
    """Descarga una foto en alta resolución a disco."""
    os.makedirs(os.path.dirname(os.path.abspath(ruta_destino)), exist_ok=True)
    res = requests.get(url, stream=True)
    res.raise_for_status()
    with open(ruta_destino, "wb") as f:
        for chunk in res.iter_content(chunk_size=8192):
            f.write(chunk)
    return ruta_destino

if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "excavator construction machinery"
    data = buscar_fotos(q, per_page=5)
    print(f"Total encontrados para '{q}': {data.get('total_results')}")
    for p in data.get("photos", []):
        print(f"- ID: {p['id']} | Fotógrafo: {p['photographer']} | Alt: {p['alt']}")
        print(f"  URL: {p['src']['large']}")
