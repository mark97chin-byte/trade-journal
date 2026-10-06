from datetime import datetime, timedelta, timezone
import MetaTrader5 as mt5

DAYS_LOOKBACK = 14
CLUSTER_WINDOW_SECONDS = 10  # Groups positions opened within 10s of each other

if not mt5.initialize():
    terminal_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
    if not mt5.initialize(path=terminal_path):
        raise SystemError(f"MT5 Init failed: {mt5.last_error()}")

utc_to = datetime.now(timezone.utc)
utc_from = utc_to - timedelta(days=DAYS_LOOKBACK)

# 1. Fetch all exit deals
deals = mt5.history_deals_get(utc_from, utc_to)
closed_deals = [d for d in deals if d.entry == 1 and d.symbol] if deals else []

# 2. Reconstruct each position using position_id
positions = {}
for exit_deal in closed_deals:
    pos_id = exit_deal.position_id
    if pos_id in positions:
        continue

    # Retrieve all deals associated with this position ticket
    pos_deals = mt5.history_deals_get(position=pos_id)
    if not pos_deals:
        continue

    entry_deals = [d for d in pos_deals if d.entry == 0]
    out_deals = [d for d in pos_deals if d.entry == 1]

    if not entry_deals or not out_deals:
        continue

    in_deal = entry_deals[0]
    # Direction comes from the ENTRY deal: 0 is BUY, 1 is SELL
    direction = "BUY" if in_deal.type == 0 else "SELL"
    open_time = in_deal.time
    close_time = max(d.time for d in out_deals)
    volume = sum(d.volume for d in out_deals)
    net_pnl = sum(d.profit + d.swap + d.commission for d in out_deals)

    positions[pos_id] = {
        'pos_id': pos_id,
        'symbol': in_deal.symbol,
        'direction': direction,
        'open_time': open_time,
        'close_time': close_time,
        'volume': volume,
        'net_pnl': net_pnl,
        'entry_price': in_deal.price
    }

mt5.shutdown()

# 3. Cluster positions by matching Symbol, Direction, and OPEN TIME
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

print(f"\nFound {len(positions)} closed positions -> Grouped into {len(clusters)} Trade Ideas:\n")
for c in clusters:
    subs = c['positions']
    tot_vol = sum(p['volume'] for p in subs)
    tot_pnl = sum(p['net_pnl'] for p in subs)
    open_dt = datetime.fromtimestamp(c['open_time'], tz=timezone.utc).strftime('%Y-%m-%d %H:%M')
    close_dt = datetime.fromtimestamp(max(p['close_time'] for p in subs), tz=timezone.utc).strftime('%Y-%m-%d %H:%M')
    pos_ids = [str(p['pos_id']) for p in subs]

    print(f"[{open_dt}] {c['symbol']} {c['direction']}")
    print(f"  Tickets: {', '.join(pos_ids)} ({len(subs)} split targets)")
    print(f"  Volume:  {round(tot_vol, 2)} lots")
    print(f"  Net P&L: ${round(tot_pnl, 2)}")
    print(f"  Closed:  {close_dt}")
    print("-" * 50)
