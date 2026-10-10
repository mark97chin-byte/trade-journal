import os
import sqlite3
import time
import requests
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
import MetaTrader5 as mt5

# Resolve path relative to script directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

NOTION_TOKEN = os.getenv("NOTION_TOKEN")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")
DAYS_LOOKBACK = int(os.getenv("DAYS_LOOKBACK", 60))
CLUSTER_WINDOW_SECONDS = int(os.getenv("CLUSTER_WINDOW_SECONDS", 10))

BROKER_TZ = ZoneInfo(os.getenv("MT5_BROKER_TIMEZONE", "Europe/Helsinki"))
NY_TZ = ZoneInfo("America/New_York")
DB_PATH = os.path.join(BASE_DIR, "apps", "web", "data", "journal.db")

if not NOTION_TOKEN or not NOTION_DATABASE_ID:
    raise ValueError("Missing NOTION_TOKEN or NOTION_DATABASE_ID in environment / .env")

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
}

session = requests.Session()
session.headers.update(HEADERS)

DEAL_REASON_MAP = {
    0: "Manual",
    1: "Mobile",
    2: "Web",
    3: "EA",
    4: "SL",
    5: "TP",
    6: "Stop Out"
}

def init_mt5():
    if not mt5.initialize():
        terminal_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
        if not mt5.initialize(path=terminal_path):
            raise SystemError(f"MT5 Init failed: {mt5.last_error()}")

def broker_time_to_ny(epoch_seconds: int) -> datetime:
    naive_dt = datetime.fromtimestamp(epoch_seconds, tz=timezone.utc).replace(tzinfo=None)
    broker_dt = naive_dt.replace(tzinfo=BROKER_TZ)
    return broker_dt.astimezone(NY_TZ)

def get_session_name(dt: datetime) -> str:
    dt_utc = dt.astimezone(timezone.utc)
    hour = dt_utc.hour
    if 0 <= hour < 7:
        return "Asia"
    elif 7 <= hour < 12:
        return "London"
    elif 12 <= hour < 17:
        return "NY AM"
    else:
        return "NY PM"

def format_duration(seconds):
    mins = int(seconds // 60)
    if mins < 60:
        return f"{mins}m"
    hours = mins // 60
    return f"{hours}h {mins % 60}m"

def calculate_mae_mfe(symbol, direction, entry_price, initial_sl, open_ts, close_ts, worst_exit_price, is_sl_hit):
    dt_from = datetime.fromtimestamp(open_ts, tz=timezone.utc)
    dt_to = datetime.fromtimestamp(close_ts, tz=timezone.utc)

    # Ensure at least 1 minute window for quick scalps
    if dt_to <= dt_from:
        dt_to = dt_from + timedelta(minutes=1)

    rates = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_M1, dt_from, dt_to)
    if rates is None or len(rates) == 0:
        return None, None

    highest = max(bar['high'] for bar in rates)
    lowest = min(bar['low'] for bar in rates)
    risk_distance = abs(entry_price - initial_sl) if initial_sl > 0 else None

    if direction == "BUY":
        if is_sl_hit and worst_exit_price > 0:
            lowest = max(lowest, worst_exit_price)
        price_mfe = max(0.0, highest - entry_price)
        price_mae = max(0.0, entry_price - lowest)
    else:  # SELL
        if is_sl_hit and worst_exit_price > 0:
            highest = min(highest, worst_exit_price)
        price_mfe = max(0.0, entry_price - lowest)
        price_mae = max(0.0, highest - entry_price)

    if risk_distance and risk_distance > 0:
        mfe_r = round(price_mfe / risk_distance, 2)
        mae_r = round(price_mae / risk_distance, 2)
        if is_sl_hit and mae_r > 1.0:
            actual_fill_r = round(abs(entry_price - worst_exit_price) / risk_distance, 2)
            mae_r = actual_fill_r
    else:
        mfe_r = None
        mae_r = None

    return mfe_r, mae_r

