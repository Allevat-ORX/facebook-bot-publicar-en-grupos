#!/usr/bin/env python3
import json
import uuid
import subprocess
import os
import sys
from datetime import datetime

COLA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cola.json")
INTEGRATION_ID = "cmuynonlo0007o56wc31aqxvn"  # Arturo Silva en Postiz
ORG_ID = "c1861c52-65a3-4f7c-81fc-ed50fb88784b"

def run_psql(query):
    cmd = [
        'docker', 'exec', '-i', 'postiz-postgres',
        'psql', '-U', 'postiz-user', '-d', 'postiz-db-local',
        '-t', '-A', '-c', query
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise Exception(f"PSQL Error: {res.stderr}")
    return res.stdout.strip()

def format_html(text):
    if not text:
        return "<p></p>"
    return "".join(f"<p>{line}</p>" if line.strip() else "<p></p>" for line in text.split("\n"))

def escape_sql(text):
    if text is None:
        return "NULL"
    return "'" + str(text).replace("'", "''") + "'"

def main():
    if not os.path.exists(COLA_PATH):
        print(f"No se encontró {COLA_PATH}")
        sys.exit(1)

    with open(COLA_PATH, "r", encoding="utf-8") as f:
        cola = json.load(f)

    publicados = [it for it in cola.get("items", []) if it.get("estado") == "publicado"]
    print(f"Total de items publicados en cola: {len(publicados)}")

    synced_count = 0
    for it in publicados:
        item_id = it.get("id")
        check_q = f'SELECT count(*) FROM "Post" WHERE "releaseId" = {escape_sql(item_id)};'
        exists = int(run_psql(check_q) or 0)
        if exists > 0:
            continue

        post_id = str(uuid.uuid4()).replace("-", "")[:25]
        group_id = str(uuid.uuid4())
        group_name = it.get("_grupo_nombre", "Grupo FB")
        ciudad = it.get("_ciudad", "SLP/QRO")
        title = f"[FB Grupo] {group_name} ({ciudad})"
        url = it.get("grupo", "https://www.facebook.com")
        copy = it.get("copies", [""])[0] if it.get("copies") else ""
        content_html = format_html(copy)

        insert_q = f'''
        INSERT INTO "Post" (
            id, state, "publishDate", "organizationId", "integrationId",
            content, delay, "group", title, "releaseId", "releaseURL",
            "creationMethod", "createdAt", "updatedAt"
        ) VALUES (
            {escape_sql(post_id)}, 'PUBLISHED', NOW(), {escape_sql(ORG_ID)}, {escape_sql(INTEGRATION_ID)},
            {escape_sql(content_html)}, 0, {escape_sql(group_id)}, {escape_sql(title)}, {escape_sql(item_id)},
            {escape_sql(url)}, 'API', NOW(), NOW()
        );
        '''
        run_psql(insert_q)
        synced_count += 1
        print(f"✅ Sincronizado en Postiz: {item_id} | {title}")

    print(f"\nSincronización finalizada. Nuevos posts agregados a Postiz: {synced_count}")

if __name__ == "__main__":
    main()
