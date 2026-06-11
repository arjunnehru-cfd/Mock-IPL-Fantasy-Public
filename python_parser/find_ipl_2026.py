import json
import os
import glob

INPUT_FOLDER = r"C:\Users\arjun\Downloads\ipl_json"

files = sorted(glob.glob(os.path.join(INPUT_FOLDER, '*.json')))
print(f"Total files: {len(files)}\n")

for filepath in files:
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
        info = data.get('info', {})
        season = str(info.get('season', ''))
        event = info.get('event', {}).get('name', '')
        teams = info.get('teams', [])
        dates = info.get('dates', [])
        
        if 'Indian Premier League' in event and '2026' in season:
            filename = os.path.basename(filepath)
            print(f"{filename}: {' vs '.join(teams)} ({dates[0] if dates else ''})")
    except Exception as e:
        print(f"Error: {filepath} - {e}")
