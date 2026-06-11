import json
import os
import glob
import re
from pathlib import Path

# ─── CONFIG ───────────────────────────────────────────────────────────────────
# Point this at your Cricsheet IPL 2025 folder
INPUT_FOLDER = r"C:\Users\arjun\OneDrive\Documents\Arjun\IPL\ipl_json"
OUTPUT_FILE  = "./matches_firebase.json"

# Your player name mapping (Cricsheet name -> Your site name)
# Add more as needed when you find mismatches
NAME_MAP = {
    # ── BATTERS ──────────────────────────────────────────
    "TM Head":              "Travis Head",
    "D Padikkal":           "Devdutt Padikkal",
    "Virat Kohli":          "Virat Kohli",
    "V Kohli":              "Virat Kohli",
    "RM Patidar":           "Rajat Patidar",
    "TH David":             "Tim David",
    "AM Rahane":            "Ajinkya Rahane",
    "A Raghuvanshi":        "Angkrish Raghuvanshi",
    "RK Singh":             "Rinku Singh",
    "Rohit Sharma":         "Rohit Sharma",
    "RG Sharma":            "Rohit Sharma",
    "Suryakumar Yadav":     "Suryakumar Yadav",
    "Tilak Varma":          "Tilak Varma",
    "Naman Dhir":           "Naman Dhir",
    "MK Pandey":            "Manish Pandey",
    "RD Gaikwad":           "Ruturaj Gaikwad",
    "A Mhatre":             "Ayush Mhatre",
    "SN Khan":              "Sarfaraz Khan",
    "Yashasvi Jaiswal":     "Yashasvi Jaiswal",
    "YBK Jaiswal":          "Yashasvi Jaiswal",
    "V Suryavanshi":        "Vaibhav Sooryavanshi", # Matches your site's "Sooryavanshi"
    "SO Hetmyer":           "Shimron Hetmyer",
    "SB Dubey":             "Shubham Dubey",
    "Shubman Gill":         "Shubman Gill",
    "Sai Sudharsan":        "Sai Sudharsan", # Matches your site's "Sudharshan"
    "B Sai Sudharsan":      "Sai Sudharsan",
    "DA Miller":            "David Miller",
    "P Simran Singh":       "Prabhsimran Singh",
    "Shashank Singh":       "Shashank Singh",
    "N Wadhera":            "Nehal Wadhera",
    "Priyansh Arya":        "Priyansh Arya",
    "SS Iyer":              "Shreyas Iyer",
    "Abdul Samad":          "Abdul Samad",
    "A Badoni":             "Ayush Badoni",
    "N Rana":               "Nitish Rana",
    "P Nissanka":           "Pathum Nissanka",
    "Sameer Rizvi":         "Sameer Rizvi",
    "Ashutosh Sharma":      "Ashutosh Sharma",
    "KK Nair":              "Karun Nair",
    "R Powell":             "Rovman Powell",
    "JJ Bumrah":            "Jasprit Bumrah",
    "SE Rutherford":        "Sherfane Rutherford",
    "SA Yadav":              "Suryakumar Yadav",

    # ── ALL-ROUNDERS ─────────────────────────────────────
    "Abhishek Sharma":      "Abhishek Sharma",
    "Nithish Kumar Reddy":  "Nitish Kumar Reddy",
    "R Shepherd":           "Romario Shepherd",
    "Krunal Pandya":        "Krunal Pandya",
    "KH Pandya":            "Krunal Pandya",
    "Hardik Pandya":        "Hardik Pandya",
    "HH Pandya":            "Hardik Pandya",
    "C Green":              "Cameron Green",
    "Ramandeep Singh":      "Ramandeep Singh",
    "SP Narine":            "Sunil Narine",
    "AS Roy":               "Anukul Roy",
    "R Parag":              "Riyan Parag",
    "Ravindra Jadeja":      "Ravindra Jadeja",
    "RA Jadeja":            "Ravindra Jadeja",
    "S Dube":               "Shivam Dube",
    "M Shahrukh Khan":      "Shahrukh Khan",
    "R Tewatia":            "Rahul Tewatia",
    "MP Stoinis":           "Marcus Stoinis",
    "MR Marsh":             "Mitchell Marsh", # Matches your site's exact formatting
    "AK Markram":           "Aiden Markram",
    "AR Patel":             "Axar Patel",
    "R Smaran":             "Smaran Ravichandran",
    "MJ Santner":           "Mitchell Santner",
    "C Bosch":              "Corbin Bosch",
    "Auqib Nabi":           "Auqib Nabi Dar",
    "PR Veer":              "Prashant Veer",
    "RA Bawa":              "Raj Angad Bawa",
    "MJ Suthar":            "Manav Suthar",
    "JG Bethell":           "Jacob Bethell",
    "VR Iyer":              "Venkatesh Iyer",
    "LS Livingstone":       "Liam Livingstone",
    "C Connolly":           "Cooper Connolly",
    "Shahbaz Ahmed":        "Shahbaz Ahmed",
    "J Overton":            "Jamie Overton",
    "WG Jacks":             "Will Jacks",
    "D Brevis":             "Dewald Brevis",
    "JO Holder":            "Jason Holder",

    # ── WICKETKEEPERS ────────────────────────────────────
    "JM Sharma":            "Jitesh Sharma",
    "PD Salt":              "Philip Salt",
    "H Klaasen":            "Heinrich Klaasen",
    "S Arora":              "Salil Arora",
    "FH Allen":             "Finn Allen",
    "RD Rickelton":         "Ryan Rickelton",
    "Sanju Samson":         "Sanju Samson",
    "SV Samson":            "Sanju Samson",
    "Dhruv Jurel":          "Dhruv Jurel",
    "D Ferreira":           "Donovan Ferreira",
    "Kartik Sharma":        "Kartik Sharma",
    "JC Buttler":           "Jos Buttler",
    "RR Pant":              "Rishabh Pant",
    "N Pooran":             "Nicholas Pooran",
    "Q de Kock":            "Quinton De Kock",
    "R Minz":               "Robin Minz",
    "Abishek Porel":        "Abhishek Porel",
    "TL Seifert":           "Tim Seifert",
    "LG Pretorius":         "Lhuan-dre Pretorius",
    "JP Inglis":            "Josh Inglis",
    "T Stubbs":              "Tristan Stubbs",
    "JM Cox":                "Jordan Cox",

    # ── BOWLERS ──────────────────────────────────────────
    "JA Duffy":             "Jacob Duffy",
    "PJ Cummins":           "Pat Cummins",
    "JR Hazlewood":         "Josh Hazlewood",
    "RD Chahar":            "Rahul Chahar",
    "B Kumar":              "Bhuvneshwar Kumar",
    "Suyash Sharma":        "Suyash Sharma",
    "HV Patel":             "Harshal Patel",
    "JD Unadkat":           "Jaydev Unadkat",
    "TA Boult":             "Trent Boult",
    "AM Ghazanfar":         "AM Ghazanfar",
    "Jasprit Bumrah":       "Jasprit Bumrah",
    "SN Thakur":            "Shardul Thakur",
    "M Markande":           "Mayank Markande",
    "VG Arora":             "Vaibhav Arora",
    "B Muzarabani":         "Blessing Muzarabani",
    "CV Varun":             "Varun Chakaravarthy",
    "Kartik Tyagi":         "Kartik Tyagi",
    "JC Archer":            "Jofra Archer",
    "Sandeep Sharma":       "Sandeep Sharma",
    "Ravi Bishnoi":         "Ravi Bishnoi",
    "PP Hinge":             "Praful Hinge",
    "Noor Ahmad":           "Noor Ahmad",
    "MJ Henry":             "Matt Henry",
    "A Kamboj":             "Anshul Kamboj",
    "KK Ahmed":             "Khaleel Ahmed",
    "Arshdeep Singh":       "Arshdeep Singh",
    "M Jansen":             "Marco Jansen",
    "YS Chahal":            "Yuzvendra Chahal",
    "Mohammed Siraj":       "Mohammed Siraj",
    "K Rabada":             "Kagiso Rabada",
    "Ashok Sharma":         "Ashok Sharma",
    "M Prasidh Krishna":    "Prasidh Krishna",
    "Mukesh Kumar":         "Mukesh Kumar",
    "L Ngidi":              "Lungi Ngidi",
    "T Natarajan":          "T Natarajan",
    "Kuldeep Yadav":        "Kuldeep Yadav",
    "MD Choudhary":         "Mukesh Choudhary",
    "V Nigam":              "Vipraj Nigam",
    "Mohammed Shami":       "Mohammed Shami",
    "Mohsin Khan":          "Mohsin Khan",
    "M Siddharth":          "Manimaran Siddharth",
    "DS Rathi":             "Digvesh Rathi",
    "Avesh Khan":           "Avesh Khan",
    "DL Chahar":            "Deepak Chahar",
    "LH Ferguson":          "Lockie Ferguson",
    "MA Starc":             "Mitchell Starc",
    "AJ Hosein":            "Akeal Hosein",
    "R Sai Kishore":        "Sai Kishore",
    "TU Deshpande":         "Tushar Deshpande",
    "N Burger":             "Nandre Burger",
    "Prince Yadav":         "Prince Yadav",
    "MP Yadav":             "Mayank Yadav",
    "Rasikh Salam":         "Rasikh Salam Dar",
    "Akshat Raghuwanshi":   "Akshat Raghuwanshi",
    "A Nortje":             "Anrich Nortje",
    "Brijesh Sharma":       "Brijesh Sharma",
    "MD Shanaka":           "Dasun Shanaka",
    "DA Payne":             "David Payne",
    "D Madushanka":         "Dilshan Madushanka",
    "PVD Chameera":         "Dushmantha Chameera",
    "E Malinga":            "Eshan Malinga",
    "GF Linde":             "George Linde",
    "GD Phillips":          "Glenn Phillips",
    "Gurjapneet Singh":     "Gurjapneet Singh",
    "J Overton":            "Jamie Overton",
    "KA Jamieson":          "Kyle Jamieson",
    "Krish Bhagat":         "Krish Bhagat",
    "MW Short":             "Matt Short",
    "N Sindhu":             "Nishant Sindhu",
    "Raghu Sharma":         "Raghu Sharma",
    "RS Ghosh":             "Ramakrishna Ghosh",
    "SU Parakh":            "Sahil Parakh",
    "XC Bartlett":          "Xavier Bartlett"
}

