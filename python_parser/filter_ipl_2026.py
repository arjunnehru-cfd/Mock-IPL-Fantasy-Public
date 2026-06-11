import json
import os
import glob
import shutil

INPUT_FOLDER   = r"C:\Users\arjun\Downloads\ipl_json"
ARCHIVE_FOLDER = r"C:\Users\arjun\Downloads\ipl_json_other"

os.makedirs(ARCHIVE_FOLDER, exist_ok=True)

files = sorted(glob.glob(os.path.join(INPUT_FOLDER, '*.json')))
print(f"Total files: {len(files)}\n")

kept  = 0
moved = 0

for filepath in files:
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
        info   = data.get('info', {})
        season = str(info.get('season', ''))
        event  = info.get('event', {}).get('name', '')

        if 'Indian Premier League' in event and '2026' in season:
            kept += 1
        else:
            dest = os.path.join(ARCHIVE_FOLDER, os.path.basename(filepath))
            shutil.move(filepath, dest)
            moved += 1

    except Exception as e:
        print(f"Error: {filepath} - {e}")

print(f"Kept:  {kept} IPL 2026 files in {INPUT_FOLDER}")
print(f"Moved: {moved} other files to {ARCHIVE_FOLDER}")