def fetch_reconstructed_trades():
    utc_to = datetime.now(timezone.utc)
    utc_from = utc_to - timedelta(days=DAYS_LOOKBACK)

    deals = mt5.history_deals_get(utc_from, utc_to)
    if not deals:
        return []

    closed_deals = [d for d in deals if d.entry == 1 and d.symbol]

    positions = {}
    for exit_deal in closed_deals:
        pos_id = exit_deal.position_id
        if pos_id in positions:
            continue

        pos_deals = mt5.history_deals_get(position=pos_id)
        if not pos_deals:
            continue

        entry_deals = [d for d in pos_deals if d.entry == 0]
        out_deals = [d for d in pos_deals if d.entry == 1]

        if not entry_deals or not out_deals:
            continue

        in_deal = entry_deals[0]
        direction = "BUY" if in_deal.type == 0 else "SELL"
        open_time = in_deal.time
        close_time = max(d.time for d in out_deals)
        volume = sum(d.volume for d in out_deals)

        net_pnl = sum(d.profit + d.swap + d.commission + d.fee for d in pos_deals)

        entry_price = in_deal.price
        exit_vol = sum(d.volume for d in out_deals)
        exit_price = sum(d.price * d.volume for d in out_deals) / exit_vol if exit_vol > 0 else 0

        initial_sl = 0.0
        initial_tp = 0.0
        pos_orders = mt5.history_orders_get(position=pos_id)
        if pos_orders:
            for o in pos_orders:
                if o.sl > 0 and initial_sl == 0.0:
                    initial_sl = o.sl
                if o.tp > 0 and initial_tp == 0.0:
                    initial_tp = o.tp

        partial_details = []
        for out in sorted(out_deals, key=lambda x: x.time):
            p_reason = DEAL_REASON_MAP.get(out.reason, "Manual")
            p_net = out.profit + out.swap + out.commission + out.fee
            partial_details.append({
                'time': out.time,
                'volume': out.volume,
                'price': out.price,
                'net_pnl': p_net,
                'reason': p_reason
            })

        last_out_deal = max(out_deals, key=lambda x: x.time)
        exit_reason = DEAL_REASON_MAP.get(last_out_deal.reason, "Manual")

        positions[pos_id] = {
            'pos_id': pos_id,
            'symbol': in_deal.symbol,
            'direction': direction,
            'open_time': open_time,
            'close_time': close_time,
            'volume': volume,
            'net_pnl': net_pnl,
            'entry_price': entry_price,
            'exit_price': exit_price,
            'initial_sl': initial_sl,
            'initial_tp': initial_tp,
            'exit_reason': exit_reason,
            'partial_details': partial_details
        }

    sorted_positions = sorted(positions.values(), key=lambda x: x['open_time'])
    clusters = []

    for pos in sorted_positions:
        matched = False
        for cluster in clusters:
            time_diff = abs(pos['open_time'] - cluster['open_time'])
            if pos['symbol'] == cluster['symbol'] and pos['direction'] == cluster['direction'] and time_diff <= CLUSTER_WINDOW_SECONDS:
                cluster['positions'].append(pos)
                matched = True
                break
        if not matched:
            clusters.append({
                'symbol': pos['symbol'],
                'direction': pos['direction'],
                'open_time': pos['open_time'],
                'positions': [pos]
            })

    acct_info = mt5.account_info()
    current_balance = acct_info.balance if acct_info else 100000.0

    trade_ideas = []
    for c in clusters:
        subs = c['positions']
        tot_vol = sum(p['volume'] for p in subs)
        tot_pnl = sum(p['net_pnl'] for p in subs)
        pos_ids = [str(p['pos_id']) for p in subs]

        weighted_entry = sum(p['entry_price'] * p['volume'] for p in subs) / tot_vol if tot_vol > 0 else 0
        weighted_exit = sum(p['exit_price'] * p['volume'] for p in subs) / tot_vol if tot_vol > 0 else 0

        initial_sl = next((p['initial_sl'] for p in subs if p['initial_sl'] > 0), 0.0)
        initial_tp = next((p['initial_tp'] for p in subs if p['initial_tp'] > 0), 0.0)

        all_partials = []
        for p in subs:
            all_partials.extend(p['partial_details'])
        all_partials = sorted(all_partials, key=lambda x: x['time'])

        breakdown_parts = []
        for idx, part in enumerate(all_partials, start=1):
            sign = "+" if part['net_pnl'] >= 0 else ""
            p_str = f"[{idx}] {part['volume']:.2f}L @ {part['price']:.5g} ({sign}${part['net_pnl']:.2f}, {part['reason']})"
            breakdown_parts.append(p_str)
        partials_text = " | ".join(breakdown_parts)

        dollar_risk = 0.0
        realized_r = None
        risk_percent = None
        planned_r = None

        if initial_sl > 0:
            sym_info = mt5.symbol_info(c['symbol'])
            point_distance = abs(weighted_entry - initial_sl)
            if sym_info and sym_info.point > 0:
                ticks = point_distance / sym_info.point
                dollar_risk = ticks * sym_info.trade_tick_value * tot_vol

            if dollar_risk > 0:
                realized_r = round(tot_pnl / dollar_risk, 2)
                risk_percent = round((dollar_risk / current_balance) * 100, 2)

            if initial_tp > 0:
                tp_distance = abs(initial_tp - weighted_entry)
                planned_r = round(tp_distance / point_distance, 2)

        open_ts = c['open_time']
        close_ts = max(p['close_time'] for p in subs)

        open_dt = broker_time_to_ny(open_ts)
        close_dt = broker_time_to_ny(close_ts)
        duration_sec = (close_dt - open_dt).total_seconds()

        reasons = [part['reason'] for part in all_partials]
        is_sl_hit = "SL" in reasons
        exit_reason = "TP" if "TP" in reasons else ("SL" if "SL" in reasons else reasons[-1])

        if c['direction'] == "BUY":
            worst_exit = min(part['price'] for part in all_partials)
        else:
            worst_exit = max(part['price'] for part in all_partials)

        mfe_r, mae_r = calculate_mae_mfe(
            c['symbol'], c['direction'], weighted_entry, initial_sl,
            open_ts, close_ts, worst_exit, is_sl_hit
        )

        capture_eff = None
        if realized_r is not None and mfe_r and mfe_r > 0:
            capture_eff = round((realized_r / mfe_r) * 100, 1)

        if tot_pnl > 5.0:
            outcome = "WIN"
        elif tot_pnl < -5.0:
            outcome = "LOSS"
        else:
            outcome = "BE"

        trade_ideas.append({
            'cluster_id': f"{c['symbol']}_{pos_ids[0]}",
            'title': f"{c['symbol']} {c['direction']} Setup",
            'symbol': c['symbol'],
            'direction': c['direction'],
            'volume': round(tot_vol, 2),
            'net_pnl': round(tot_pnl, 2),
            'entry_price': round(weighted_entry, 5),
            'exit_price': round(weighted_exit, 5),
            'realized_r': realized_r,
            'planned_r': planned_r,
            'mfe_r': mfe_r,
            'mae_r': mae_r,
            'capture_eff': capture_eff,
            'risk_percent': risk_percent,
            'outcome': outcome,
            'exit_reason': exit_reason,
            'partials_breakdown': partials_text,
            'session': get_session_name(open_dt),
            'day_of_week': open_dt.strftime('%A'),
            'duration': format_duration(duration_sec),
            'open_time': open_dt.isoformat(),
            'close_time': close_dt.isoformat(),
            'tickets': ", ".join(pos_ids)
        })

    return trade_ideas

