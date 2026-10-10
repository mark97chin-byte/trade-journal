import os
import time
from datetime import datetime, timedelta
import requests
import sqlite3

CACHE_WINDOW_DAYS = 35
UPLOAD_DIR = os.path.join("apps", "web", "public", "uploads", "notion")

def prune_old_cached_images():
    """Deletes any local image files older than CACHE_WINDOW_DAYS to save disk space."""
    if not os.path.exists(UPLOAD_DIR):
        return

    cutoff_date = datetime.now() - timedelta(days=CACHE_WINDOW_DAYS)
    deleted_count = 0

    for filename in os.listdir(UPLOAD_DIR):
        if not filename.endswith(".png"):
            continue
        try:
            # Expected filename format: YYYY-MM-DD_blockid.png
            date_part = filename.split("_")[0]
            file_date = datetime.strptime(date_part, "%Y-%m-%d")

            if file_date < cutoff_date:
                file_path = os.path.join(UPLOAD_DIR, filename)
                os.remove(file_path)
                deleted_count += 1
        except Exception:
            continue

    if deleted_count > 0:
        print(f"[Storage] Pruned {deleted_count} cached images older than 5 weeks.")

def download_recent_image(image_url, date_str, block_id):
    """Saves image to disk only if within the active 5-week window."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{date_str}_{block_id[:8]}.png"
    local_path = os.path.join(UPLOAD_DIR, filename)

    if not os.path.exists(local_path):
        res = requests.get(image_url)
        if res.status_code == 200:
            with open(local_path, "wb") as f:
                f.write(res.content)

    return f"/uploads/notion/{filename}"
