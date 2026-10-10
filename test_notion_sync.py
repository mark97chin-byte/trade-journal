import os
import sys
import sqlite3
import json
import time
from datetime import datetime, timezone

# Fallback environment loader
def load_env_file():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

load_env_file()

try:
    import requests
except ImportError:
    print("[-] Missing 'requests'. Install it with: sudo dnf install python3-requests")
    sys.exit(1)

NOTION_TOKEN = os.getenv("NOTION_TOKEN")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")
DB_PATH = os.path.join("apps", "web", "data", "journal.db")

if not NOTION_TOKEN or not NOTION_DATABASE_ID:
    print("[-] Missing NOTION_TOKEN or NOTION_DATABASE_ID in .env")
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
}

session = requests.Session()
session.headers.update(HEADERS)

def test_notion_connection():
    print(f"[*] Verifying Notion access to database {NOTION_DATABASE_ID}...")
    url = f"https://api.notion.com/v1/databases/{NOTION_DATABASE_ID}"
    res = session.get(url, timeout=10)
    if res.status_code == 200:
        title_list = res.json().get("title", [])
        db_title = title_list[0].get("plain_text", "Untitled") if title_list else "Untitled"
        print(f"[+] Connected to Notion database: '{db_title}'")
        return res.json().get("properties", {})
    else:
        print(f"[-] Connection failed (HTTP {res.status_code}): {res.text}")
        print("    -> Ensure the Integration is added to the page via '...' -> 'Add connections'")
        sys.exit(1)

def push_mock_trade_to_notion(available_props):
    cluster_id = f"TEST_MOCK_{int(time.time())}"
    now_iso = datetime.now(timezone.utc).isoformat()

    print(f"\n[*] Pushing mock trade [{cluster_id}] to Notion...")

    candidate_props = {
        "Name": {"title": [{"text": {"content": "XAUUSD BUY Mock Test"}}]},
        "Symbol": {"select": {"name": "XAUUSD"}},
        "Direction": {"select": {"name": "BUY"}},
        "Net P&L": {"number": 350.50},
        "Volume": {"number": 0.50},
        "Entry Price": {"number": 2650.25},
        "Exit Price": {"number": 2657.25},
        "Outcome": {"select": {"name": "WIN"}},
        "Exit Reason": {"select": {"name": "TP"}},
        "Partials Breakdown": {"rich_text": [{"text": {"content": "[1] 0.50L @ 2657.25 (+$350.50, TP)"}}]},
        "Session": {"select": {"name": "NY AM"}},
        "Day of Week": {"select": {"name": "Thursday"}},
        "Duration": {"rich_text": [{"text": {"content": "45m"}}]},
        "Open Date": {"date": {"start": now_iso}},
        "Close Date": {"date": {"start": now_iso}},
        "Tickets": {"rich_text": [{"text": {"content": "999001"}}]},
        "LuxAlgo ID": {"rich_text": [{"text": {"content": cluster_id}}]},
        "Realized R": {"number": 2.33},
        "Planned R": {"number": 2.50},
        "MFE (R)": {"number": 2.50},
        "MAE (R)": {"number": 0.20},
        "Capture Eff %": {"number": 93.2},
        "Risk %": {"number": 1.0}
    }

    filtered_payload = {k: v for k, v in candidate_props.items() if k in available_props}

    url = "https://api.notion.com/v1/pages"
    res = session.post(url, json={"parent": {"database_id": NOTION_DATABASE_ID}, "properties": filtered_payload}, timeout=15)

    if res.status_code == 200:
        data = res.json()
        print(f"[+] Notion page created successfully:")
        print(f"    URL: {data.get('url')}")
        return {
            "cluster_id": cluster_id,
            "notion_page_id": data.get("id"),
            "notion_url": data.get("url"),
            "open_time": now_iso,
            "close_time": now_iso
        }
    else:
        print(f"[-] Notion push failed ({res.status_code}): {res.text}")
        return None

