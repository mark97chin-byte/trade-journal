import hashlib
import os
import re
import sqlite3
import time
import requests
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
import MetaTrader5 as mt5

# Resolve path relative to script directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv(os.path.join(BASE_DIR, "apps", "web", ".env.local"))
load_dotenv(os.path.join(BASE_DIR, "apps", "web", ".env"))

NOTION_TOKEN = os.getenv("NOTION_TOKEN")
NOTION_TRADES_DB_ID = (
    os.getenv("NOTION_TRADES_DATABASE_ID")
    or os.getenv("NOTION_DATABASE_ID")
    or ""
).replace("-", "")
NOTION_DAILY_DB_ID = (
    os.getenv("NOTION_DAILY_DATABASE_ID")
    or os.getenv("NOTION_JOURNAL_DATABASE_ID")
    or ""
).replace("-", "")

DAYS_LOOKBACK = int(os.getenv("DAYS_LOOKBACK", 365))
CLUSTER_WINDOW_SECONDS = int(os.getenv("CLUSTER_WINDOW_SECONDS", 10))

# MT5 brokers operate on "NY Close" time (New York local time + 7 hours year-round).
# Subtracting 7 hours from the MT5 naive timestamp yields exact New York wall-clock time
# without ever suffering from EU vs US Daylight Saving Time mismatch weeks.
MT5_NY_OFFSET_HOURS = int(os.getenv("MT5_NY_OFFSET_HOURS", 7))
NY_TZ = ZoneInfo("America/New_York")
DB_PATH = os.path.join(BASE_DIR, "apps", "web", "data", "journal.db")

if not NOTION_TOKEN or not NOTION_TRADES_DB_ID:
    raise ValueError("Missing NOTION_TOKEN or NOTION_TRADES_DATABASE_ID / NOTION_DATABASE_ID in .env")

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
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
    6: "Stop Out",
}


def init_mt5():
    if not mt5.initialize():
        terminal_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
        if not mt5.initialize(path=terminal_path):
            raise SystemError(f"MT5 Init failed: {mt5.last_error()}")


def broker_time_to_ny(epoch_seconds: int) -> datetime:
    """
    Converts MT5 broker timestamp (NY + 7h) directly to America/New_York timezone-aware datetime.
    """
    naive_broker_dt = datetime.fromtimestamp(epoch_seconds, tz=timezone.utc).replace(tzinfo=None)
    naive_ny_dt = naive_broker_dt - timedelta(hours=MT5_NY_OFFSET_HOURS)
    return naive_ny_dt.replace(tzinfo=NY_TZ)


def get_session_name(dt: datetime) -> str:
    """
    Classifies ICT / FX trading session using exact New York wall-clock time (DST-proof):
      - Asia:   18:00 - 01:59 NY
      - London: 02:00 - 07:59 NY
      - NY AM:  08:00 - 11:59 NY
      - NY PM:  12:00 - 17:59 NY
    """
    ny_dt = dt.astimezone(NY_TZ)
    hour = ny_dt.hour
    if 2 <= hour < 8:
        return "London"
    elif 8 <= hour < 12:
        return "NY AM"
    elif 12 <= hour < 18:
        return "NY PM"
    else:
        return "Asia"


def get_trading_day_slug(dt: datetime) -> str:
    """
    Returns the YYYY-MM-DD journal date in New York time.
    """
    return dt.astimezone(NY_TZ).strftime("%Y-%m-%d")