# List of players who must have the airplane symbol in your database
OVERSEAS_PLAYERS = {
    "Akeal Hosein", "Dewald Brevis", "Jamie Overton", "Matt Henry", 
    "Matt Short", "Mitchell Santner", "Noor Ahmad", "David Miller", 
    "Kyle Jamieson", "Lhuan-dre Pretorius", "Lungi Ngidi", 
    "Mitchell Starc", "Pathum Nissanka", "Tristan Stubbs", 
    "Dushmantha Chameera", "Glenn Phillips", "Jason Holder", 
    "Jos Buttler", "Kagiso Rabada", "Blessing Muzarabani", 
    "Cameron Green", "Finn Allen", "Rachin Ravindra", 
    "Rovman Powell", "Sunil Narine", "Tim Seifert", 
    "Aiden Markram", "Anrich Nortje", "Donovan Ferreira", 
    "George Linde", "Josh Inglis", "Matthew Breetzke", 
    "Nicholas Pooran", "Corbin Bosch", "Mitchell Marsh", 
    "Quinton De Kock", "Ryan Rickelton", "Sherfane Rutherford", 
    "Trent Boult", "Will Jacks", "Cooper Connolly", 
    "Lockie Ferguson", "Marco Jansen", "Marcus Stoinis", 
    "Mitchell Owen", "Xavier Bartlett", "Jacob Bethell", 
    "Jacob Duffy", "Josh Hazlewood", "Philip Salt", 
    "Romario Shepherd", "Tim David", "Dasun Shanaka", 
    "Jofra Archer", "David Payne", "Dilshan Madushanka", 
    "Heinrich Klaasen", "Liam Livingstone", "Pat Cummins", 
    "Travis Head", "Rashid Khan", "Eshan Malinga", "AM Ghazanfar", "Shimron Hetmyer"
}