def get_database_properties():
    url = f"https://api.notion.com/v1/databases/{NOTION_DATABASE_ID}"
    res = session.get(url, timeout=15)
    if res.status_code == 200:
        return res.json().get("properties", {})
    return {}

def get_existing_cluster_ids():
    url = f"https://api.notion.com/v1/databases/{NOTION_DATABASE_ID}/query"
    existing = set()
    has_more = True
    start_cursor = None

    while has_more:
        payload = {"page_size": 100}
        if start_cursor:
            payload["start_cursor"] = start_cursor

        res = session.post(url, json=payload, timeout=15)
        if res.status_code != 200:
            break

        data = res.json()
        for page in data.get("results", []):
            prop = page.get("properties", {}).get("LuxAlgo ID", {}).get("rich_text", [])
            if prop:
                existing.add(prop[0]["text"]["content"])

        has_more = data.get("has_more", False)
        start_cursor = data.get("next_cursor")
        time.sleep(0.35)

    return existing

def save_to_sqlite(conn, trade, notion_page_id=None, notion_url=None):
    """Saves or updates a trade using an active connection."""
    cur = conn.cursor()
    direction = "long" if str(trade.get("direction", "")).upper() in ["BUY", "LONG"] else "short"

    net_pnl = float(trade.get("net_pnl", 0.0))
    if not trade.get("close_time"):
        status = "open"
    elif net_pnl > 0:
        status = "win"
    elif net_pnl < 0:
        status = "loss"
    else:
        status = "breakeven"

    notes_content = trade.get("partials_breakdown", "")
    if notion_url:
        notes_content = f"Notion: {notion_url}\n{notes_content}"

    query = """
    INSERT INTO trades (
        key, account_id, symbol, direction, status,
        opened_at, closed_at, quantity, open_quantity,
        avg_entry, avg_exit, gross_pnl, fees, net_pnl,
        notes, notion_page_id, notion_url,
        realized_r, planned_r, mae_r, mfe_r, capture_eff,
        risk_percent, exit_reason, partials_breakdown, tickets
    ) VALUES (
        :key, :account_id, :symbol, :direction, :status,
        :opened_at, :closed_at, :quantity, :open_quantity,
        :avg_entry, :avg_exit, :gross_pnl, :fees, :net_pnl,
        :notes, :notion_page_id, :notion_url,
        :realized_r, :planned_r, :mae_r, :mfe_r, :capture_eff,
        :risk_percent, :exit_reason, :partials_breakdown, :tickets
    )
    ON CONFLICT(key) DO UPDATE SET
        opened_at = excluded.opened_at,
        closed_at = excluded.closed_at,
        avg_exit = excluded.avg_exit,
        status = excluded.status,
        net_pnl = excluded.net_pnl,
        gross_pnl = excluded.gross_pnl,
        notes = CASE
            WHEN trades.notes IS NOT NULL AND TRIM(trades.notes) != '' THEN trades.notes
            ELSE excluded.notes
        END,
        notion_page_id = COALESCE(trades.notion_page_id, excluded.notion_page_id),
        notion_url = COALESCE(trades.notion_url, excluded.notion_url),
        realized_r = excluded.realized_r,
        mae_r = excluded.mae_r,
        mfe_r = excluded.mfe_r,
        capture_eff = excluded.capture_eff;
    """

    params = {
        "key": str(trade["cluster_id"]),
        "account_id": "mt5-main",
        "symbol": str(trade["symbol"]),
        "direction": direction,
        "status": status,
        "opened_at": str(trade["open_time"]),
        "closed_at": str(trade["close_time"]) if trade.get("close_time") else None,
        "quantity": float(trade.get("volume", 0.0)),
        "open_quantity": 0.0,
        "avg_entry": float(trade.get("entry_price", 0.0)),
        "avg_exit": float(trade.get("exit_price", 0.0)) if trade.get("exit_price") is not None else None,
        "gross_pnl": net_pnl,
        "fees": 0.0,
        "net_pnl": net_pnl,
        "notes": notes_content,
        "notion_page_id": notion_page_id,
        "notion_url": notion_url,
        "realized_r": trade.get("realized_r"),
        "planned_r": trade.get("planned_r"),
        "mae_r": trade.get("mae_r"),
        "mfe_r": trade.get("mfe_r"),
        "capture_eff": trade.get("capture_eff"),
        "risk_percent": trade.get("risk_percent"),
        "exit_reason": str(trade.get("exit_reason", "")),
        "partials_breakdown": str(trade.get("partials_breakdown", "")),
        "tickets": str(trade.get("tickets", ""))
    }

    cur.execute(query, params)
    print(f"[SQLite] Queued: {trade['cluster_id']}")