def format_duration(seconds: float) -> str:
    mins = int(max(0, seconds) // 60)
    if mins < 60:
        return f"{mins}m"
    hours = mins // 60
    return f"{hours}h {mins % 60}m"


def infer_asset_class(symbol: str) -> str:
    s = symbol.upper()
    if any(idx in s for idx in ("500", "100", "30", "NAS", "SPX", "US30", "GER", "UK100", "JP225")):
        return "futures"
    if any(fx in s for fx in ("USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "XAU", "XAG")):
        return "forex"
    return "futures"


def calculate_mae_mfe(symbol, direction, entry_price, initial_sl, open_ts, close_ts, worst_exit_price, is_sl_hit):
    """
    Uses naive broker datetimes so Wine/Linux local system timezone (e.g. UTC+8)
    never shifts the MT5 M1 candle lookup window.
    """
    dt_from = datetime.fromtimestamp(open_ts, tz=timezone.utc).replace(tzinfo=None)
    dt_to = datetime.fromtimestamp(close_ts, tz=timezone.utc).replace(tzinfo=None)

    if dt_to <= dt_from:
        dt_to = dt_from + timedelta(minutes=1)

    rates = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_M1, dt_from, dt_to)
    if rates is None or len(rates) == 0:
        return None, None

    highest = max(bar["high"] for bar in rates)
    lowest = min(bar["low"] for bar in rates)
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


def fetch_reconstructed_trades(all_history: bool = False):
    init_mt5()
    # Use wide window to ensure all entry legs of recently closed positions are captured in a single batch
    utc_to = datetime.now() + timedelta(days=2)
    if all_history:
        utc_from = datetime(2020, 1, 1)
        cutoff_ts = 0
        print("[MT5] Unlimited lookback enabled: fetching complete history from account inception...")
    else:
        utc_from = utc_to - timedelta(days=DAYS_LOOKBACK + 14)
        # cutoff_ts defined by lookback mode above

    deals = mt5.history_deals_get(utc_from, utc_to)
    if not deals:
        return []

    orders = mt5.history_orders_get(utc_from, utc_to) or []

    # Group deals and orders by position_id in memory (eliminates hundreds of slow IPC calls)
    deals_by_pos = defaultdict(list)
    for d in deals:
        if getattr(d, "position_id", 0) > 0:
            deals_by_pos[d.position_id].append(d)

    orders_by_pos = defaultdict(list)
    for o in orders:
        if getattr(o, "position_id", 0) > 0:
            orders_by_pos[o.position_id].append(o)

    cutoff_ts = 0 if all_history else int((datetime.now(timezone.utc) - timedelta(days=DAYS_LOOKBACK)).timestamp())
    positions = {}

    for pos_id, pos_deals in deals_by_pos.items():
        entry_deals = [d for d in pos_deals if d.entry == 0 and d.symbol]
        out_deals = [d for d in pos_deals if d.entry in (1, 2) and d.symbol]

        if not out_deals:
            continue

        # Fallback if position was opened before lookback window
        if not entry_deals:
            fetched = mt5.history_deals_get(position=pos_id)
            if fetched:
                pos_deals = list(fetched)
                entry_deals = [d for d in pos_deals if d.entry == 0 and d.symbol]
                out_deals = [d for d in pos_deals if d.entry in (1, 2) and d.symbol]

        if not entry_deals or not out_deals:
            continue

        close_time = max(d.time for d in out_deals)
        if close_time < cutoff_ts:
            continue

        in_deal = min(entry_deals, key=lambda x: x.time)
        direction = "BUY" if in_deal.type == 0 else "SELL"
        open_time = in_deal.time
        volume = sum(d.volume for d in out_deals)
        net_pnl = sum(d.profit + d.swap + d.commission + getattr(d, "fee", 0.0) for d in pos_deals)

        in_vol = sum(d.volume for d in entry_deals)
        entry_price = sum(d.price * d.volume for d in entry_deals) / in_vol if in_vol > 0 else in_deal.price
        exit_vol = sum(d.volume for d in out_deals)
        exit_price = sum(d.price * d.volume for d in out_deals) / exit_vol if exit_vol > 0 else 0

        initial_sl = 0.0
        initial_tp = 0.0
        pos_orders = orders_by_pos.get(pos_id) or (mt5.history_orders_get(position=pos_id) or [])
        for o in pos_orders:
            if o.sl > 0 and initial_sl == 0.0:
                initial_sl = o.sl
            if o.tp > 0 and initial_tp == 0.0:
                initial_tp = o.tp

        partial_details = []
        for out in sorted(out_deals, key=lambda x: (x.time, getattr(x, "time_msc", 0))):
            p_reason = DEAL_REASON_MAP.get(out.reason, "Manual")
            p_net = out.profit + out.swap + out.commission + getattr(out, "fee", 0.0)
            partial_details.append({
                "time": out.time,
                "volume": out.volume,
                "price": out.price,
                "net_pnl": p_net,
                "reason": p_reason,
            })

        last_out_deal = max(out_deals, key=lambda x: x.time)
        exit_reason = DEAL_REASON_MAP.get(last_out_deal.reason, "Manual")

        positions[pos_id] = {
            "pos_id": pos_id,
            "symbol": in_deal.symbol,
            "direction": direction,
            "open_time": open_time,
            "close_time": close_time,
            "volume": volume,
            "net_pnl": net_pnl,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "initial_sl": initial_sl,
            "initial_tp": initial_tp,
            "exit_reason": exit_reason,
            "partial_details": partial_details,
        }

    sorted_positions = sorted(positions.values(), key=lambda x: x["open_time"])
    clusters = []

    for pos in sorted_positions:
        matched = False
        for cluster in clusters:
            time_diff = abs(pos["open_time"] - cluster["open_time"])
            if (
                pos["symbol"] == cluster["symbol"]
                and pos["direction"] == cluster["direction"]
                and time_diff <= CLUSTER_WINDOW_SECONDS
            ):
                cluster["positions"].append(pos)
                matched = True
                break
        if not matched:
            clusters.append({
                "symbol": pos["symbol"],
                "direction": pos["direction"],
                "open_time": pos["open_time"],
                "positions": [pos],
            })

    acct_info = mt5.account_info()
    current_balance = acct_info.balance if acct_info else 100000.0
    symbol_info_cache = {}

    trade_ideas = []
    for c in clusters:
        subs = c["positions"]
        tot_vol = sum(p["volume"] for p in subs)
        tot_pnl = sum(p["net_pnl"] for p in subs)
        pos_ids = [str(p["pos_id"]) for p in subs]

        weighted_entry = sum(p["entry_price"] * p["volume"] for p in subs) / tot_vol if tot_vol > 0 else 0
        weighted_exit = sum(p["exit_price"] * p["volume"] for p in subs) / tot_vol if tot_vol > 0 else 0

        initial_sl = next((p["initial_sl"] for p in subs if p["initial_sl"] > 0), 0.0)
        initial_tp = next((p["initial_tp"] for p in subs if p["initial_tp"] > 0), 0.0)

        all_partials = []
        for p in subs:
            all_partials.extend(p["partial_details"])
        all_partials = sorted(all_partials, key=lambda x: x["time"])

        breakdown_parts = []
        for idx, part in enumerate(all_partials, start=1):
            sign = "+" if part["net_pnl"] >= 0 else ""
            part_dt = broker_time_to_ny(part["time"])
            time_str = part_dt.strftime("%H:%M:%S")
            p_str = f"[{idx}] {part['volume']:.2f}L @ {part['price']:.5g} @ {time_str} ({sign}${part['net_pnl']:.2f}, {part['reason']})"
            breakdown_parts.append(p_str)
        partials_text = " | ".join(breakdown_parts)

        dollar_risk = 0.0
        realized_r = None
        risk_percent = None
        planned_r = None

        if initial_sl > 0:
            sym = c["symbol"]
            if sym not in symbol_info_cache:
                symbol_info_cache[sym] = mt5.symbol_info(sym)
            sym_info = symbol_info_cache[sym]

            point_distance = abs(weighted_entry - initial_sl)
            if sym_info and sym_info.point > 0:
                ticks = point_distance / sym_info.point
                dollar_risk = ticks * sym_info.trade_tick_value * tot_vol

            if dollar_risk > 0:
                realized_r = round(tot_pnl / dollar_risk, 2)
                risk_percent = round((dollar_risk / current_balance) * 100, 2)

            if initial_tp > 0 and point_distance > 0:
                tp_distance = abs(initial_tp - weighted_entry)
                planned_r = round(tp_distance / point_distance, 2)

        open_ts = min(p["open_time"] for p in subs)
        close_ts = max(p["close_time"] for p in subs)

        open_dt = broker_time_to_ny(open_ts)
        close_dt = broker_time_to_ny(close_ts)
        duration_sec = (close_dt - open_dt).total_seconds()

        reasons = [part["reason"] for part in all_partials]
        is_sl_hit = "SL" in reasons
        exit_reason = "TP" if "TP" in reasons else ("SL" if "SL" in reasons else reasons[-1])

        if c["direction"] == "BUY":
            worst_exit = min(part["price"] for part in all_partials)
        else:
            worst_exit = max(part["price"] for part in all_partials)

        mfe_r, mae_r = calculate_mae_mfe(
            c["symbol"], c["direction"], weighted_entry, initial_sl,
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
            "cluster_id": f"{c['symbol']}_{pos_ids[0]}",
            "title": f"{c['symbol']} {c['direction']} Setup",
            "symbol": c["symbol"],
            "direction": c["direction"],
            "volume": round(tot_vol, 2),
            "net_pnl": round(tot_pnl, 2),
            "entry_price": round(weighted_entry, 5),
            "exit_price": round(weighted_exit, 5),
            "realized_r": realized_r,
            "planned_r": planned_r,
            "mfe_r": mfe_r,
            "mae_r": mae_r,
            "capture_eff": capture_eff,
            "risk_percent": risk_percent,
            "outcome": outcome,
            "exit_reason": exit_reason,
            "partials_breakdown": partials_text,
            "raw_partials": all_partials,
            "session": get_session_name(open_dt),
            "day_of_week": open_dt.strftime("%A"),
            "day_slug": get_trading_day_slug(open_dt),
            "duration": format_duration(duration_sec),
            "open_time": open_dt.isoformat(),
            "close_time": close_dt.isoformat(),
            "tickets": ", ".join(pos_ids),
        })

    return trade_ideas


def get_database_properties(db_id: str):
    if not db_id:
        return {}
    url = f"https://api.notion.com/v1/databases/{db_id}"
    res = session.get(url, timeout=15)
    if res.status_code == 200:
        return res.json().get("properties", {})
    return {}


def get_existing_cluster_ids():
    url = f"https://api.notion.com/v1/databases/{NOTION_TRADES_DB_ID}/query"
    existing = {}
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
                cid = prop[0]["text"]["content"]
                existing[cid] = {"id": page.get("id"), "url": page.get("url")}

        has_more = data.get("has_more", False)
        start_cursor = data.get("next_cursor")
        time.sleep(0.25)

    return existing


daily_journal_page_cache = {}


def find_daily_journal_page_id(day_slug: str) -> str | None:
    """
    Finds the Notion page ID in the Daily Journal database matching YYYY-MM-DD
    so trades can be automatically linked to their Daily Journal entry.
    """
    if not NOTION_DAILY_DB_ID or not day_slug:
        return None
    if day_slug in daily_journal_page_cache:
        return daily_journal_page_cache[day_slug]

    try:
        daily_props = get_database_properties(NOTION_DAILY_DB_ID)
        title_prop = "Name"
        for k, v in daily_props.items():
            if v.get("type") == "title":
                title_prop = k
                break

        filter_obj = (
            {
                "or": [
                    {"property": "Slug", "rich_text": {"equals": day_slug}},
                    {"property": title_prop, "title": {"contains": day_slug}},
                ]
            }
            if "Slug" in daily_props
            else {"property": title_prop, "title": {"contains": day_slug}}
        )

        res = session.post(
            f"https://api.notion.com/v1/databases/{NOTION_DAILY_DB_ID}/query",
            json={"filter": filter_obj, "page_size": 1},
            timeout=10,
        )
        if res.status_code == 200:
            results = res.json().get("results", [])
            if results:
                pid = results[0].get("id")
                daily_journal_page_cache[day_slug] = pid
                return pid
    except Exception:
        pass

    daily_journal_page_cache[day_slug] = None
    return None



def wipe_notion_trades_database():
    """Archives all existing pages in NOTION_TRADES_DB_ID so a fresh import has zero duplicates."""
    url = f"https://api.notion.com/v1/databases/{NOTION_TRADES_DB_ID}/query"
    page_ids = []
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
            if page.get("id"):
                page_ids.append(page["id"])
        has_more = data.get("has_more", False)
        start_cursor = data.get("next_cursor")

    print(f"[Wipe] Archiving {len(page_ids)} existing trade pages in Notion...")
    for pid in page_ids:
        for attempt in range(3):
            r = session.patch(
                f"https://api.notion.com/v1/pages/{pid}",
                json={"archived": True},
                timeout=15,
            )
            if r.status_code in (200, 404):
                break
            if r.status_code in (409, 429):
                time.sleep(0.4 * (attempt + 1))
        time.sleep(0.15)
    print("[Wipe] Notion Trades database cleared.")


def save_to_sqlite(conn, trade, notion_page_id=None, notion_url=None):
    """Saves or self-heals a trade and all its individual MT5 execution legs."""
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

    # Keep notes empty on import; executions are shown in Executions & Partials
    # and Notion links are handled by the top Notion action buttons.
    notes_content = ""

    cluster_key = str(trade["cluster_id"])
    account_id = "mt5-main"
    symbol = str(trade["symbol"])
    asset_class = infer_asset_class(symbol)
    entry_side = "sell" if direction == "short" else "buy"
    exit_side = "buy" if direction == "short" else "sell"
    now_iso = datetime.now(timezone.utc).isoformat()

    exec_ids = []
    exits_list = []

    # 1. Upsert Entry Execution
    entry_exec_id = f"exec_{cluster_key}_entry"
    exec_ids.append(entry_exec_id)
    entry_hash = hashlib.sha256(entry_exec_id.encode("utf-8")).hexdigest()
    cur.execute("""
        INSERT INTO executions (
            id, account_id, symbol, side, quantity, price, fee,
            executed_at, asset_class, source, import_metadata_json, content_hash, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, ?, 'mt5-python', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            symbol = excluded.symbol,
            side = excluded.side,
            price = excluded.price,
            quantity = excluded.quantity,
            executed_at = excluded.executed_at,
            asset_class = excluded.asset_class,
            import_metadata_json = excluded.import_metadata_json;
    """, (
        entry_exec_id,
        account_id,
        symbol,
        entry_side,
        float(trade.get("volume", 0.0)),
        float(trade.get("entry_price", 0.0)),
        str(trade["open_time"]),
        asset_class,
        json.dumps({"reason": "Entry", "grossPnl": 0.0}),
        entry_hash,
        now_iso,
    ))

    # 2. Upsert Individual Partial Exit Legs with exact MT5 NY timestamps
    for idx, part in enumerate(trade.get("raw_partials", []), start=1):
        exit_exec_id = f"exec_{cluster_key}_exit_{idx}"
        exec_ids.append(exit_exec_id)
        exit_hash = hashlib.sha256(exit_exec_id.encode("utf-8")).hexdigest()
        part_dt = broker_time_to_ny(part["time"]).isoformat()
        part_pnl = round(float(part.get("net_pnl", 0.0)), 2)
        part_reason = part.get("reason", "TP")
        part_meta = json.dumps({"reason": part_reason, "grossPnl": part_pnl})
        exits_list.append({
            "executionId": exit_exec_id,
            "quantity": float(part["volume"]),
            "grossPnl": part_pnl,
        })
        cur.execute("""
            INSERT INTO executions (
                id, account_id, symbol, side, quantity, price, fee,
                executed_at, asset_class, source, import_metadata_json, content_hash, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, ?, 'mt5-python', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                symbol = excluded.symbol,
                side = excluded.side,
                price = excluded.price,
                quantity = excluded.quantity,
                executed_at = excluded.executed_at,
                asset_class = excluded.asset_class,
                import_metadata_json = excluded.import_metadata_json;
        """, (
            exit_exec_id,
            account_id,
            symbol,
            exit_side,
            float(part["volume"]),
            float(part["price"]),
            part_dt,
            asset_class,
            part_meta,
            exit_hash,
            now_iso,
        ))

    if exec_ids:
        placeholders = ",".join("?" for _ in exec_ids)
        cur.execute(
            f"DELETE FROM executions WHERE id LIKE ? AND id NOT IN ({placeholders})",
            [f"exec_{cluster_key}_%", *exec_ids],
        )

    query = """
    INSERT INTO trades (
        key, account_id, symbol, direction, status,
        opened_at, closed_at, quantity, open_quantity,
        avg_entry, avg_exit, gross_pnl, fees, net_pnl,
        execution_ids_json, exits_json,
        notes, notion_page_id, notion_url,
        realized_r, planned_r, mae_r, mfe_r, capture_eff,
        risk_percent, exit_reason, partials_breakdown, tickets
    ) VALUES (
        :key, :account_id, :symbol, :direction, :status,
        :opened_at, :closed_at, :quantity, :open_quantity,
        :avg_entry, :avg_exit, :gross_pnl, :fees, :net_pnl,
        :execution_ids_json, :exits_json,
        :notes, :notion_page_id, :notion_url,
        :realized_r, :planned_r, :mae_r, :mfe_r, :capture_eff,
        :risk_percent, :exit_reason, :partials_breakdown, :tickets
    )
    ON CONFLICT(key) DO UPDATE SET
        opened_at = excluded.opened_at,
        closed_at = excluded.closed_at,
        avg_entry = excluded.avg_entry,
        avg_exit = excluded.avg_exit,
        quantity = excluded.quantity,
        status = excluded.status,
        net_pnl = excluded.net_pnl,
        gross_pnl = excluded.gross_pnl,
        execution_ids_json = excluded.execution_ids_json,
        exits_json = excluded.exits_json,
        partials_breakdown = excluded.partials_breakdown,
        exit_reason = excluded.exit_reason,
        tickets = excluded.tickets,
        notes = CASE
            WHEN trades.notes IS NOT NULL AND TRIM(trades.notes) != '' THEN trades.notes
            ELSE excluded.notes
        END,
        notion_page_id = COALESCE(trades.notion_page_id, excluded.notion_page_id),
        notion_url = COALESCE(trades.notion_url, excluded.notion_url),
        realized_r = excluded.realized_r,
        planned_r = excluded.planned_r,
        mae_r = excluded.mae_r,
        mfe_r = excluded.mfe_r,
        capture_eff = excluded.capture_eff,
        risk_percent = excluded.risk_percent;
    """

    params = {
        "key": cluster_key,
        "account_id": account_id,
        "symbol": symbol,
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
        "execution_ids_json": json.dumps(exec_ids),
        "exits_json": json.dumps(exits_list),
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
        "tickets": str(trade.get("tickets", "")),
    }

    cur.execute(query, params)
    print(f"[SQLite] Synced & healed: {cluster_key} ({len(exec_ids)} execution legs, NY Session: {trade['session']})")


def self_heal_database(conn):
    """
    Scans all existing trades in SQLite (including older trades outside MT5 lookback)
    and self-heals any missing or broken execution rows from partials_breakdown / notes.
    """
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    trades = cur.execute("SELECT * FROM trades").fetchall()
    now_iso = datetime.now(timezone.utc).isoformat()

    partial_pattern = re.compile(
        r"\[(\d+)\]\s+([\d.]+)L?\s+@\s+([\d.]+)(?:\s+@\s+([\d:]+))?\s*\(([+-]?\$?[\d.]+)?(?:,\s*([^)]+))?\)",
        re.IGNORECASE,
    )

    healed_count = 0
    for t in trades:
        t_key = t["key"]
        if t_key == "US500.raw_114262239":
            existing_execs = cur.execute(
                "SELECT id, executed_at FROM executions WHERE id LIKE 'exec_US500.raw_114262239_%' ORDER BY id"
            ).fetchall()
            if len(existing_execs) == 4 and "06:25" in existing_execs[1]["executed_at"]:
                continue

        exec_ids_raw = t["execution_ids_json"] or "[]"
        try:
            current_ids = json.loads(exec_ids_raw)
        except Exception:
            current_ids = []

        existing_rows = []
        if current_ids:
            placeholders = ",".join("?" for _ in current_ids)
            existing_rows = cur.execute(
                f"SELECT * FROM executions WHERE id IN ({placeholders})",
                current_ids,
            ).fetchall()

        raw_text = (t["partials_breakdown"] if "partials_breakdown" in t.keys() and t["partials_breakdown"] else "") or (t["notes"] or "")
        matches = partial_pattern.findall(raw_text)
        expected_leg_count = 1 + (len(matches) if matches else (1 if t["closed_at"] else 0))

        has_explicit_times_in_text = any(bool(m[3]) for m in matches)
        needs_heal = len(existing_rows) != expected_leg_count or has_explicit_times_in_text

        if not needs_heal:
            continue

        acct_id = t["account_id"] or "mt5-main"
        symbol = t["symbol"]
        asset_class = t["asset_class"] if "asset_class" in t.keys() and t["asset_class"] else infer_asset_class(symbol)
        direction = (t["direction"] or "long").lower()
        entry_side = "sell" if direction in ["short", "sell"] else "buy"
        exit_side = "buy" if direction in ["short", "sell"] else "sell"
        open_str = t["opened_at"]
        close_str = t["closed_at"] or open_str

        legs = [
            {
                "id": f"exec_{t_key}_entry",
                "side": entry_side,
                "quantity": float(t["quantity"] or 0.0),
                "price": float(t["avg_entry"] or 0.0),
                "executed_at": open_str,
                "gross_pnl": 0.0,
                "reason": "Entry",
            }
        ]

        if matches:
            for idx, m in enumerate(matches, start=1):
                qty = float(m[1])
                price = float(m[2])
                time_part = m[3]
                pnl_str = m[4].replace("$", "").replace("+", "").replace(",", "") if m[4] else "0"
                try:
                    pnl_val = float(pnl_str)
                except ValueError:
                    pnl_val = 0.0
                reason = m[5].strip() if m[5] else "TP"

                if time_part and len(open_str) >= 19:
                    date_prefix = open_str[:10]
                    tz_suffix = open_str[19:]
                    exec_time = f"{date_prefix}T{time_part}{tz_suffix}"
                else:
                    exec_time = close_str

                legs.append({
                    "id": f"exec_{t_key}_exit_{idx}",
                    "side": exit_side,
                    "quantity": qty,
                    "price": price,
                    "executed_at": exec_time,
                    "gross_pnl": pnl_val,
                    "reason": reason,
                })
        elif t["closed_at"] and t["avg_exit"] is not None:
            legs.append({
                "id": f"exec_{t_key}_exit_1",
                "side": exit_side,
                "quantity": float(t["quantity"] or 0.0),
                "price": float(t["avg_exit"]),
                "executed_at": close_str,
                "gross_pnl": float(t["gross_pnl"] or 0.0),
                "reason": t["exit_reason"] if "exit_reason" in t.keys() and t["exit_reason"] else "Exit",
            })

        new_exec_ids = []
        new_exits_list = []
        for leg in legs:
            new_exec_ids.append(leg["id"])
            chash = hashlib.sha256(leg["id"].encode("utf-8")).hexdigest()
            meta_json = json.dumps({"reason": leg["reason"], "grossPnl": leg["gross_pnl"]})
            if leg["reason"] != "Entry":
                new_exits_list.append({
                    "executionId": leg["id"],
                    "quantity": leg["quantity"],
                    "grossPnl": leg["gross_pnl"],
                })
            cur.execute("""
                INSERT INTO executions (
                    id, account_id, symbol, side, quantity, price, fee,
                    executed_at, asset_class, source, import_metadata_json, content_hash, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, ?, 'mt5-python', ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    symbol = excluded.symbol,
                    side = excluded.side,
                    quantity = excluded.quantity,
                    price = excluded.price,
                    executed_at = excluded.executed_at,
                    asset_class = excluded.asset_class,
                    import_metadata_json = excluded.import_metadata_json;
            """, (
                leg["id"],
                acct_id,
                symbol,
                leg["side"],
                leg["quantity"],
                leg["price"],
                leg["executed_at"],
                asset_class,
                meta_json,
                chash,
                now_iso,
            ))

        cur.execute(
            "UPDATE trades SET execution_ids_json = ?, exits_json = ? WHERE key = ?",
            (json.dumps(new_exec_ids), json.dumps(new_exits_list), t_key),
        )
        healed_count += 1

    print(f"[Self-Heal] Verified all database trades ({healed_count} trades healed/updated).")


def push_to_notion(trade, available_props, max_retries=3):
    url = "https://api.notion.com/v1/pages"

    # Find matching title property name dynamically
    title_prop = "Name"
    for prop_name, prop_def in available_props.items():
        if prop_def.get("type") == "title":
            title_prop = prop_name
            break

    candidate_props = {
        title_prop: {"title": [{"text": {"content": trade["title"]}}]},
        "Symbol": {"select": {"name": trade["symbol"]}},
        "Direction": {"select": {"name": trade["direction"]}},
        "Net P&L": {"number": trade["net_pnl"]},
        "Volume": {"number": trade["volume"]},
        "Entry Price": {"number": trade["entry_price"]},
        "Exit Price": {"number": trade["exit_price"]},
        "Outcome": {"select": {"name": trade["outcome"]}},
        "Exit Reason": {"select": {"name": trade["exit_reason"]}},
        "Partials Breakdown": {"rich_text": [{"text": {"content": trade["partials_breakdown"][:1950]}}]},
        "Session": {"select": {"name": trade["session"]}},
        "Day of Week": {"select": {"name": trade["day_of_week"]}},
        "Duration": {"rich_text": [{"text": {"content": trade["duration"]}}]},
        "Open Date": {"date": {"start": trade["open_time"]}},
        "Close Date": {"date": {"start": trade["close_time"]}},
        "Date": {"date": {"start": trade["open_time"]}},
        "Tickets": {"rich_text": [{"text": {"content": trade["tickets"]}}]},
        "LuxAlgo ID": {"rich_text": [{"text": {"content": trade["cluster_id"]}}]},
    }

    if trade.get("realized_r") is not None:
        candidate_props["Realized R"] = {"number": trade["realized_r"]}
    if trade.get("planned_r") is not None:
        candidate_props["Planned R"] = {"number": trade["planned_r"]}
    if trade.get("mfe_r") is not None:
        candidate_props["MFE (R)"] = {"number": trade["mfe_r"]}
    if trade.get("mae_r") is not None:
        candidate_props["MAE (R)"] = {"number": trade["mae_r"]}
    if trade.get("capture_eff") is not None:
        candidate_props["Capture Eff %"] = {"number": trade["capture_eff"]}
    if trade.get("risk_percent") is not None:
        candidate_props["Risk %"] = {"number": trade["risk_percent"]}

    # Automatically link to the matching Daily Journal page if a relation column exists
    for rel_col in ("Daily Journal", "Journal", "Day", "Daily Review"):
        if rel_col in available_props and available_props[rel_col].get("type") == "relation":
            daily_page_id = find_daily_journal_page_id(trade.get("day_slug", ""))
            if daily_page_id:
                candidate_props[rel_col] = {"relation": [{"id": daily_page_id}]}

    filtered_payload = {k: v for k, v in candidate_props.items() if k in available_props}

    payload = {
        "parent": {"database_id": NOTION_TRADES_DB_ID},
        "properties": filtered_payload,
    }

    for attempt in range(max_retries):
        try:
            res = session.post(url, json=payload, timeout=15)
            if res.status_code == 200:
                data = res.json()
                print(
                    f"[Notion] Synced: {trade['cluster_id']} | {trade['open_time'][:16]} NY ({trade['session']}) "
                    f"| Net: ${trade['net_pnl']} | MAE: {trade.get('mae_r', 'N/A')}R | MFE: {trade.get('mfe_r', 'N/A')}R"
                )
                time.sleep(0.35)
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
    import sys
    do_wipe = "--wipe" in sys.argv
    init_mt5()
    print(f"Reconstructing trades, partials, and MAE/MFE from MT5 (NY = Broker - {MT5_NY_OFFSET_HOURS}h)...")
    trade_ideas = fetch_reconstructed_trades(all_history=do_wipe)
    mt5.shutdown()

    print(f"Reconstructed {len(trade_ideas)} unified trade setups.")
    if trade_ideas:
        sorted_by_date = sorted(trade_ideas, key=lambda x: x["open_time"])
        print(f"[History Range] Earliest trade: {sorted_by_date[0]['open_time']} | Latest: {sorted_by_date[-1]['open_time']}")

    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db_conn = sqlite3.connect(DB_PATH)

    if do_wipe:
        print("[Wipe] Clearing local SQLite trades and executions tables...")
        db_conn.execute("DELETE FROM executions;")
        db_conn.execute("DELETE FROM trades;")
        db_conn.commit()
        wipe_notion_trades_database()

    schema = get_database_properties(NOTION_TRADES_DB_ID)
    existing = {} if do_wipe else get_existing_cluster_ids()

    synced_notion_count = 0
    try:
        for t in trade_ideas:
            cid = t["cluster_id"]
            if cid not in existing:
                notion_info = push_to_notion(t, schema)
                if notion_info:
                    synced_notion_count += 1
                    save_to_sqlite(db_conn, t, notion_page_id=notion_info.get("id"), notion_url=notion_info.get("url"))
                else:
                    save_to_sqlite(db_conn, t)
            else:
                prev_info = existing[cid]
                print(f"[Notion] Skipping {cid} (Already in Notion)")
                save_to_sqlite(db_conn, t, notion_page_id=prev_info.get("id"), notion_url=prev_info.get("url"))

        self_heal_database(db_conn)

        db_conn.commit()
        db_conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        print("\n[SQLite] PRAGMA wal_checkpoint(TRUNCATE) completed successfully.")
    finally:
        db_conn.close()

    print(f"\nDone! Synced {synced_notion_count} new trades to Notion, and committed clean journal.db.")
