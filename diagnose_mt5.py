import os
import sys
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5

if not mt5.initialize():
    print(f"[ERROR] MT5 initialize failed: {mt5.last_error()}")
    sys.exit(1)

account_info = mt5.account_info()
if account_info:
    print(f"[Account] Login: {account_info.login} | Currency: {account_info.currency}")

# 1. Fetch raw deals from 2020 to cover complete account history
utc_from = datetime(2020, 1, 1)
utc_to = datetime.now() + timedelta(days=2)

deals = mt5.history_deals_get(utc_from, utc_to)
if deals is None:
    print(f"[ERROR] history_deals_get returned None: {mt5.last_error()}")
    mt5.shutdown()
    sys.exit(1)

print(f"\n[Raw Deals] Found {len(deals)} total deals in MT5.")

# Group deals by position_id
positions = {}
for d in deals:
    # Skip balance deposits/withdrawals (deal type 2)
    if d.entry == 2 and d.profit > 0 and d.volume == 0:
        continue
    pos_id = d.position_id
    if pos_id not in positions:
        positions[pos_id] = []
    positions[pos_id].append(d)

total_pnl = 0.0
print("\n" + "=" * 90)
print(f"{'Pos ID':<12} {'Symbol':<12} {'Open Time':<20} {'Close Time':<20} {'Vol':<6} {'Net P&L':<10}")
print("=" * 90)

for pos_id, p_deals in sorted(positions.items(), key=lambda x: min(d.time for d in x[1])):
    # Determine symbol and times
    symbol = p_deals[0].symbol
    if not symbol:
        continue
    open_time = datetime.fromtimestamp(min(d.time for d in p_deals), tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    close_time = datetime.fromtimestamp(max(d.time for d in p_deals), tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    vol = max(d.volume for d in p_deals)
    net_pnl = sum(d.profit + d.swap + d.commission + d.fee for d in p_deals)
    total_pnl += net_pnl
    print(f"{pos_id:<12} {symbol:<12} {open_time:<20} {close_time:<20} {vol:<6.2f} {net_pnl:>+9.2f}")

print("=" * 90)
print(f"Total MT5 Closed Position Net P&L: ${total_pnl:,.2f}")
print("=" * 90)

# 2. Test mt5_notion_sync_wine.py's reconstruction logic
print("\nTesting mt5_notion_sync_wine.py trade reconstruction...")
try:
    import mt5_notion_sync_wine as sync
    reconstructed = sync.fetch_reconstructed_trades(all_history=True)
    print(f"[Reconstruction] Built {len(reconstructed)} setups.")
    recon_total = sum(t["net_pnl"] for t in reconstructed)
    print(f"[Reconstruction] Total Net P&L: ${recon_total:,.2f}")

    recon_dates = {t["open_time"][:10]: t for t in reconstructed}
    print(f"[Reconstruction] Earliest: {min(t['open_time'] for t in reconstructed)}")
    print(f"[Reconstruction] Latest:   {max(t['open_time'] for t in reconstructed)}")
except Exception as e:
    print(f"[Reconstruction Error] {e}")

mt5.shutdown()
