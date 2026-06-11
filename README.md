
# 🏆 IPL Fantasy Auction & League Dashboard (2026)

A real-time IPL Fantasy Cricket platform featuring a live commissioner draft dashboard, head-to-head form guides, advanced roster optimization, and custom performance metrics. 

###  Key Features
* **Real-Time Fantasy Interface:** Built with a Firebase Real-Time Database backend.
* **Automated Statistics Pipeline:** Custom Python parser that ingests ball-by-ball tournament data.
* **Dynamic Roster Optimization:** Client-side HTML5 drag-and-drop mechanics.
* **Overseas Player Tracking:** End-to-end management of overseas player string tokenization.

###  Setup Instructions
1. Clone the repository.
2. Rename `firebase-config.example.js` to `firebase-config.js`.
3. Paste your own Firebase project credentials into the new config file.
4. Launch `index.html` using a local web server.

### 🐍 Python Data Pipeline
This repository includes a custom backend parser located in the `data_pipeline` folder. These scripts ingest massive amounts of raw match data downloaded directly from [Cricsheet.org](https://cricsheet.org/) (JSON format) and convert it into our specialized fantasy scoring matrix.

* **`parse_cricsheet.py`**: The main engine. It reads ball-by-ball data, calculates strike rates, economy rates, and fielding points, applies the overseas player symbol (`✈︎`), and outputs a clean JSON file ready for Firebase.
* **`find_ipl_2026.py` & `filter_ipl_2026.py`**: Utility scripts used to sift through bulk Cricsheet downloads, isolate the specific matches belonging to the current IPL season, and filter out abandoned/no-result games.
* **`matches_firebase.json`**: The final compiled output that gets imported directly into the Firebase Real-Time Database.

=======
# Mock-IPL-Fantasy-Public
Real-time IPL Fantasy Cricket dashboard featuring live commissioner tools, head-to-head form guides, and drag-and-drop roster optimization. Powered by a Firebase backend and a custom Python data pipeline that parses raw ball-by-ball Cricsheet match data into structured fantasy points and 'Moneyball' ROI metrics.