def push_to_notion(trade, available_props, max_retries=3):
    url = "https://api.notion.com/v1/pages"

    candidate_props = {
        "Name": {"title": [{"text": {"content": trade['title']}}]},
        "Symbol": {"select": {"name": trade['symbol']}},
        "Direction": {"select": {"name": trade['direction']}},
        "Net P&L": {"number": trade['net_pnl']},
        "Volume": {"number": trade['volume']},
        "Entry Price": {"number": trade['entry_price']},
        "Exit Price": {"number": trade['exit_price']},
        "Outcome": {"select": {"name": trade['outcome']}},
        "Exit Reason": {"select": {"name": trade['exit_reason']}},
        "Partials Breakdown": {"rich_text": [{"text": {"content": trade['partials_breakdown']}}]},
        "Session": {"select": {"name": trade['session']}},
        "Day of Week": {"select": {"name": trade['day_of_week']}},
        "Duration": {"rich_text": [{"text": {"content": trade['duration']}}]},
        "Open Date": {"date": {"start": trade['open_time']}},
        "Close Date": {"date": {"start": trade['close_time']}},
        "Tickets": {"rich_text": [{"text": {"content": trade['tickets']}}]},
        "LuxAlgo ID": {"rich_text": [{"text": {"content": trade['cluster_id']}}]}
    }

    if trade.get('realized_r') is not None:
        candidate_props["Realized R"] = {"number": trade['realized_r']}
    if trade.get('planned_r') is not None:
        candidate_props["Planned R"] = {"number": trade['planned_r']}
    if trade.get('mfe_r') is not None:
        candidate_props["MFE (R)"] = {"number": trade['mfe_r']}
    if trade.get('mae_r') is not None:
        candidate_props["MAE (R)"] = {"number": trade['mae_r']}
    if trade.get('capture_eff') is not None:
        candidate_props["Capture Eff %"] = {"number": trade['capture_eff']}
    if trade.get('risk_percent') is not None:
        candidate_props["Risk %"] = {"number": trade['risk_percent']}

    filtered_payload = {k: v for k, v in candidate_props.items() if k in available_props}

    payload = {
        "parent": {"database_id": NOTION_DATABASE_ID},
        "properties": filtered_payload
    }

    for attempt in range(max_retries):
        try:
            res = session.post(url, json=payload, timeout=15)
            if res.status_code == 200:
                data = res.json()
                print(f"[Notion] Synced: {trade['cluster_id']} | Net: ${trade['net_pnl']} | MAE: {trade.get('mae_r', 'N/A')}R | MFE: {trade.get('mfe_r', 'N/A')}R")
                time.sleep(0.4)
                return {"id": data.get("id"), "url": data.get("url")}
            elif res.status_code == 429:
                retry_after = int(res.headers.get("Retry-After", 2))
                time.sleep(retry_after)
            else:
                print(f"[Notion] Failed {trade['cluster_id']} (HTTP {res.status_code}): {res.text}")
                return None
        except requests.exceptions.RequestException:
            time.sleep(1)

    return None