def sync_notion_reviews_to_sqlite():
    print("\n[*] Querying Notion pages to pull review data into SQLite...")
    url = f"https://api.notion.com/v1/databases/{NOTION_DATABASE_ID}/query"
    res = session.post(url, json={"page_size": 50}, timeout=15)
    if res.status_code != 200:
        print(f"[-] Query failed: {res.text}")
        return

    pages = res.json().get("results", [])
    print(f"[+] Retrieved {len(pages)} pages from Notion.")

    if not os.path.exists(DB_PATH):
        print(f"[-] SQLite database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    updated_count = 0

    for page in pages:
        props = page.get("properties", {})
        cid_prop = props.get("LuxAlgo ID", {}).get("rich_text", [])
        if not cid_prop:
            continue
        cluster_id = cid_prop[0]["text"]["content"]

        rating = None
        r_prop = props.get("Rating")
        if r_prop:
            if r_prop.get("type") == "number":
                rating = r_prop.get("number")
            elif r_prop.get("type") == "select" and r_prop.get("select"):
                digits = [c for c in r_prop["select"]["name"] if c.isdigit()]
                rating = int(digits[0]) if digits else None

        reviewed = props.get("Reviewed", {}).get("checkbox", False)
        reviewed_at = datetime.now(timezone.utc).isoformat() if reviewed else None

        playbook_id = None
        pb_prop = props.get("Playbook")
        if pb_prop and pb_prop.get("select"):
            playbook_id = pb_prop["select"]["name"]

        tags = [t["name"] for t in props.get("Tags", {}).get("multi_select", [])]
        mistakes = [m["name"] for m in props.get("Mistakes", {}).get("multi_select", [])]

        stop_loss = props.get("Stop Loss", {}).get("number") or props.get("Planned Stop", {}).get("number")
        profit_target = props.get("Profit Target", {}).get("number") or props.get("Planned Target", {}).get("number")

        cur.execute("""
            UPDATE trades
            SET rating = COALESCE(?, rating),
                reviewed_at = ?,
                playbook_id = COALESCE(?, playbook_id),
                tags_json = CASE WHEN ? != '[]' THEN ? ELSE tags_json END,
                mistakes_json = CASE WHEN ? != '[]' THEN ? ELSE mistakes_json END,
                stop_loss = COALESCE(?, stop_loss),
                profit_target = COALESCE(?, profit_target),
                notion_url = ?,
                notion_page_id = ?
            WHERE key = ?
        """, (
            rating,
            reviewed_at,
            playbook_id,
            json.dumps(tags), json.dumps(tags),
            json.dumps(mistakes), json.dumps(mistakes),
            stop_loss,
            profit_target,
            page.get("url"),
            page.get("id"),
            cluster_id
        ))
        if cur.rowcount > 0:
            updated_count += 1
            print(f"    -> Updated SQLite for {cluster_id} (Rating: {rating}, Reviewed: {bool(reviewed_at)})")

    conn.commit()
    conn.close()
    print(f"[+] Successfully synced {updated_count} trade reviews into journal.db.")

def record_mock_in_sqlite(mock):
    if not mock or not os.path.exists(DB_PATH):
        return
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        INSERT OR IGNORE INTO trades (
            key, account_id, symbol, direction, status,
            opened_at, closed_at, quantity, open_quantity,
            avg_entry, avg_exit, gross_pnl, fees, net_pnl,
            notion_page_id, notion_url, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        mock["cluster_id"], "mt5-main", "XAUUSD", "long", "win",
        mock["open_time"], mock["close_time"], 0.5, 0.0,
        2650.25, 2657.25, 350.50, 0.0, 350.50,
        mock["notion_page_id"], mock["notion_url"],
        "[1] 0.50L @ 2657.25 (+$350.50, TP)"
    ))
    conn.commit()
    conn.close()
    print(f"[+] Recorded mock trade {mock['cluster_id']} in local journal.db.")

if __name__ == "__main__":
    props = test_notion_connection()
    mock_data = push_mock_trade_to_notion(props)
    record_mock_in_sqlite(mock_data)
    sync_notion_reviews_to_sqlite()