TEAM_MAP = {
    "Chennai Super Kings":      "CSK",
    "Delhi Capitals":           "DC",
    "Gujarat Titans":           "GT",
    "Kolkata Knight Riders":    "KKR",
    "Lucknow Super Giants":     "LSG",
    "Mumbai Indians":           "MI",
    "Punjab Kings":             "PBKS",
    "Rajasthan Royals":         "RR",
    "Royal Challengers Bengaluru": "RCB",
    "Royal Challengers Bangalore": "RCB",
    "Sunrisers Hyderabad":      "SRH",
}

def normalize_name(name):
    return NAME_MAP.get(name, name)

def get_team_code(name):
    return TEAM_MAP.get(name, name)

def parse_match(filepath):
    with open(filepath, 'r') as f:
        data = json.load(f)

    info = data.get('info', {})
    innings_list = data.get('innings', [])

    # Only process IPL 2025
    season = str(info.get('season', ''))
    if '2026' not in season:
        return None

    teams = info.get('teams', [])
    if len(teams) < 2:
        return None

    team1 = get_team_code(teams[0])
    team2 = get_team_code(teams[1])
    match_label = f"{team1} vs {team2}"

    dates = info.get('dates', [])
    date_str = dates[0] if dates else ''

    motm_list = info.get('player_of_match', [])
    motm = normalize_name(motm_list[0]) if motm_list else ''

    # ── Per-player stat accumulator ────────────────────────────────────────────
    players = {}

    def get_player(name):
        name = normalize_name(name)
        if name not in players:
            players[name] = {
                'name': name,
                'runs': 0, 'balls': 0, 'fours': 0, 'sixes': 0,
                'catches': 0, 'runouts': 0,
                'topWickets': 0, 'lowerWickets': 0,
                'economy': 0, 'oversBowled': 0,
                '_runsGiven': 0, '_ballsBowled': 0, '_wickets': 0,
                '_battingPos': 99
            }
        return players[name]

    for innings_idx, innings in enumerate(innings_list):
        batting_team = innings.get('team', '')
        overs = innings.get('overs', [])

        # Track batting position per innings
        batting_order = []

        for over_data in overs:
            over_num = over_data.get('over', 0)
            deliveries = over_data.get('deliveries', [])

            for delivery in deliveries:
                batter_name = delivery.get('batter', '')
                bowler_name = delivery.get('bowler', '')
                runs_data   = delivery.get('runs', {})
                wickets     = delivery.get('wickets', [])
                extras      = delivery.get('extras', {})

                batter_runs  = runs_data.get('batter', 0)
                extra_type   = list(extras.keys()) if extras else []
                is_wide      = 'wides' in extra_type
                is_no_ball   = 'noballs' in extra_type

                # ── Batting ──────────────────────────────────────────────────
                if batter_name:
                    p = get_player(batter_name)
                    if batter_name not in batting_order:
                        batting_order.append(batter_name)
                        p['_battingPos'] = min(p['_battingPos'], len(batting_order))

                    p['runs'] += batter_runs
                    if not is_wide:
                        p['balls'] += 1
                    if batter_runs == 4:
                        p['fours'] += 1
                    if batter_runs == 6:
                        p['sixes'] += 1

                # ── Bowling ───────────────────────────────────────────────────
                if bowler_name:
                    p = get_player(bowler_name)
                    if not is_wide and not is_no_ball:
                        p['_ballsBowled'] += 1
                    p['_runsGiven'] += runs_data.get('total', 0)
                    if is_wide or is_no_ball:
                        p['_runsGiven'] -= extras.get('wides', 0) + extras.get('noballs', 0)
                        p['_runsGiven'] += extras.get('wides', 0) + extras.get('noballs', 0)

                # ── Wickets ───────────────────────────────────────────────────
                for wicket in wickets:
                    kind        = wicket.get('kind', '')
                    player_out  = wicket.get('player_out', '')
                    fielders    = wicket.get('fielders', [])

                    # Batting position of dismissed player
                    out_pos = batting_order.index(player_out) + 1 if player_out in batting_order else 99
                    is_lower = out_pos >= 8  # positions 8-11 = lower order

                    # Bowler gets credit
                    if kind not in ('run out', 'retired hurt', 'obstructing the field', 'hit wicket'):
                        if bowler_name:
                            bowler = get_player(bowler_name)
                            if is_lower:
                                bowler['lowerWickets'] += 1
                            else:
                                bowler['topWickets'] += 1

                    # Fielding: catches
                    if kind == 'caught':
                        for f in fielders:
                            fname = f.get('name', '')
                            if fname and fname != bowler_name:
                                get_player(fname)['catches'] += 1
                        if kind == 'caught' and not fielders and bowler_name:
                            # caught & bowled
                            get_player(bowler_name)['catches'] += 1

                    # Fielding: runouts & stumpings
                    if kind in ('run out', 'stumped'):
                        for f in fielders:
                            fname = f.get('name', '')
                            if fname:
                                get_player(fname)['runouts'] += 1

    # ── Finalise bowling stats ─────────────────────────────────────────────────
    for p in players.values():
        balls = p['_ballsBowled']
        if balls > 0:
            overs_bowled = balls // 6 + (balls % 6) / 10
            p['oversBowled'] = round(overs_bowled, 1)
            p['economy']     = round((p['_runsGiven'] / balls) * 6, 2) if balls > 0 else 0
        # Clean up internal tracking fields
        del p['_runsGiven']
        del p['_ballsBowled']
        del p['_battingPos']

    player_stats = list(players.values())
    
    # AUTOMATIC AIRPLANE SYMBOL ATTACHMENT
    for p in player_stats:
        if p['name'] in OVERSEAS_PLAYERS:
            # Check if it already has the symbol to avoid adding it twice
            if " ✈︎" not in p['name']:
                p['name'] = p['name'] + " ✈︎"

    return {
        'teams':       match_label,
        'date':        date_str,
        'confirmed':   True,
        'motm':        motm + (" ✈︎" if motm in OVERSEAS_PLAYERS and " ✈︎" not in motm else ""),
        'playerStats': player_stats
    }


def main():
    files = sorted(glob.glob(os.path.join(INPUT_FOLDER, '*.json')))
    print(f"Found {len(files)} JSON files")

    matches = []
    skipped = 0

    for filepath in files:
        try:
            result = parse_match(filepath)
            if result:
                matches.append(result)
                print(f"  Parsed: {result['teams']} ({result['date']})")
            else:
                skipped += 1
        except Exception as e:
            print(f"  ERROR parsing {filepath}: {e}")
            skipped += 1

    print(f"\nParsed {len(matches)} IPL 2025 matches, skipped {skipped}")

    with open(OUTPUT_FILE, 'w') as f:
        json.dump(matches, f, indent=2)

    print(f"Output written to {OUTPUT_FILE}")
    print("\nTo import into Firebase, run this in your browser console on the site:")
    print("  (paste the contents of matches_firebase.json into Firebase at leagues/2026/matches)")


if __name__ == '__main__':
    main()