if __name__ == "__main__":
    init_mt5()
    print("Reconstructing trades, partials, and accurate MAE/MFE from MT5...")
    trade_ideas = fetch_reconstructed_trades()
    mt5.shutdown()

    print(f"Reconstructed {len(trade_ideas)} unified trade setups.")

    schema = get_database_properties()
    existing = get_existing_cluster_ids()

    # Open single SQLite transaction for all updates
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db_conn = sqlite3.connect(DB_PATH)

    synced_notion_count = 0
    try:
        for t in trade_ideas:
            cid = t['cluster_id']
            if cid not in existing:
                notion_info = push_to_notion(t, schema)
                if notion_info:
                    synced_notion_count += 1
                    save_to_sqlite(db_conn, t, notion_page_id=notion_info.get("id"), notion_url=notion_info.get("url"))
                else:
                    save_to_sqlite(db_conn, t)
            else:
                print(f"[Notion] Skipping {cid} (Already in Notion)")
                save_to_sqlite(db_conn, t)

        db_conn.commit()

        # Checkpoint WAL directly into the primary journal.db file
        db_conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        print("\n[SQLite] PRAGMA wal_checkpoint(TRUNCATE) completed successfully.")
    finally:
        db_conn.close()

    print(f"\nDone! Synced {synced_notion_count} new trades to Notion, and committed clean journal.db.")