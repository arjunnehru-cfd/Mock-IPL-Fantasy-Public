// IPL Fantasy League App - Main JavaScript File


import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, onValue, off, update, get, remove, onDisconnect, push } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app, "https://dalton-ellis-ipl-auction-default-rtdb.europe-west1.firebasedatabase.app/");

// Make sure this line exists right here!
const analytics = getAnalytics(app);



// 🔧 PASTE YOUR CRICAPI KEY HERE (from cricapi.com → Dashboard)
const CRICAPI_KEY = "YOUR_CRICAPI_KEY_HERE";
// ─────────────────────────────────────────────────────────────────────────────

// ── CREDENTIALS ───────────────────────────────────────────────────────────────
const CREDENTIALS = {
  "admin":  { password: "pc", role: "admin", teamIndex: -1 },
  "paulvohra":  { password: "csk", role: "team", teamIndex: 0 },
  "hande":  { password: "rr", role: "team", teamIndex: 1 },
  "hitesh":  { password: "rcb", role: "team", teamIndex: 2 },
  "arjun":  { password: "dc", role: "team", teamIndex: 3 },
  "deep":  { password: "gt", role: "team", teamIndex: 4 },
  "vadi":  { password: "lsg", role: "team", teamIndex: 5 },
  "vaibhav":  { password: "srh", role: "team", teamIndex: 6 },
  "biswas":  { password: "kkr", role: "team", teamIndex: 7 },
  "vikram":  { password: "pbks", role: "team", teamIndex: 8 },
};

// ── POINTS FORMULAS ───────────────────────────────────────────────────────────
function calcSRPoints(runs, balls) {
  if (balls < 6) return 0;
  const sr = (runs / balls) * 100;
  if (sr >= 200) return 10;
  if (sr >= 175) return 6;
  if (sr >= 150) return 4;
  if (sr > 130)  return 2;
  if (sr <= 60)  return -8;
  if (sr <= 80)  return -6;
  if (sr <= 100) return -4;
  return 0; // 101-130
}

function calcBattingBonus(runs) {
  if (runs >= 100) return 16;
  if (runs >= 50)  return 8;
  return 0;
}

function calcBattingTotal(runs, balls, fours, sixes) {
  const srPts = calcSRPoints(runs, balls);
  const bonus = calcBattingBonus(runs);
  return runs + 2 * sixes + fours + srPts + bonus;
}

function calcFieldingPoints(catches, runouts) {
  return 6 * catches + 8 * runouts;
}

function calcEconomyPoints(economy, oversBowled) {
  if (oversBowled < 1) return 0;
  if (economy <= 4)  return 10;
  if (economy <= 6)  return 8;
  if (economy <= 8)  return 2;
  if (economy >= 14) return -8;
  if (economy >= 12) return -4;
  return 0;
}

function calcBowlingBonus(topWickets, lowerWickets) {
  const total = topWickets + lowerWickets;
  if (total >= 5) return 20;
  if (total >= 3) return 8;
  return 0;
}

function calcBowlingTotal(topWickets, lowerWickets, economy, oversBowled) {
  const econ = calcEconomyPoints(economy, oversBowled);
  const bonus = calcBowlingBonus(topWickets, lowerWickets);
  return 30 * topWickets + 15 * lowerWickets + econ + bonus;
}

// MOTM added here! +25 points
function calcPlayerTotal(p, isMotm = false) {
  const bat = calcBattingTotal(p.runs||0, p.balls||0, p.fours||0, p.sixes||0);
  const field = calcFieldingPoints(p.catches||0, p.runouts||0);
  const bowl = calcBowlingTotal(p.topWickets||0, p.lowerWickets||0, p.economy||0, p.oversBowled||0);
  return bat + field + bowl + (isMotm ? 25 : 0);
}

// NEW: Time-Aware Fallback Engine (Wait & See Protocol) + PLAYOFF SHIELD
function getTeamPlayerPts(stat, team, motmName, matchIndex) {
  if (!stat) return 0;
  let pts = calcPlayerTotal(stat, stat.name === motmName);
  let c = team.captain, vc = team.viceCaptain, rep = team.replacement;
  let isPlayoff = false; // 🚨 NEW: Playoff Tracker

  // Build a global timeline cache once per render so the engine knows what GW it is
  if (!window._gwTracker && liveData.matches) {
      window._gwTracker = [];
      const count = {};
      liveData.matches.forEach((m, mi) => {
         const map = {};
         if (m.confirmed && m.teams) {
             m.teams.split(/vs/i).forEach(t => {
                 const code = getTeamCode(t);
                 count[code] = (count[code]||0) + 1; 
                 
                 let gw = count[code];
                 // 🚨 THE SMART BYE FIX
                 const label = (m.label || '').toLowerCase();
                 if (label.includes('final') || mi === 73) gw = 17;
                 else if (label.includes('q2') || label.includes('qualifier 2') || mi === 72) gw = 16;
                 else if (label.includes('q1') || label.includes('elim') || mi === 70 || mi === 71) gw = 15;
                 
                 map[code] = gw;
             });
         }
         window._gwTracker.push(map);
      });
  }

  // Find out exactly what Gameweek THIS specific player is in right now
  if (matchIndex !== undefined && window._gwTracker) {
      const rolesList = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : [];
      const evalTeam = (rolesList.find(r => r.name === stat.name) || {}).iplTeam;
      const gwNum = evalTeam ? window._gwTracker[matchIndex][evalTeam] : null;

      // 🚨 PLAYOFF SHIELD: Match 15, 16, and 17 strip captaincy!
      if (gwNum > 14) isPlayoff = true;

      // 🚨 THE ROSTER SHIELD: Ignore points if the player was transferred in/out
      if (gwNum && team.rosterRules && team.rosterRules[stat.name]) {
          const rule = team.rosterRules[stat.name];
          if (rule.in && gwNum < rule.in) return 0; 
          if (rule.out && gwNum > rule.out) return 0; 
      }

      // The Detective: Check if the C or VC officially missed their specific match
      const definitelyMissed = (playerName) => {
          if (!playerName) return true;
          const pTeam = (rolesList.find(r => r.name === playerName) || {}).iplTeam;
          if (!pTeam) return true;
          
          const targetGW = evalTeam ? window._gwTracker[matchIndex][evalTeam] : null;
          if (!targetGW) return false;
          
          const cMatchIndex = window._gwTracker.findIndex(map => map[pTeam] == targetGW);
          
          if (cMatchIndex === -1) return false; 
          const matches = liveData.matches || [];
          if (!matches[cMatchIndex] || !matches[cMatchIndex].playerStats) return false; 
          
          return !matches[cMatchIndex].playerStats.some(s => s.name === playerName);
      };

      const cMissed = definitelyMissed(c);
      const vcMissed = definitelyMissed(vc);
      
      if (cMissed && vcMissed) { c = rep; vc = null; }
      else if (cMissed && !vcMissed) { c = vc; vc = rep; }
      else if (!cMissed && vcMissed) { vc = rep; }
  }

  // Apply the final Multipliers (ONLY IF NOT IN PLAYOFFS)
  if (!isPlayoff) {
      if (stat.name === c) pts *= 2;
      else if (stat.name === vc) pts *= 1.5;
  }
  
  return pts;
}

// ── SESSION / STATE ───────────────────────────────────────────────────────────
let session = JSON.parse(localStorage.getItem('session')) || null;
let liveData = {};
let currentActiveTab = 'lineups';
let loginStartTime = 0;
let currentTabStartTime = 0;
let lastTabName = '';

// ── HELPERS ───────────────────────────────────────────────────────────────────
function toast(msg, type='info') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast show ${type}`;
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

// NEW: Universal Team Translator (Fixed for RR / RCB overlap!)
function getTeamCode(str) {
  if (!str) return 'NONE';
  const s = str.toUpperCase().replace(/[^A-Z]/g, ''); // Strips spaces and symbols
  
  if (s.includes('CHENNAI') || s === 'CSK') return 'CSK';
  if (s.includes('DELHI') || s === 'DC') return 'DC';
  if (s.includes('GUJARAT') || s === 'GT') return 'GT';
  if (s.includes('KOLKATA') || s === 'KKR') return 'KKR';
  if (s.includes('LUCKNOW') || s === 'LSG') return 'LSG';
  if (s.includes('MUMBAI') || s === 'MI') return 'MI';
  if (s.includes('PUNJAB') || s === 'PBKS') return 'PBKS';
  if (s.includes('RAJASTHAN') || s === 'RR') return 'RR';
  
  // FIX: Removed "ROYAL" so it stops stealing Rajasthan's matches!
  if (s.includes('BANGALORE') || s.includes('BENGALURU') || s.includes('CHALLENGERS') || s === 'RCB') return 'RCB';
  
  if (s.includes('SUNRISERS') || s.includes('HYDERABAD') || s === 'SRH') return 'SRH';
  
  return str.substring(0, 4).toUpperCase(); // Fallback
}

// NEW helper: keeps .5 but removes .0
function showPts(n) { return Math.round((n || 0) * 10) / 10; }
function fmtPts(n) { const v = showPts(n); return (v > 0 ? '+' : '') + v; }

function el(id) { return document.getElementById(id); }

function modal(title, body, footer='') {
  el('modal-title').innerHTML = title;
  el('modal-body').innerHTML = body;
  el('modal-footer').innerHTML = footer;
  el('modal-backdrop').classList.add('open');
}
function closeModal() { el('modal-backdrop').classList.remove('open'); }
window.closeModal = closeModal;

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function tryLogin() {
  const user = el('login-user').value.trim().toLowerCase();
  const pass = el('login-pass').value.trim();
  const cred = CREDENTIALS[user];
  if (!cred || cred.password !== pass) { el('login-error').textContent = 'Invalid username or password.'; return; }
  session = { username: user, role: cred.role, teamIndex: cred.teamIndex };
localStorage.setItem('session', JSON.stringify(session));
  el('login-screen').style.display = 'none';
  el('app').style.display = 'block';
  
  loginStartTime = Date.now();

  logEvent(analytics, 'login', {
      method: 'custom_password',
      username: user
  });

  const loginTime = new Date().toLocaleString('en-GB'); 
  
  // 1. Update the Live Radar
  const userRef = ref(db, `presence/${user}`);
  set(userRef, { online: true, lastLogin: loginTime });
  onDisconnect(userRef).update({ online: false }); 
  
  // 2. Add to Permanent History Log (The new part!)
  const historyRef = ref(db, `loginHistory/${user}`);
  push(historyRef, loginTime); // This creates a running list instead of overwriting!
  
  const currentYear = localStorage.getItem('selectedYear') || '2026';
window.selectedYear = currentYear;

  initApp();
}

let currentListener = null;

function initApp() {
  if (currentListener) {
    off(ref(db, `leagues/${currentListener}`));
  }
  const dataPath = `leagues/${window.selectedYear}`;
  currentListener = window.selectedYear;
  onValue(ref(db, dataPath), snap => {
    liveData = snap.val() || {};
    window._gwTracker = null;
    renderApp();
  });
}

// ── TAB NAVIGATION & ANALYTICS ENGINE ─────────────────────────────────────────
window.showTab = (name) => {
  const now = Date.now();
  
  // ⏱️ 1. Calculate time spent on the PREVIOUS tab
  if (lastTabName && currentTabStartTime > 0) {
    const timeSpentSeconds = Math.round((now - currentTabStartTime) / 1000);
    
    if (timeSpentSeconds > 0) {
      logEvent(analytics, 'tab_engagement', {
        tab_name: lastTabName,
        engagement_time_sec: timeSpentSeconds,
        username: session?.username || 'unknown'
      });
    }
  }
  
  // ⏱️ 2. Start the timer for the NEW tab
  currentTabStartTime = now;
  lastTabName = name;
  currentActiveTab = name; 

  // 3. Update UI (Tabs and Buttons)
  document.querySelectorAll('.tab-page').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  
  const targetPage = el(`tab-${name}`);
  if (targetPage) targetPage.style.display = 'block';
  
  const activeBtn = document.querySelector(`.nav-btn[onclick="showTab('${name}')"]`);
  if (activeBtn) activeBtn.classList.add('active');
  
  // 4. Log standard screen view to Firebase
  logEvent(analytics, 'screen_view', {
    firebase_screen: name, 
    firebase_screen_class: name
  });

  renderTab(name);
};
// ── MAIN RENDER ───────────────────────────────────────────────────────────────
function renderApp() {
  const isAdmin = session.role === 'admin';
  const teams = liveData.teams || [];
  const myTeam = session.teamIndex >= 0 ? teams[session.teamIndex] : null;

  el('app').innerHTML = `
    <header>
      <div class="logo">IPL <span>FANTASY</span> 2026</div>
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
        ${myTeam ? `<div class="header-team-badge">⭐ ${myTeam.name}</div>` : `<div class="header-team-badge admin-badge">🛡 ADMIN</div>`}
        <select id="year-selector" style="background:var(--navy3);border:1px solid var(--gold);color:var(--white);padding:0.4rem 0.8rem;border-radius:6px;font-family:'Rajdhani';font-weight:700;outline:none;cursor:pointer;">
          <option value="2026">2026 LEAGUE</option>
          <option value="2027">2027 LEAGUE</option>
        </select>
        <nav class="header-nav">
          <button class="nav-btn active" onclick="showTab('lineups')">Final Lineups</button>
          <button class="nav-btn" onclick="showTab('league')">League</button>
          
          ${myTeam ? `<button class="nav-btn" onclick="showTab('mysquad')">My Squad</button>` : ''}
          
          <button class="nav-btn" onclick="showTab('squads')">Squads</button>
          <button class="nav-btn" onclick="showTab('matches')">Matches</button>
          <button class="nav-btn" onclick="showTab('h2h')">Form Guide</button>
          <button class="nav-btn" onclick="showTab('leaderboard')">Leaderboard</button>
          ${isAdmin ? `<button class="nav-btn admin-nav" onclick="showTab('admin')">⚙ Admin</button>` : ''}
        </nav>
        <button class="nav-btn logout-btn" onclick="logout()">Logout</button>
      </div>
    </header>

    <!-- 🚨 ADDED THE LINEUPS CONTAINER AND REMOVED ACTIVE STATUS FROM LEAGUE -->
    <div id="tab-lineups"     class="tab-page active-tab" style="padding:1.5rem;"></div>
    <div id="tab-league"      class="tab-page" style="padding:1.5rem;display:none;"></div>
    <div id="tab-mysquad"     class="tab-page" style="padding:1.5rem;display:none;"></div> 
    <div id="tab-squads"      class="tab-page" style="padding:1.5rem;display:none;"></div>
    <div id="tab-matches"     class="tab-page" style="padding:1.5rem;display:none;"></div>
    <div id="tab-h2h"         class="tab-page" style="padding:1.5rem;display:none;"></div>
    <div id="tab-leaderboard" class="tab-page" style="padding:1.5rem;display:none;"></div>
    ${isAdmin ? `<div id="tab-admin" class="tab-page" style="padding:1.5rem;display:none;"></div>` : ''}`;

  window.logout = async () => { 
    if (session && session.username) {
      // ⏱️ Calculate total session time before clearing state
      if (loginStartTime > 0) {
        const sessionTimeSeconds = Math.round((Date.now() - loginStartTime) / 1000);
        logEvent(analytics, 'custom_session_end', {
          session_duration_sec: sessionTimeSeconds,
          username: session.username
        });
      }

      await update(ref(db, `presence/${session.username}`), { online: false });
    }
    session = null;
    localStorage.removeItem('session'); 
    location.reload(); 
  };

  showTab(currentActiveTab);

  const selector = document.getElementById('year-selector');
  if (selector) {
    selector.value = window.selectedYear;
    selector.addEventListener('change', (e) => {
      localStorage.setItem('selectedYear', e.target.value);
      window.selectedYear = e.target.value;
      initApp();
    });
  }
}

// Update the renderTab mapper to include mysquad!
function renderTab(name) {
  const fns = { lineups: renderLineups, league: renderLeague, mysquad: renderMySquad, squads: renderSquads, matches: renderMatches, h2h: renderH2H, leaderboard: renderLeaderboard, admin: renderAdmin };
  if (fns[name]) fns[name]();
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAGUE TABLE & RANK PROGRESSION GRAPH (TOGGLE)
// ─────────────────────────────────────────────────────────────────────────────
function renderLeague() {
  const teams = liveData.teams || [];
  const matches = liveData.matches || [];
  const roles = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : [];

  // Reset chart instance on page load so it re-draws cleanly
  window._rankChartInstance = null; 

  // 1. THE SMART COUNTER
  const franchiseMatchCount = {};
  const matchGW = []; 

  matches.forEach((m, mi) => {
    const gwMap = {};
    if (m.confirmed && m.teams) {
      const teamsPlaying = m.teams.split(/vs/i).map(t => getTeamCode(t));
      teamsPlaying.forEach(team => {
        if (!franchiseMatchCount[team]) franchiseMatchCount[team] = 0;
        franchiseMatchCount[team]++;
        
        let gw = franchiseMatchCount[team];
        // 🚨 THE SMART BYE FIX
        const label = (m.label || '').toLowerCase();
        if (label.includes('final') || mi === 73) gw = 17;
        else if (label.includes('q2') || label.includes('qualifier 2') || mi === 72) gw = 16;
        else if (label.includes('q1') || label.includes('elim') || mi === 70 || mi === 71) gw = 15;
        
        gwMap[team] = gw; 
      });
    }
    matchGW.push(gwMap);
  });

  // 2. CALCULATE POINTS PER GAMEWEEK
  const teamPoints = teams.map((t, ti) => {
    let total = 0;
    const gwPts = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0, 10:0, 11:0, 12:0, 13:0, 14:0, 15:0, 16:0, 17:0 };

    matches.forEach((m, mi) => {
      if (!m.confirmed || !m.playerStats) return;
      (t.players || []).forEach(pName => {
        const stat = m.playerStats.find(s => s.name === pName);
        if (stat) {
          const pts = getTeamPlayerPts(stat, t, m.motm, mi);
          total += pts;
          const playerRoleData = roles.find(r => r.name === pName);
          if (playerRoleData && playerRoleData.iplTeam) {
             const gwNumber = matchGW[mi][playerRoleData.iplTeam];
             if (gwNumber && gwNumber <= 17) gwPts[gwNumber] += pts; // Changed to 17
          }
        }
      });
    });
    return { ...t, teamIndex: ti, total, gwPts };
  });

  // 3. CALCULATE RANK HISTORY FOR THE GRAPH (Change 14 to 17 here)
  const chartData = teamPoints.map(t => ({ name: t.name, gwPts: t.gwPts, cumPts: {0:0}, ranks: [teams.length] }));
  for (let gw = 1; gw <= 17; gw++) {
    chartData.forEach(t => t.cumPts[gw] = t.cumPts[gw-1] + (t.gwPts[gw] || 0));
    const sortedThisWeek = [...chartData].sort((a,b) => b.cumPts[gw] - a.cumPts[gw]);
    chartData.forEach(t => {
      if (t.cumPts[gw] > 0 || gw === 1) { 
         t.ranks[gw] = sortedThisWeek.findIndex(x => x.name === t.name) + 1;
      } else {
         t.ranks[gw] = null; // Hide lines for future unplayed GWs
      }
    });
  }

  // 4. SORT CURRENT LEAGUE STANDINGS
  teamPoints.sort((a,b) => b.total - a.total);
  const myTi = session.teamIndex;
  const myRank = myTi >= 0 ? teamPoints.findIndex(t => t.teamIndex === myTi) + 1 : -1;

  // 5. RENDER THE UI
  el('tab-league').innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div class="page-title">LEAGUE TABLE</div>
        <div class="page-sub">14 Gameweek Structure</div>
      </div>
      ${matches.length > 0 ? `<button class="btn-primary" id="toggle-graph-btn" onclick="toggleRankGraph()">📈 Show Rank Graph</button>` : ''}
    </div>
    
    ${myTi >= 0 ? `
    <div class="my-summary">
      <div class="my-summary-rank">#${myRank}</div>
      <div>
        <div class="my-summary-name">${teams[myTi]?.name || ''}</div>
        <div class="my-summary-pts">${showPts(teamPoints.find(t=>t.teamIndex===myTi)?.total)} pts total</div>
      </div>
    </div>` : ''}

    <div id="rank-chart-wrapper" style="display:none; background:var(--card); border:1px solid var(--border); border-radius:10px; padding:1.5rem; margin-bottom:1.5rem; overflow-x:auto;">
      <div style="min-width: 800px; height: 450px;">
        <canvas id="rankChart"></canvas>
      </div>
    </div>

    <div class="league-table">
      <div class="league-header" style="font-size:0.85rem;">
        <div class="rank-num">#</div><div class="team-name-cell">TEAM</div>
        ${[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(i=>`<div class="match-col" style="min-width:35px;text-align:center;">GW${i}</div>`).join('')}
        
        <!-- 🚨 FIX: Explicit widths to lock the headers in place -->
        <div class="match-col" style="width:50px; text-align:center; color:var(--gold); flex-shrink:0;">Q1/ELI</div>
        <div class="match-col" style="width:40px; text-align:center; color:var(--gold); flex-shrink:0;">Q2</div>
        <div class="match-col" style="width:45px; text-align:center; color:var(--gold); flex-shrink:0;">FINAL</div>
        
        <div class="total-pts-cell">TOTAL</div>
      </div>
      ${teamPoints.map((t, rank) => {
        const isMe = t.teamIndex === myTi;
        return `<div class="league-row ${isMe ? 'my-row' : ''} ${rank===0?'gold-row':rank===1?'silver-row':rank===2?'bronze-row':''}">
          <div class="rank-num">${rank+1}</div>
          <div class="team-name-cell" style="min-width:100px;">${t.name} ${isMe?'⭐':''}</div>
          ${[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(i=>`<div class="match-pts-cell" style="min-width:35px;">${t.gwPts[i] !== 0 ? showPts(t.gwPts[i]) : '—'}</div>`).join('')}
          
          <div class="match-pts-cell" style="width:50px; text-align:center; color:var(--gold); flex-shrink:0;">${t.gwPts[15] !== 0 ? showPts(t.gwPts[15]) : '—'}</div>
          <div class="match-pts-cell" style="width:40px; text-align:center; color:var(--gold); flex-shrink:0;">${t.gwPts[16] !== 0 ? showPts(t.gwPts[16]) : '—'}</div>
          <div class="match-pts-cell" style="width:45px; text-align:center; color:var(--gold); flex-shrink:0;">${t.gwPts[17] !== 0 ? showPts(t.gwPts[17]) : '—'}</div>
          
          <div class="total-pts-cell">${showPts(t.total)}</div>
        </div>`;
      }).join('')}
    </div>`;

  // 6. BUTTON TOGGLE SCRIPT
  window.toggleRankGraph = () => {
    const wrapper = document.getElementById('rank-chart-wrapper');
    const btn = document.getElementById('toggle-graph-btn');
    if (!wrapper) return;

    if (wrapper.style.display === 'none') {
      wrapper.style.display = 'block';
      btn.innerHTML = '📉 Hide Rank Graph';

      // Only draw the chart the very first time they open it
      if (!window._rankChartInstance) {
          const canvas = document.getElementById('rankChart');
          if (canvas) {
              const ctx = canvas.getContext('2d');
              const colors = ['#FFFF3C', '#e73985', '#ec1c24', '#00008b', '#222b46', '#0057e2', '#ee7429', '#3a225d', '#dd1f2d'];
              
              window._rankChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                  labels: ['Start', ...[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(i=>'GW'+i)],
                  datasets: chartData.map((t, i) => ({
                    label: t.name,
                    data: t.ranks,
                    borderColor: colors[i % colors.length],
                    backgroundColor: colors[i % colors.length],
                    tension: 0.3,
                    borderWidth: 3,
                    pointRadius: 4,
                    spanGaps: true
                  }))
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { 
                    legend: { labels: { color: '#f5f0e8', font: { family: 'Rajdhani', size: 14 } } },
                    tooltip: {
                       callbacks: {
                          label: (context) => `${context.dataset.label}: Rank ${context.raw}`
                       }
                    }
                  },
                  scales: {
                    y: { 
                      reverse: true, 
                      min: 0.5, 
                      max: teams.length + 0.5, 
                      grid: { color: 'rgba(255,255,255,0.05)' },
                      ticks: { 
                          color: '#8892a4', 
                          font: { family: 'Bebas Neue', size: 16 }
                      },
                      // This override forces exactly 1 through 9 to appear!
                      afterBuildTicks: function(axis) {
                          axis.ticks = [];
                          for (let i = 1; i <= teams.length; i++) {
                              axis.ticks.push({ value: i });
                          }
                      }
                  },

                    x: { 
                        ticks: { color: '#8892a4', font: { family: 'Rajdhani', weight: 700 } },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    }
                  }
                }
              });
          }
      }
    } else {
      wrapper.style.display = 'none';
      btn.innerHTML = '📈 Show Rank Graph';
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MY SQUAD (PERSONAL DASHBOARD)
// ─────────────────────────────────────────────────────────────────────────────
function renderMySquad() {
  if (session.teamIndex < 0) return; // Admins don't have a personal squad
  
  const teams = liveData.teams || [];
  const matches = liveData.matches || [];
  const roles = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : [];
  const myTeam = teams[session.teamIndex];

  // 1. Smart Counter to track Gameweeks for the whole league first
  const matchGW = [];
  const franchiseMatchCount = {};
  matches.forEach((m, mi) => {
      const gwMap = {};
      if (m.confirmed && m.teams) {
          m.teams.split(/vs/i).forEach(t => {
              const team = getTeamCode(t);
              if (!franchiseMatchCount[team]) franchiseMatchCount[team] = 0;
              franchiseMatchCount[team]++;
              
              let gw = franchiseMatchCount[team];
              // 🚨 THE SMART BYE FIX
              const label = (m.label || '').toLowerCase();
              if (label.includes('final') || mi === 73) gw = 17;
              else if (label.includes('q2') || label.includes('qualifier 2') || mi === 72) gw = 16;
              else if (label.includes('q1') || label.includes('elim') || mi === 70 || mi === 71) gw = 15;
              
              gwMap[team] = gw;
          });
      }
      matchGW.push(gwMap);
  });

  // 2. Loop through MY PLAYERS and gather their stats
  const myPlayers = (myTeam.players || []).map(pName => {
    const roleData = roles.find(r => r.name === pName);
    const iplTeam = roleData ? roleData.iplTeam : null;

    const pStats = { 
        id: pName.replace(/[^a-zA-Z0-9]/g, ''), 
        name: pName, 
        iplTeam: iplTeam || 'NONE',
        isCap: pName === myTeam.captain, 
        isVC: pName === myTeam.viceCaptain, 
        isRep: pName === myTeam.replacement,
        matches: 0, rawPts: 0, batPts: 0, bowlPts: 0, fieldPts: 0, totalPts: 0, gwHistory: {} 
    };

    matches.forEach((m, mi) => {
      if (!m.confirmed || !m.playerStats) return;
      const stat = m.playerStats.find(s => s.name === pName);
      const gwNum = iplTeam ? matchGW[mi][iplTeam] : null;

      if (stat && gwNum) {
        // 🚨 THE ROSTER SHIELD: Ignore points from before they joined or after they left!
        if (myTeam.rosterRules && myTeam.rosterRules[pName]) {
            const rule = myTeam.rosterRules[pName];
            if (rule.in && gwNum < rule.in) return; 
            if (rule.out && gwNum > rule.out) return; 
        }

        pStats.matches++; 

        // Calculate pure unmultiplied points
        const bat = calcBattingTotal(stat.runs||0, stat.balls||0, stat.fours||0, stat.sixes||0);
        const bowl = calcBowlingTotal(stat.topWickets||0, stat.lowerWickets||0, stat.economy||0, stat.oversBowled||0);
        const field = calcFieldingPoints(stat.catches||0, stat.runouts||0);
        const isMotm = m.motm === pName;
        const motmPts = isMotm ? 25 : 0;

        const raw = bat + bowl + field + motmPts;
        
        // Dynamic Fallback Multiplier (Time-Aware)
        let c = myTeam.captain, vc = myTeam.viceCaptain, rep = myTeam.replacement;
        
        const definitelyMissed = (playerName) => {
            if (!playerName || !window._gwTracker) return true;
            const pTeam = (roles.find(r => r.name === playerName) || {}).iplTeam;
            if (!pTeam) return true;
            
            const targetGW = matchGW[mi][iplTeam]; 
            const cMatchIndex = window._gwTracker.findIndex(map => map[pTeam] == targetGW);
            
            if (cMatchIndex === -1) return false; 
            if (!matches[cMatchIndex] || !matches[cMatchIndex].playerStats) return false;
            
            return !matches[cMatchIndex].playerStats.some(s => s.name === playerName);
        };

        const cMissed = definitelyMissed(c);
        const vcMissed = definitelyMissed(vc);
        
        if (cMissed && vcMissed) { c = rep; vc = null; }
        else if (cMissed && !vcMissed) { c = vc; vc = rep; }
        else if (!cMissed && vcMissed) { vc = rep; }

        let mult = 1;
        
        // 🚨 THE FIX: Only apply Captain/VC multipliers during the regular season (GW 1-14)
        if (gwNum <= 14) {
            if (pName === c) mult = 2;
            if (pName === vc) mult = 1.5;
        }
        
        const total = raw * mult;

        // Add to overall totals
        pStats.rawPts += raw;
        pStats.batPts += bat;
        pStats.bowlPts += bowl;
        pStats.fieldPts += field;
        pStats.totalPts += total;

        // Add to Gameweek history dropdown
        pStats.gwHistory[gwNum] = { bat, bowl, field, motm: motmPts, total, mult };
      }
    });

    pStats.ppm = pStats.matches > 0 ? (pStats.totalPts / pStats.matches) : 0;
    return pStats;
  });

  // 🚨 THE NEW SORTING ENGINE
  // Grabs the current sorting rules, defaults to 'totalPts' descending
  const sortKey = window._mySquadSortKey || 'totalPts';
  const sortAsc = window._mySquadSortAsc || false;

  myPlayers.sort((a,b) => {
      let valA = a[sortKey];
      let valB = b[sortKey];

      // If the user clicks Team or Player, sort alphabetically
      if (typeof valA === 'string') {
          return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      // Otherwise, sort by the numbers
      return sortAsc ? valA - valB : valB - valA;
  });

  // A helper function to draw the arrows in the headers
  const getArrow = (key) => {
      if (sortKey === key) return sortAsc ? '▲' : '▼';
      return '<span style="color:var(--gray);font-size:0.7rem;">↕</span>';
  };

  // 3. Render the UI
  el('tab-mysquad').innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div class="page-title">MY SQUAD DASHBOARD</div>
      <button class="btn-primary" onclick="showPlayingXIIModal()">🏏 BUILD PLAYING XII</button>
    </div>
    
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow-x:auto;">
      <table class="mysquad-table">
        <thead>
          <tr style="user-select:none;">
            <th onclick="sortMySquad('iplTeam')" style="cursor:pointer; transition:color 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--gold)'">TEAM ${getArrow('iplTeam')}</th>
            <th onclick="sortMySquad('name')" style="cursor:pointer; transition:color 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--gold)'">PLAYER ${getArrow('name')}</th>
            <th onclick="sortMySquad('totalPts')" style="cursor:pointer; transition:color 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--gold)'">POINTS ${getArrow('totalPts')}</th>
            <th onclick="sortMySquad('rawPts')" style="cursor:pointer; transition:color 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--gold)'">RAW ${getArrow('rawPts')}</th>
            <th onclick="sortMySquad('batPts')" style="cursor:pointer; transition:color 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--gold)'">BAT ${getArrow('batPts')}</th>
            <th onclick="sortMySquad('bowlPts')" style="cursor:pointer; transition:color 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--gold)'">BOWL ${getArrow('bowlPts')}</th>
            <th onclick="sortMySquad('fieldPts')" style="cursor:pointer; transition:color 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--gold)'">FIELD ${getArrow('fieldPts')}</th>
            <th onclick="sortMySquad('matches')" style="cursor:pointer; transition:color 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--gold)'">M ${getArrow('matches')}</th>
            <th onclick="sortMySquad('ppm')" style="cursor:pointer; transition:color 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--gold)'">PPM ${getArrow('ppm')}</th>
          </tr>
        </thead>
        <tbody>
          ${myPlayers.map(p => `
            <tr class="mysquad-main-row" onclick="togglePlayerGW('${p.id}')" title="Click to view match-by-match breakdown">
              <td style="color:var(--gray);font-weight:700;"><span style="font-size:0.6rem; margin-right:8px; color:var(--gold-dim);">▼</span>${p.iplTeam}</td>
              <td style="font-weight:700;color:var(--white);">${p.name} 
                  ${p.isCap ? '<span style="color:var(--gold);font-size:0.75rem;">(C)</span>' : ''}
                  ${p.isVC ? '<span style="color:#9ca3af;font-size:0.75rem;">(VC)</span>' : ''}
                  ${p.isRep ? '<span style="color:#60a5fa;font-size:0.75rem;">(R)</span>' : ''}
              </td>
              <td class="pos" style="font-weight:700;">${showPts(p.totalPts)}</td>
              <td>${showPts(p.rawPts)}</td>
              <td>${showPts(p.batPts)}</td>
              <td>${showPts(p.bowlPts)}</td>
              <td>${showPts(p.fieldPts)}</td>
              <td>${p.matches}</td>
              <td style="color:var(--gold);">${showPts(p.ppm)}</td>
            </tr>
            <tr id="gw-row-${p.id}" class="mysquad-breakdown-row" style="display:none;">
              <td colspan="9">
                <div class="gw-breakdown-box">
                  ${Object.keys(p.gwHistory).length === 0 ? '<div style="color:var(--gray);font-size:0.8rem;">No matches played yet.</div>' : `
                    <table class="gw-table">
                      <tr><th>GW</th><th>BAT</th><th>BOWL</th><th>FIELD</th><th>MOTM</th><th>TOTAL</th></tr>
                      ${Object.keys(p.gwHistory).map(gw => {
                        const h = p.gwHistory[gw];
                        return `<tr>
                          <td>GW${gw}</td>
                          <td class="${h.bat>0?'pos':h.bat<0?'neg':''}">${showPts(h.bat)}</td>
                          <td class="${h.bowl>0?'pos':h.bowl<0?'neg':''}">${showPts(h.bowl)}</td>
                          <td class="${h.field>0?'pos':h.field<0?'neg':''}">${showPts(h.field)}</td>
                          <td>${h.motm>0 ? '<span style="color:var(--gold);">+25</span>' : '-'}</td>
                          <td style="font-weight:700;color:var(--white);">${showPts(h.total)} ${h.mult > 1 ? `<span style="font-size:0.7rem;color:var(--gray);">x${h.mult}</span>` : ''}</td>
                        </tr>`;
                      }).join('')}
                    </table>
                  `}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Interaction script for the table rows
  window.togglePlayerGW = (id) => {
    const row = document.getElementById(`gw-row-${id}`);
    if (row.style.display === 'none') {
        row.style.display = 'table-row';
    } else {
        row.style.display = 'none';
    }
  };

  // 🚨 The Sorting Trigger Function
  window.sortMySquad = (key) => {
      // If clicking the same column, reverse the direction
      if (window._mySquadSortKey === key) {
          window._mySquadSortAsc = !window._mySquadSortAsc; 
      } else {
          // If clicking a new column, set it and default to High-to-Low
          window._mySquadSortKey = key;
          window._mySquadSortAsc = false; 
      }
      renderMySquad(); // Re-draw the screen instantly
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SQUADS (WITH GAMEWEEK FILTER)
// ─────────────────────────────────────────────────────────────────────────────
function renderSquads(selectedGW = 'ALL') {
  const teams = liveData.teams || [];
  const matches = liveData.matches || [];
  const roles = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : [];

  const PLAYOFF_TEAMS = {
      15: ['GT', 'SRH', 'RR', 'RCB'], // Q1 & Eliminator
      16: ['RR', 'GT'],               // 🚨 Q2: Removed RCB so they are correctly on a Bye!
      17: ['RCB', 'GT']               // Final: The 2 finalists
  };

  const isPlayoffGW = selectedGW !== 'ALL' && parseInt(selectedGW) >= 15;
  const currentPlayoffTeams = isPlayoffGW ? (PLAYOFF_TEAMS[parseInt(selectedGW)] || []) : [];

  const matchGW = [];
  const franchiseMatchCount = {};
  matches.forEach((m, mi) => {
    const gwMap = {};
    if (m.confirmed && m.teams) {
      m.teams.split(/vs/i).forEach(t => {
        const team = getTeamCode(t);
        if (!franchiseMatchCount[team]) franchiseMatchCount[team] = 0;
        franchiseMatchCount[team]++;
        
        let gw = franchiseMatchCount[team];
        // 🚨 THE SMART BYE FIX
        const label = (m.label || '').toLowerCase();
        if (label.includes('final') || mi === 73) gw = 17;
        else if (label.includes('q2') || label.includes('qualifier 2') || mi === 72) gw = 16;
        else if (label.includes('q1') || label.includes('elim') || mi === 70 || mi === 71) gw = 15;
        
        gwMap[team] = gw;
      });
    }
    matchGW.push(gwMap);
  });

  el('tab-squads').innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div class="page-title">TEAM SQUADS</div>
      <select id="squad-gw-filter" style="background:var(--navy3);border:1px solid ${isPlayoffGW ? '#f87171' : 'var(--gold)'};color:var(--white);padding:0.4rem 0.8rem;border-radius:6px;font-family:'Rajdhani';font-weight:700;outline:none;cursor:pointer; transition:all 0.3s;">
        <option value="ALL" ${selectedGW==='ALL'?'selected':''}>OVERALL TOTALS</option>
        ${[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(i => `<option value="${i}" ${selectedGW==String(i)?'selected':''}>GAMEWEEK ${i}</option>`).join('')}

        <option value="15" ${selectedGW=='15'?'selected':''}>Q1 / ELIMINATOR</option>
        <option value="16" ${selectedGW=='16'?'selected':''}>QUALIFIER 2</option>
        <option value="17" ${selectedGW=='17'?'selected':''}>THE FINAL</option>
      </select>
    </div>
    
    <div class="squads-grid ${isPlayoffGW ? 'playoff-mode' : ''}">
      ${teams.map((t, ti) => {
        const isMe = session.teamIndex === ti;
        let teamTotal = 0;

        let effC = t.captain, effVC = t.viceCaptain, effRep = t.replacement;
        
        const definitelyMissed = (playerName) => {
            if (!playerName) return true;
            const pTeam = (roles.find(r => r.name === playerName) || {}).iplTeam;
            if (!pTeam) return true;
            
            const mIndex = matchGW.findIndex(map => map[pTeam] == selectedGW);
            
            if (mIndex === -1) return true; 
            if (!matches[mIndex] || !matches[mIndex].playerStats) return true; 
            
            return !matches[mIndex].playerStats.some(s => s.name === playerName);
        };

        // Check if this fantasy team has players in playoff IPL teams
        const teamInPlayoffs = isPlayoffGW ? t.players.some(pName => {
            const pRole = roles.find(r => r.name === pName);
            return pRole && currentPlayoffTeams.includes(pRole.iplTeam);
        }) : false;

        if (selectedGW !== 'ALL') {
            const cMissed = definitelyMissed(t.captain);
            const vcMissed = definitelyMissed(t.viceCaptain);

            if (cMissed && vcMissed) { effC = t.replacement; effVC = null; }
            else if (cMissed && !vcMissed) { effC = t.viceCaptain; effVC = t.replacement; }
            else if (!cMissed && vcMissed) { effVC = t.replacement; }
        }

        // Calculate Points and Badges for ALL players
        const playerTotals = (t.players || []).map(pName => {
          let pts = 0;
          const playerRoleData = roles.find(r => r.name === pName);
          const iplTeam = playerRoleData ? playerRoleData.iplTeam : null;

          matches.forEach((m, mi) => {
            if (!m.confirmed || !m.playerStats) return;
            const stat = m.playerStats.find(s => s.name === pName);
            
            if (selectedGW !== 'ALL') {
                if (!iplTeam || matchGW[mi][iplTeam] != selectedGW) return;
            }

            if (stat) pts += getTeamPlayerPts(stat, t, m.motm, mi);
          });
          
          teamTotal += pts;
          
          let badge = '';
          // Show C/VC/R badges only in non-playoff modes
          if (!isPlayoffGW) {
              if (selectedGW === 'ALL') {
                  if (pName === t.captain) badge = '<span style="color:var(--gold);font-size:0.75rem;margin-left:4px;">(C)</span>';
                  if (pName === t.viceCaptain) badge = '<span style="color:#9ca3af;font-size:0.75rem;margin-left:4px;">(VC)</span>';
                  if (pName === t.replacement) badge = '<span style="color:#60a5fa;font-size:0.75rem;margin-left:4px;">(R)</span>';
              } else {
                  if (pName === t.captain) {
                      if (effC !== t.captain) badge = '<span style="color:var(--red);font-size:0.75rem;margin-left:4px;">(C ❌)</span>';
                      else badge = '<span style="color:var(--gold);font-size:0.75rem;margin-left:4px;">(C)</span>';
                  } else if (pName === t.viceCaptain) {
                      if (effC === t.viceCaptain) badge = '<span style="color:var(--gold);font-size:0.75rem;margin-left:4px;">(VC → C)</span>';
                      else if (effVC !== t.viceCaptain) badge = '<span style="color:var(--red);font-size:0.75rem;margin-left:4px;">(VC ❌)</span>';
                      else badge = '<span style="color:#9ca3af;font-size:0.75rem;margin-left:4px;">(VC)</span>';
                  } else if (pName === t.replacement) {
                      if (effC === t.replacement) badge = '<span style="color:var(--gold);font-size:0.75rem;margin-left:4px;">(R → C)</span>';
                      else if (effVC === t.replacement) badge = '<span style="color:#9ca3af;font-size:0.75rem;margin-left:4px;">(R → VC)</span>';
                      else badge = '<span style="color:#60a5fa;font-size:0.75rem;margin-left:4px;">(R)</span>';
                  }
              }
          }
          
          let played = true;
          let playerFranchiseEliminated = false;
          
          if (selectedGW !== 'ALL') {
              const pTeam = (roles.find(r => r.name === pName) || {}).iplTeam;
              
              if (isPlayoffGW && pTeam) {
                  // Check if this player's franchise is eliminated
                  playerFranchiseEliminated = !currentPlayoffTeams.includes(pTeam);
                  
                  if (!playerFranchiseEliminated) {
                      // Franchise is in playoffs - check if their game has been played
                      const mIndex = matchGW.findIndex(map => map[pTeam] == selectedGW);
                      const gameHasStats = mIndex !== -1 && matches[mIndex] && matches[mIndex].playerStats;
                      
                      if (gameHasStats) {
                          // Game played - check if player is in stats
                          played = matches[mIndex].playerStats.some(s => s.name === pName);
                      } else {
                          // Game not played yet - show as active
                          played = true;
                      }
                  }
              } else if (pTeam) {
                  // Non-playoff gameweeks
                  const mIndex = matchGW.findIndex(map => map[pTeam] == selectedGW);
                  const gameHasStats = mIndex !== -1 && matches[mIndex] && matches[mIndex].playerStats;
                  
                  if (gameHasStats) {
                      played = matches[mIndex].playerStats.some(s => s.name === pName);
                  }
              }
          }
          
          return { name: pName, pts, badge, played, playerFranchiseEliminated };
        });

        // 🚨 THE SURVIVOR SORT: Push eliminated players to the bottom in Playoffs
        playerTotals.sort((a,b) => {
            if (isPlayoffGW) {
                // Push eliminated franchise players to bottom
                if (a.playerFranchiseEliminated && !b.playerFranchiseEliminated) return 1;
                if (!a.playerFranchiseEliminated && b.playerFranchiseEliminated) return -1;
            }
            return b.pts - a.pts; // Default sort by points
        });

        return `<div class="squad-card ${isMe?'my-squad':''}">
          <div class="squad-head">
            <div class="squad-team-name">${t.name} ${isMe?'⭐':''}</div>
            <div class="squad-total">${showPts(teamTotal)} pts</div>
          </div>
          <div class="squad-body">
            ${playerTotals.length === 0 ? `<div class="empty-small">No players assigned.</div>` :
              playerTotals.map(p => {
                
                // Determine styling based on Playoff Mode
                const isEliminated = playerTotals[0]?.playerFranchiseEliminated || (isPlayoffGW && !teamInPlayoffs);
                const rowStyle = (isPlayoffGW && p.playerFranchiseEliminated) 
                    ? 'opacity:0.35; filter:grayscale(100%);' 
                    : (!p.played && selectedGW !== 'ALL' ? 'opacity:0.6;' : '');

                const statusBadge = p.playerFranchiseEliminated
                    ? '<span style="font-size:0.6rem; color:#f87171; background:rgba(248,113,113,0.1); padding:0.1rem 0.3rem; border-radius:3px; margin-left:6px; letter-spacing:1px; border:1px solid rgba(248,113,113,0.3);">ELIMINATED</span>'
                    : (!p.played && selectedGW !== 'ALL' ? '<span style="font-size:0.65rem; color:var(--gray); margin-left:6px; letter-spacing:1px;">DNP</span>' : '');
                    
                return `
                <div class="squad-player-row" style="${rowStyle}">
                  <div class="squad-player-name">
                    ${p.name} ${p.badge} ${statusBadge}
                  </div>
                  <div class="squad-player-pts ${p.pts>0?'pos':p.pts<0?'neg':''}">
                    ${p.played ? showPts(p.pts) : '<span style="color:var(--gray);">-</span>'}
                  </div>
                </div>`;
              }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`;

  el('squad-gw-filter').addEventListener('change', (e) => {
      renderSquads(e.target.value);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCHES
// ─────────────────────────────────────────────────────────────────────────────
function renderMatches() {
  const matches = liveData.matches || [];
  const teams   = liveData.teams || [];

  el('tab-matches').innerHTML = `
    <div class="page-header"><div class="page-title">MATCH RESULTS</div></div>
    ${matches.length === 0 ? `<div class="empty-state"><div class="empty-icon">📋</div><div>No matches yet</div></div>` :
      matches.map((m, mi) => {
        if (!m.confirmed) return '';

        const allStats = m.playerStats || [];
        const scored = allStats.map(s => ({ ...s, total: calcPlayerTotal(s, s.name === m.motm) })).sort((a,b)=>b.total-a.total);
        const top3 = scored.slice(0,3);

        const teamMatchPts = teams.map(t => {
          let pts = 0;
          (t.players||[]).forEach(pName => {
            const stat = allStats.find(s => s.name === pName);
            if (stat) pts += getTeamPlayerPts(stat, t, m.motm, mi);
          });
          return { name: t.name, pts };
        }).sort((a,b)=>b.pts-a.pts);

        return `<div class="match-card">
          <div class="match-card-head">
            <div>
              <div class="match-label">${m.label || `Match ${mi+1}`} ${m.motm ? `<span style="font-size:0.75rem;color:var(--gold);margin-left:6px;">🌟 MOTM: ${m.motm}</span>` : ''}</div>
              <div class="match-meta">${m.teams || ''} ${m.date ? '· '+m.date : ''}</div>
            </div>
            <button class="btn-sm" onclick="showMatchDetail(${mi})">View Details</button>
          </div>
          <div class="match-summary-grid">
            <div>
              <div class="section-label">TOP PERFORMERS</div>
              ${top3.map((p,i) => `
                <div class="top-performer">
                  <span class="top-rank">${['🥇','🥈','🥉'][i]}</span>
                  <span class="top-name">${p.name}</span>
                  <span class="top-pts ${p.total>=0?'pos':'neg'}">${fmtPts(p.total)}</span>
                </div>`).join('')}
            </div>
            <div>
              <div class="section-label">TEAM STANDINGS THIS MATCH</div>
              ${teamMatchPts.slice(0,5).map((t,i) => `
                <div class="top-performer">
                  <span class="top-rank" style="font-size:0.8rem;min-width:20px;">${i+1}</span>
                  <span class="top-name">${t.name}</span>
                  <span class="top-pts ${t.pts>=0?'pos':'neg'}">${showPts(t.pts)}</span>
                </div>`).join('')}
            </div>
          </div>
        </div>`;
      }).join('')}`;

  window.showMatchDetail = (mi) => {
    const m = (liveData.matches||[])[mi];
    if (!m) return;
    const allStats = (m.playerStats||[]).map(s=>({...s,total:calcPlayerTotal(s, s.name===m.motm)})).sort((a,b)=>b.total-a.total);
    modal(
      `${m.label||'Match '+(mi+1)} — Player Points`,
      `<div class="stat-table">
        <div class="stat-header">
          <div>PLAYER</div><div>BAT</div><div>BOWL</div><div>FIELD</div><div>TOTAL</div>
        </div>
        ${allStats.map(p => {
          const bat = calcBattingTotal(p.runs||0,p.balls||0,p.fours||0,p.sixes||0);
          const field = calcFieldingPoints(p.catches||0,p.runouts||0);
          const bowl = calcBowlingTotal(p.topWickets||0,p.lowerWickets||0,p.economy||0,p.oversBowled||0);
          const isMotm = p.name === m.motm;
          return `<div class="stat-row">
            <div>${p.name} ${isMotm ? '🌟' : ''}</div>
            <div class="${bat>=0?'pos':'neg'}">${fmtPts(bat)}</div>
            <div class="${bowl>=0?'pos':'neg'}">${fmtPts(bowl)}</div>
            <div class="${field>=0?'pos':'neg'}">${fmtPts(field)}</div>
            <div class="total-col ${p.total>=0?'pos':'neg'}">${fmtPts(p.total)}</div>
          </div>`;
        }).join('')}
      </div>`
    );
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORM GUIDE (MOMENTUM TRACKER)
// ─────────────────────────────────────────────────────────────────────────────
function renderH2H() {
  const teams = liveData.teams || [];
  const matches = liveData.matches || [];
  const roles = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : [];

  if (matches.length === 0) {
      el('tab-h2h').innerHTML = `<div class="empty-state">Waiting for matches to calculate form...</div>`; 
      return; 
  }

  // 1. SMART GAMEWEEK TRACKER
  const matchGW = [];
  const franchiseMatchCount = {};
  matches.forEach(m => {
    const gwMap = {};
    if (m.confirmed && m.teams) {
      m.teams.split(/vs/i).forEach(t => {
        const team = getTeamCode(t);
        if (!franchiseMatchCount[team]) franchiseMatchCount[team] = 0;
        franchiseMatchCount[team]++;
        gwMap[team] = franchiseMatchCount[team];
      });
    }
    matchGW.push(gwMap);
  });

  // ─── TEAM FORM LOGIC ───────────────────────────────────────────────────────
  const teamForm = teams.map((t, ti) => {
    let totalDisplay = 0;
    const gwPts = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0, 10:0, 11:0, 12:0, 13:0, 14:0, 15:0, 16:0, 17:0 };

    matches.forEach((m, mi) => {
      if (!m.confirmed || !m.playerStats) return;
      (t.players || []).forEach(pName => {
        const stat = m.playerStats.find(s => s.name === pName);
        if (stat) {
          const pts = getTeamPlayerPts(stat, t, m.motm, mi);
          totalDisplay += pts;
          const playerRoleData = roles.find(r => r.name === pName);
          if (playerRoleData && playerRoleData.iplTeam) {
             const gwNumber = matchGW[mi][playerRoleData.iplTeam];
             if (gwNumber && gwNumber <= 17) gwPts[gwNumber] += pts;
          }
        }
      });
    });

    const playedGWs = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17].filter(gw => {
        if (gw >= 15) return gwPts[gw] > 0; 
        return gwPts[gw] >= 150;            
    });

    const gamesPlayed = playedGWs.length;
    const validSeasonTotal = playedGWs.reduce((sum, gw) => sum + gwPts[gw], 0);
    const seasonAvg = gamesPlayed > 0 ? validSeasonTotal / gamesPlayed : 0;

    const last3GWs = playedGWs.slice(-3);
    const last3Pts = last3GWs.map(gw => gwPts[gw]);
    const last3Total = last3Pts.reduce((sum, p) => sum + p, 0);
    const last3Avg = last3GWs.length > 0 ? last3Total / last3GWs.length : 0;

    const diff = last3Avg - seasonAvg;

    let status = '⚖️ STEADY';
    let statusColor = 'var(--gray)';
    if (gamesPlayed < 3) { status = '⏳ WAITING'; statusColor = 'var(--gray)'; }
    else if (diff > 50) { status = '🔥 ON FIRE'; statusColor = '#fbbf24'; }
    else if (diff > 15) { status = '📈 WARMING UP'; statusColor = '#4ade80'; }
    else if (diff < -50) { status = '📉 FREEFALL'; statusColor = '#f87171'; }
    else if (diff < -15) { status = '❄️ COOLING'; statusColor = '#60a5fa'; }

    return { name: t.name, isMe: session.teamIndex === ti, totalDisplay, seasonAvg, last3GWs, last3Pts, last3Avg, diff, status, statusColor, gamesPlayed };
  });

  teamForm.sort((a,b) => b.last3Avg - a.last3Avg);

  const getGWLabel = (gw) => {
      if (gw === 15) return 'Q1/ELI';
      if (gw === 16) return 'Q2';
      if (gw === 17) return 'FINAL';
      return `GW${gw}`;
  };

  // ─── PLAYER FORM LOGIC (THE NEW ENGINE) ────────────────────────────────────
  const playerTracker = {};
  
  // 🚨 1. Determine the "Active GW" (Highest GW played so far)
  let currentGW = 1;
  matchGW.forEach(gwMap => {
      Object.values(gwMap).forEach(gw => {
          if (gw > currentGW) currentGW = gw;
      });
  });
  
  // 🚨 2. Define the Rolling Window (Current GW minus 5 gives us a 6-week window)
  const minActiveGW = Math.max(1, currentGW - 5);
  
  matches.forEach((m, mi) => {
      if (!m.confirmed || !m.playerStats) return;
      m.playerStats.forEach(stat => {
          const pName = stat.name;
          const roleData = roles.find(r => r.name === pName);
          const iplTeam = roleData ? roleData.iplTeam : null;
          const gwNum = iplTeam ? matchGW[mi][iplTeam] : null;

          if (!playerTracker[pName]) {
              playerTracker[pName] = { name: pName, iplTeam: iplTeam || 'NONE', role: roleData?.role || '-', matchData: [] };
          }
          
          const rawPts = calcPlayerTotal(stat, m.motm === pName); 
          
          if (gwNum) {
              playerTracker[pName].matchData.push({ gw: gwNum, pts: rawPts });
          }
      });
  });

  const playerForms = Object.values(playerTracker).map(p => {
      const gamesPlayed = p.matchData.length;
      if (gamesPlayed < 3) return null; // Ignore players without enough data

      // Sort chronological
      p.matchData.sort((a,b) => a.gw - b.gw);

      // 🚨 3. The 6-GW Purge: If their last game was before the window, drop them!
      const lastMatchPlayed = p.matchData[p.matchData.length - 1].gw;
      if (lastMatchPlayed < minActiveGW) return null;

      const seasonTotal = p.matchData.reduce((sum, md) => sum + md.pts, 0);
      const seasonAvg = seasonTotal / gamesPlayed;

      const last3 = p.matchData.slice(-3);
      const last3Total = last3.reduce((sum, md) => sum + md.pts, 0);
      const last3Avg = last3Total / 3;

      const diff = last3Avg - seasonAvg;

      return { ...p, seasonAvg, last3Avg, diff, gamesPlayed, last3 };
  }).filter(x => x !== null);

  // Sort Top 10 (Highest Form Avg) and Bottom 10 (Lowest Form Avg)
  const top10Players = [...playerForms].sort((a,b) => b.last3Avg - a.last3Avg).slice(0, 10);
  const bottom10Players = [...playerForms].sort((a,b) => a.last3Avg - b.last3Avg).slice(0, 10);

  // ─── UI GENERATORS ─────────────────────────────────────────────────────────
  const generatePlayerRows = (players) => {
      if (players.length === 0) return `<tr><td colspan="7" style="padding:2rem; text-align:center; color:var(--gray);">Waiting for 3 matches to be played...</td></tr>`;
      
      return players.map((p, index) => {
          const diffStr = p.diff >= 0 ? `+${showPts(p.diff)}` : `${showPts(p.diff)}`;
          const diffColor = p.diff >= 0 ? '#4ade80' : '#f87171';
          
          const recentScoresHTML = p.last3.map(md => `
            <div style="display:inline-block; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); padding:0.2rem 0.5rem; border-radius:4px; font-family:'Rajdhani'; font-size:0.8rem; margin:0 2px;">
                <span style="color:var(--gray); font-size:0.65rem; margin-right:4px;">${getGWLabel(md.gw)}</span>${showPts(md.pts)}
            </div>
          `).join('');

          return `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:1rem; text-align:center; font-family:'Rajdhani'; font-weight:700; color:var(--gray);">${index + 1}</td>
            <td style="padding:1rem; font-weight:700;">
                ${p.name} <span style="font-size:0.65rem; color:var(--gray); margin-left:4px; font-weight:normal;">${p.role}</span>
            </td>
            <td style="padding:1rem; text-align:center; color:#60a5fa; font-size:0.8rem;">${p.iplTeam}</td>
            <td style="padding:1rem; text-align:center; color:var(--gray); font-family:'Rajdhani';">${showPts(p.seasonAvg)}</td>
            <td style="padding:1rem; text-align:center; color:var(--white); font-family:'Rajdhani'; font-weight:700; font-size:1.1rem;">${showPts(p.last3Avg)}</td>
            <td style="padding:1rem; text-align:center; color:${diffColor}; font-family:'Bebas Neue'; font-size:1.2rem; letter-spacing:1px;">${diffStr}</td>
            <td style="padding:1rem; text-align:center; white-space:nowrap;">${recentScoresHTML}</td>
          </tr>`;
      }).join('');
  };

  const wrapPlayerTable = (rowsHTML) => `
    <div style="background:var(--card); border:1px solid var(--border); border-radius:10px; overflow-x:auto;">
      <table class="table" style="width:100%; text-align:left; border-collapse:collapse; min-width:800px;">
        <thead>
          <tr style="background:rgba(201,168,76,0.05); border-bottom:1px solid var(--border); font-family:'Rajdhani'; font-size:0.75rem; letter-spacing:1px; color:var(--gold);">
            <th style="padding:1rem; text-align:center; width:40px;">#</th>
            <th style="padding:1rem;">PLAYER</th>
            <th style="padding:1rem; text-align:center;">TEAM</th>
            <th style="padding:1rem; text-align:center;">SEASON AVG</th>
            <th style="padding:1rem; text-align:center; color:var(--white);">FORM AVG (LAST 3)</th>
            <th style="padding:1rem; text-align:center;">DIFFERENTIAL</th>
            <th style="padding:1rem; text-align:center;">LAST 3 APPEARANCES</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
  `;

  let teamTableHTML = `
    <div style="background:var(--card); border:1px solid var(--border); border-radius:10px; overflow-x:auto;">
      <table class="table" style="width:100%; text-align:left; border-collapse:collapse; min-width:800px;">
        <thead>
          <tr style="background:rgba(201,168,76,0.05); border-bottom:1px solid var(--border); font-family:'Rajdhani'; font-size:0.75rem; letter-spacing:1px; color:var(--gold);">
            <th style="padding:1rem; text-align:center; width:40px;">#</th>
            <th style="padding:1rem;">FRANCHISE</th>
            <th style="padding:1rem; text-align:center;">MOMENTUM</th>
            <th style="padding:1rem; text-align:center;">SEASON AVG</th>
            <th style="padding:1rem; text-align:center; color:var(--white);">FORM AVG (LAST 3)</th>
            <th style="padding:1rem; text-align:center;">DIFFERENTIAL</th>
            <th style="padding:1rem; text-align:center;">RECENT SCORES</th>
          </tr>
        </thead>
        <tbody>
  `;

  teamForm.forEach((t, index) => {
      const diffStr = t.gamesPlayed < 3 ? '-' : (t.diff >= 0 ? `+${showPts(t.diff)}` : `${showPts(t.diff)}`);
      const diffColor = t.gamesPlayed < 3 ? 'var(--gray)' : (t.diff >= 0 ? '#4ade80' : '#f87171');
      
      const recentScoresHTML = t.last3Pts.map((pts, i) => `
          <div style="display:inline-block; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); padding:0.2rem 0.5rem; border-radius:4px; font-family:'Rajdhani'; font-size:0.8rem; margin:0 2px;">
              <span style="color:var(--gray); font-size:0.65rem; margin-right:4px;">${getGWLabel(t.last3GWs[i])}</span>${showPts(pts)}
          </div>
      `).join('');

      teamTableHTML += `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.04); ${t.isMe ? 'background:rgba(201,168,76,0.05);' : ''}">
          <td style="padding:1rem; text-align:center; font-family:'Rajdhani'; font-weight:700; color:var(--gray);">${index + 1}</td>
          <td style="padding:1rem; font-weight:700;">${t.name} ${t.isMe ? '⭐' : ''}</td>
          <td style="padding:1rem; text-align:center;">
             <span style="background:rgba(0,0,0,0.2); border:1px solid ${t.statusColor}; color:${t.statusColor}; padding:0.3rem 0.6rem; border-radius:20px; font-size:0.75rem; font-family:'Rajdhani'; font-weight:700; letter-spacing:1px; white-space:nowrap;">
                 ${t.status}
             </span>
          </td>
          <td style="padding:1rem; text-align:center; color:var(--gray); font-family:'Rajdhani';">${t.gamesPlayed > 0 ? showPts(t.seasonAvg) : '-'}</td>
          <td style="padding:1rem; text-align:center; color:var(--white); font-family:'Rajdhani'; font-weight:700; font-size:1.1rem;">${t.gamesPlayed > 0 ? showPts(t.last3Avg) : '-'}</td>
          <td style="padding:1rem; text-align:center; color:${diffColor}; font-family:'Bebas Neue'; font-size:1.2rem; letter-spacing:1px;">${diffStr}</td>
          <td style="padding:1rem; text-align:center; white-space:nowrap;">${t.gamesPlayed > 0 ? recentScoresHTML : '<span style="color:var(--gray); font-size:0.8rem;">Waiting for 150 pts...</span>'}</td>
        </tr>
      `;
  });
  teamTableHTML += `</tbody></table></div>`;

  // ─── FINAL HTML ASSEMBLY ───────────────────────────────────────────────────
  el('tab-h2h').innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:10px;">
      <div class="page-title">FORM GUIDE</div>
      <div style="display:flex; gap:10px;">
          <button id="btn-team-form" class="nav-btn active" onclick="switchFormTab('team')">FRANCHISE FORM</button>
          <button id="btn-player-form" class="nav-btn" onclick="switchFormTab('player')">PLAYER FORM</button>
      </div>
    </div>

    <div id="view-team-form" style="display:block;">
        ${teamTableHTML}
    </div>

    <div id="view-player-form" style="display:none;">
        <div class="section-label" style="color:#4ade80; margin-bottom:0.75rem; font-size:1rem;">🔥 TOP 10: BEST RECENT FORM</div>
        ${wrapPlayerTable(generatePlayerRows(top10Players))}
        
        <div class="section-label" style="color:#f87171; margin-top:2.5rem; margin-bottom:0.25rem; font-size:1rem;">🥀 BOTTOM 10: WORST RECENT FORM</div>
        ${wrapPlayerTable(generatePlayerRows(bottom10Players))}
    </div>
  `;

  // Provide global function for toggling views
  window.switchFormTab = (tab) => {
      document.getElementById('view-team-form').style.display = tab === 'team' ? 'block' : 'none';
      document.getElementById('view-player-form').style.display = tab === 'player' ? 'block' : 'none';
      document.getElementById('btn-team-form').className = tab === 'team' ? 'nav-btn active' : 'nav-btn';
      document.getElementById('btn-player-form').className = tab === 'player' ? 'nav-btn active' : 'nav-btn';
  };
}

/// ─────────────────────────────────────────────────────────────────────────────
// LEADERBOARD & SEASON SUPERLATIVES
// ─────────────────────────────────────────────────────────────────────────────
function renderLeaderboard() {
  const matches = liveData.matches || [];
  const roles = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : []; 

  const pTracker = {};
  
  // 1. GATHER ALL STATS FOR THE LEADERBOARD AND AWARDS
  matches.forEach(m => {
    if (!m.confirmed || !m.playerStats) return;
    m.playerStats.forEach(s => {
      if (!pTracker[s.name]) {
          pTracker[s.name] = {
              name: s.name,
              pts: 0,
              motms: 0,
              minusGames: 0,
              blitzkriegGames: 0, 
              testBatsmanGames: 0, 
              topWickets: 0,     
              fiftyPlus: 0, 
              doubleThreats: 0,  
              miserGames: 0,     
              highestGame: -999,
              ducks: 0
          };
      }
      
      const isMotm = (m.motm === s.name);
      const rawPts = calcPlayerTotal(s, false); 
      const totalGamePts = calcPlayerTotal(s, isMotm); 
      
      const batPts = calcBattingTotal(s.runs||0, s.balls||0, s.fours||0, s.sixes||0);
      const bowlPts = calcBowlingTotal(s.topWickets||0, s.lowerWickets||0, s.economy||0, s.oversBowled||0);
      
      pTracker[s.name].pts += rawPts;
      if (isMotm) pTracker[s.name].motms += 1;
      if (totalGamePts < 0) pTracker[s.name].minusGames += 1;
      if (totalGamePts >= 50) pTracker[s.name].fiftyPlus += 1;
      if (totalGamePts > pTracker[s.name].highestGame) pTracker[s.name].highestGame = totalGamePts;
      if ((s.runs === 0 || s.runs === '0') && s.balls > 0) pTracker[s.name].ducks += 1;
      
      pTracker[s.name].topWickets += (s.topWickets || 0);
      if (batPts >= 30 && bowlPts >= 30) pTracker[s.name].doubleThreats += 1;
      if ((s.oversBowled || 0) >= 2 && (s.economy || 0) <= 6.0) pTracker[s.name].miserGames += 1;

      const runs = Number(s.runs) || 0;
      const balls = Number(s.balls) || 0;
      if (balls >= 6) {
          const sr = (runs / balls) * 100;
          if (sr >= 175) pTracker[s.name].blitzkriegGames += 1;
          if (sr <= 100) pTracker[s.name].testBatsmanGames += 1;
      }
    });
  });

  const allPlayers = Object.values(pTracker).map(p => {
     const roleData = roles.find(r => r.name === p.name) || { role: 'AR', uncapped: false };
     return { ...p, role: roleData.role, uncapped: roleData.uncapped };
  });

  const sorted = [...allPlayers].sort((a,b)=>b.pts - a.pts);

  const top10 = (list) => list.slice(0,10).map((p,i) => `
    <div class="top-performer" style="padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
      <span class="top-rank" style="font-size:0.8rem;min-width:20px;color:var(--gray);">${i+1}</span>
      <span class="top-name" style="font-weight:500;">${p.name}</span>
      <span class="top-pts ${p.pts>=0?'pos':'neg'}">${showPts(p.pts)}</span>
    </div>
  `).join('') || '<div class="empty-small">No players assigned to this role yet.</div>';

  // 🚨 REVERTED: Grab strictly the Top 5 players
  const getTop5 = (sortKey, minVal = 1) => {
      const valid = allPlayers.filter(p => p[sortKey] >= minVal);
      if (valid.length === 0) return [];
      valid.sort((a, b) => b[sortKey] - a[sortKey]);
      return valid.slice(0, 5); 
  };

  window._superlativeData = {
      'motms': { icon: '🌟', title: 'THE SHOWSTOPPER', desc: 'Most Man of the Match awards', list: getTop5('motms', 1), unit: 'MOTMs' },
      'highestGame': { icon: '💥', title: 'PEAK PERFORMANCE', desc: 'Highest single-game points total', list: getTop5('highestGame', 30), unit: 'pts' },
      'fiftyPlus': { icon: '📈', title: 'MR. RELIABLE', desc: 'Most matches scoring 50+ fantasy points', list: getTop5('fiftyPlus', 1), unit: 'games' },
      'doubleThreats': { icon: '⚔️', title: 'THE DOUBLE THREAT', desc: 'Most matches with 30+ Batting AND 30+ Bowling pts', list: getTop5('doubleThreats', 1), unit: 'games' },
      'blitzkriegGames': { icon: '⚡', title: 'THE BLITZKRIEG', desc: 'Most innings with a Strike Rate of 175+ (min 6 balls)', list: getTop5('blitzkriegGames', 1), unit: 'games' },
      'testBatsmanGames': { icon: '🐢', title: 'THE TEST BATSMAN', desc: 'Most innings with a Strike Rate under 100 (min 6 balls)', list: getTop5('testBatsmanGames', 1), unit: 'games' },
      'topWickets': { icon: '🎯', title: 'TOP-ORDER TERROR', desc: 'Most top-order wickets taken', list: getTop5('topWickets', 1), unit: 'wkts' },
      'miserGames': { icon: '🔒', title: 'THE MISER', desc: 'Most matches bowling 2+ overs with an Economy ≤ 6.0', list: getTop5('miserGames', 1), unit: 'games' },
      'minusGames': { icon: '🥶', title: 'THE LIABILITY', desc: 'Most games finishing with negative points', list: getTop5('minusGames', 1), unit: 'games' },
      'ducks': { icon: '🦆', title: 'THE DUCK TALE', desc: 'Most ducks (0 runs) scored', list: getTop5('ducks', 1), unit: 'ducks' }
  };

  // 🚨 REVERTED: Clean Modal with Standard Competition Ranking
  window.showSuperlativeModal = (key) => {
      const data = window._superlativeData[key];
      if (!data) return;
      
      let currentRank = 1;
      let previousValue = null;
      
      const rows = data.list.map((p, i) => {
          if (previousValue !== null && p[key] < previousValue) {
              currentRank = i + 1; 
          }
          previousValue = p[key];
          const isFirst = currentRank === 1;

          return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:1rem; border-bottom:1px solid rgba(255,255,255,0.05); ${isFirst ? 'background:rgba(201,168,76,0.1);' : ''}">
              <div style="font-weight:700; font-size:1.1rem; color:${isFirst ? 'var(--gold)' : 'var(--white)'};">
                  <span style="color:var(--gray); margin-right:12px; font-size:0.9rem;">#${currentRank}</span>${p.name}
              </div>
              <div style="font-family:'Bebas Neue'; color:${isFirst ? 'var(--gold)' : 'var(--gray)'}; font-size:1.5rem; letter-spacing:1px;">
                  ${showPts(p[key])} <span style="font-size:0.8rem; font-family:'Rajdhani'; color:var(--gray);">${data.unit}</span>
              </div>
          </div>
          `;
      }).join('');

      modal(`${data.icon} ${data.title}`, 
          `<div style="font-size:0.9rem; color:var(--gray); margin-bottom:1rem;">${data.desc} - <span style="color:var(--gold);">Top 5 Leaderboard</span></div>
           <div style="background:var(--card); border:1px solid var(--border); border-radius:8px; overflow:hidden;">
              ${rows || '<div class="empty-small" style="padding:2rem;">No data yet.</div>'}
           </div>`, 
          `<button class="btn-primary" style="width:100%;" onclick="closeModal()">CLOSE</button>`
      );
  };

  const renderAward = (key) => {
      const data = window._superlativeData[key];
      const winner = data.list[0]; 
      
      return `
      <div onclick="showSuperlativeModal('${key}')" 
           style="flex: 1 1 280px; max-width: 450px; background:var(--navy3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:1.2rem; display:flex; align-items:center; gap:1rem; cursor:pointer; transition:all 0.2s; box-shadow:0 4px 6px rgba(0,0,0,0.2);" 
           onmouseover="this.style.borderColor='var(--gold)'; this.style.transform='translateY(-3px)';" 
           onmouseout="this.style.borderColor='rgba(255,255,255,0.05)'; this.style.transform='translateY(0)';">
           
         <div style="font-size:2.8rem; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));">${data.icon}</div>
         <div style="flex:1;">
             <div style="font-family:'Bebas Neue'; color:var(--gold); font-size:1.3rem; letter-spacing:1px; margin-bottom:0.25rem;">${data.title}</div>
             ${winner ? `
             <div style="font-weight:700; color:var(--white); font-size:1.1rem; display:flex; align-items:center; justify-content:space-between;">
                 <span>${winner.name}</span>
                 <span style="color:var(--gold); font-size:1rem; font-family:'Bebas Neue'; letter-spacing:1px;">${showPts(winner[key])} <span style="font-size:0.75rem; font-family:'Rajdhani'; color:var(--gray);">${data.unit}</span></span>
             </div>` : `<div style="font-weight:700; color:var(--gray); font-style:italic;">No one yet</div>`}
         </div>
      </div>`;
  };

  // 4. RENDER UI
  el('tab-leaderboard').innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:1.5rem;">
      <div class="page-title">GLOBAL LEADERBOARD</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn-primary" style="background:var(--navy3); color:var(--gold); border:1px solid var(--gold);" onclick="showMoneyballMatrix()">⚾ VIEW MONEYBALL MATRIX</button>
        <button class="btn-primary" onclick="showDreamTeamModal()"><span style="filter: drop-shadow(0px 0px 3px rgba(0,0,0,0.8));">🌟</span> View Dream Team</button>
      </div>
    </div>

    <div class="section-label" style="display:flex; justify-content:space-between; margin-bottom:0.75rem; font-size:1rem;">
       <span>🏆 SEASON SUPERLATIVES</span>
       <span style="font-size:0.7rem; color:var(--gray);">Click any card to view the Top 5</span>
    </div>
    
    <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:1rem; margin-bottom:2.5rem;">
        ${renderAward('motms')}
        ${renderAward('highestGame')}
        ${renderAward('fiftyPlus')}
        ${renderAward('doubleThreats')}
        ${renderAward('blitzkriegGames')}
        ${renderAward('testBatsmanGames')}
        ${renderAward('topWickets')}
        ${renderAward('miserGames')}
        ${renderAward('minusGames')}
        ${renderAward('ducks')}
    </div>

    <div class="squads-grid">
      <div class="squad-card">
        <div class="squad-head"><div class="squad-team-name">🏆 OVERALL MVP</div></div>
        <div class="squad-body">${top10(sorted)}</div>
      </div>
      <div class="squad-card">
        <div class="squad-head"><div class="squad-team-name">🏏 TOP BATTERS</div></div>
        <div class="squad-body">${top10(sorted.filter(p=>p.role==='BAT'))}</div>
      </div>
      <div class="squad-card">
        <div class="squad-head"><div class="squad-team-name">⚾ TOP BOWLERS</div></div>
        <div class="squad-body">${top10(sorted.filter(p=>p.role==='BOWL'))}</div>
      </div>
      <div class="squad-card">
        <div class="squad-head"><div class="squad-team-name">⚔️ TOP ALLROUNDERS</div></div>
        <div class="squad-body">${top10(sorted.filter(p=>p.role==='AR'))}</div>
      </div>
      <div class="squad-card">
        <div class="squad-head"><div class="squad-team-name">🧤 TOP WICKETKEEPERS</div></div>
        <div class="squad-body">${top10(sorted.filter(p=>p.role==='WK'))}</div>
      </div>
      <div class="squad-card">
        <div class="squad-head"><div class="squad-team-name">🌟 TOP UNCAPPED</div></div>
        <div class="squad-body">${top10(sorted.filter(p=>p.uncapped))}</div>
      </div>
    </div>
  `;
}


// ─────────────────────────────────────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────────────────────────────────────

window.setupLeaguesStructure = async function() {
    try {
    // Get all current data
    const snapshot = await get(ref(db, '/'));
    const allData = snapshot.val();
    
    // Create 2026 with all current data
    await set(ref(db, 'leagues/2026'), allData);
    console.log('Created leagues/2026');
    
    // Create 2027 with all current data
    await set(ref(db, 'leagues/2027'), allData);
    console.log('Created leagues/2027');
    
    alert('Leagues structure created! Now delete the old root data (draftPrices, matches, playerRoles, teams)');
  } catch(e) {
    console.error('Error:', e);
  }
}

function renderAdmin() {
  const teams   = liveData.teams   || [];
  const matches = liveData.matches || [];
  
  let rolesText = '';
  if (Array.isArray(liveData.playerRoles)) {
      rolesText = liveData.playerRoles.map(p => `${p.iplTeam || 'NONE'}\t${p.name}\t${p.role}\t${p.uncapped?'Uncapped':'Capped'}`).join('\n');
  }

  el('tab-admin').innerHTML = `
    <div class="page-header"><div class="page-title">ADMIN PANEL</div></div>

    <div class="admin-section">
      <div class="admin-section-title" style="color:#4ade80;">📡 LIVE PRESENCE RADAR</div>
      <div style="background:var(--navy3); border:1px solid var(--border); border-radius:8px; padding:1rem;">
         ${(() => {
             const presence = liveData.presence || {};
             const onlineUsers = Object.keys(presence).filter(user => presence[user].online);
             
             if (onlineUsers.length === 0) return '<div class="empty-small">Nobody else is online right now.</div>';
             
             return onlineUsers.map(u => {
                 const cred = CREDENTIALS[u];
                 const teamName = cred && cred.teamIndex >= 0 ? (teams[cred.teamIndex]?.name || 'Unknown Team') : 'Admin';
                 return `
                 <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex; align-items:center; gap:10px;">
                      <div style="width:8px; height:8px; background:#4ade80; border-radius:50%; box-shadow:0 0 8px #4ade80;"></div>
                      <strong style="color:var(--white); text-transform:uppercase;">${u}</strong>
                      <span style="color:var(--gray); font-size:0.8rem;">(${teamName})</span>
                    </div>
                    <div style="font-size:0.75rem; color:#4ade80; background:rgba(74,222,128,0.1); padding:0.2rem 0.6rem; border-radius:4px;">Active Now</div>
                 </div>`;
             }).join('');
         })()}
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">COMMISSIONER TOOLS</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn-sm" style="border-color:var(--gold); color:var(--gold); display:flex; align-items:center; gap:6px;" onclick="showMoneyballMatrix()">
              ⚾ VIEW MONEYBALL MATRIX
          </button>
          <button class="btn-sm" style="border-color:var(--gray); color:var(--gray); display:flex; align-items:center; gap:6px;" onclick="editDraftPrices()">
              💰 EDIT DRAFT PRICES

          </button>
      </div>
    </div>

    <div class="admin-section">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
          <div class="admin-section-title" style="margin-bottom:0;">TEAM SQUADS</div>
          <button class="btn-sm" style="border-color:var(--gold); color:var(--gold);" onclick="showAllTeamsXIIModal()">🔍 VIEW ALL PLAYING XIIs</button>
      </div>
      <div class="admin-teams-grid">
        ${teams.length === 0 ? '<div class="empty-small">No teams yet. Use "Initialise Teams" below.</div>' :
          teams.map((t,ti) => `
            <div class="admin-team-card">
              <div class="admin-team-head">
                <div class="admin-team-name">${t.name}</div>
                <div style="display:flex; gap:0.4rem;">
                  <button class="btn-sm" onclick="renameTeam(${ti})">Rename</button>
                  <button class="btn-sm" onclick="editTeamSquad(${ti})">Edit Squad</button>
                </div>
              </div>
              <div style="font-size:0.8rem;color:var(--gray);">${(t.players||[]).length} players</div>
              <div style="font-size:0.75rem;color:var(--gray);margin-top:0.25rem;">C: ${t.captain||'None'} | VC: ${t.viceCaptain||'None'}</div>
            </div>`).join('')}
      </div>
      ${teams.length === 0 ? `
        <div style="margin-top:1rem;">
          <div class="section-label" style="margin-bottom:0.5rem;">INITIALISE 9 TEAMS</div>
          ${[1,2,3,4,5,6,7,8,9].map(i=>`
            <div style="display:flex;gap:0.5rem;margin-bottom:0.4rem;align-items:center;">
              <label style="font-size:0.8rem;color:var(--gray);width:60px;">Team ${i}</label>
              <input type="text" id="init-team-${i}" placeholder="Team name" class="admin-input" style="flex:1;">
            </div>`).join('')}
          <button class="btn-primary" style="margin-top:0.75rem;" onclick="initTeams()">CREATE TEAMS</button>
        </div>` : ''}
    </div>

    <div class="admin-section">
      <div class="admin-section-title">MANAGE LEADERBOARD ROLES</div>
      <div style="font-size:0.8rem;color:var(--gold);margin-bottom:0.75rem;line-height:1.4;">
        <b>💡 Excel Paste Supported!</b> Copy columns directly from your spreadsheet (Player, Points, Role, Status) and paste them below. The system will auto-format them.<br>
        <i>Manual Format: Name, Role (BAT/BOWL/AR/WK), Uncapped (Y/N)</i>
      </div>
      <textarea id="roles-input" style="width:100%;height:150px;background:var(--navy3);border:1px solid var(--border);border-radius:6px;color:var(--white);font-family:'DM Sans',sans-serif;font-size:0.9rem;padding:0.75rem;outline:none;resize:vertical;">${rolesText}</textarea>
      <button class="btn-primary" style="margin-top:0.75rem;" onclick="saveRoles()">SAVE ROLES</button>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">MATCH MANAGEMENT</div>
      
      <!-- MOVED TO TOP: Match Creation Tools -->
      <div class="admin-pull-box" style="margin-bottom:1rem;">
        <div class="section-label" style="margin-bottom:0.75rem;">PULL SCORECARD FROM CRICAPI</div>
        <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;">
          <input type="text" id="match-label-input" placeholder="Match label (e.g. MI vs CSK)" class="admin-input" style="flex:2;">
          <input type="text" id="match-date-input" placeholder="Date (e.g. 22 Mar)" class="admin-input" style="flex:1;">
        </div>
        <div style="display:flex;gap:0.5rem;">
          <input type="text" id="cricapi-match-id" placeholder="CricAPI Match ID" class="admin-input" style="flex:1;">
          <button class="btn-primary" onclick="pullScorecard()">PULL SCORECARD</button>
        </div>
      </div>
      <div class="admin-pull-box" style="margin-bottom:1.5rem;">
        <button class="btn-primary" style="width:100%;" onclick="addManualMatch()">+ ADD BLANK MATCH</button>
      </div>

      <!-- ADDED SCROLLBOX: Existing Match List -->
      <div class="section-label" style="margin-bottom:0.75rem;">EXISTING MATCHES (${matches.length})</div>
      <div style="max-height: 400px; overflow-y: auto; padding-right: 8px; border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; background: rgba(0,0,0,0.1);">
        ${matches.length === 0 ? '<div class="empty-small" style="padding:1rem; text-align:center;">No matches added yet.</div>' : ''}
        ${matches.map((m,mi) => `
          <div class="match-admin-row" style="padding: 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.04);">
            <div>
              <div style="font-weight:600;">${m.label||'Match '+(mi+1)}</div>
              <div style="font-size:0.75rem;color:var(--gray);">${m.teams||''} ${m.date?'· '+m.date:''}</div>
            </div>
            <div style="display:flex;gap:0.5rem;align-items:center;">
              <span class="status-badge ${m.confirmed?'confirmed':'pending'}">${m.confirmed?'✅ Confirmed':'⏳ Pending'}</span>
              
              <button class="btn-sm" style="padding:0.2rem 0.5rem;" onclick="moveMatch(${mi}, -1)" ${mi === 0 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>↑</button>
              <button class="btn-sm" style="padding:0.2rem 0.5rem;" onclick="moveMatch(${mi}, 1)" ${mi === matches.length - 1 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>↓</button>
              
              <button class="btn-sm" onclick="reviewMatch(${mi})">${!m.confirmed ? 'Review & Confirm' : 'View'}</button>
              <button class="btn-sm btn-danger" onclick="deleteMatch(${mi})">Delete</button>
            </div>
          </div>`).join('')}
      </div>
    </div>



    <div style="margin-top:2rem; padding:1.5rem; background:var(--navy3); border:1px solid #f87171; border-radius:8px;">
      <div style="color:#f87171; font-family:'Bebas Neue'; font-size:1.5rem; margin-bottom:0.5rem;">🚨 EMERGENCY FALLBACK: RAPID-API</div>
      <div style="font-size:0.8rem; color:var(--gray); margin-bottom:1rem;">If CricAPI is delayed, paste RapidAPI JSON here to force update a match.</div>
      
      <select id="rapid-api-match-select" style="width:100%; margin-bottom:1rem; padding:0.5rem; background:var(--card); color:white; border:1px solid var(--border);">
         ${(liveData.matches || []).map((m, i) => `<option value="${i}">Match ${i + 1}: ${m.teams || 'TBA'}</option>`).join('')}
      </select>
      
      <textarea id="rapid-api-input" rows="6" placeholder="Paste the raw { ... } JSON from RapidAPI here..." style="width:100%; margin-bottom:1rem; padding:0.5rem; background:var(--card); color:white; border:1px solid var(--border); font-family:monospace;"></textarea>
      
      <button class="btn-primary" style="background:#f87171; border-color:#f87171; width:100%;" onclick="importRapidApiMatch()">FORCE UPDATE MATCH</button>
    </div>
    
    <div class="admin-section">
      <div class="admin-section-title">DANGER ZONE</div>
      <button class="btn-danger-full" onclick="resetAll()">🗑 RESET ALL DATA</button>
    </div>`;

  // --- NEW RENAME LOGIC ---
  window.renameTeam = (ti) => {
    const t = (liveData.teams||[])[ti];
    modal(
      `Rename Team`,
      `<div style="font-size:0.85rem;color:var(--gray);margin-bottom:0.75rem;">Enter the owner's name or new team name below.</div>
       <input type="text" id="rename-input" style="width:100%;background:var(--navy3);border:1px solid var(--border);border-radius:6px;color:var(--white);font-family:'DM Sans',sans-serif;font-size:1rem;padding:0.75rem;outline:none;" value="${t.name}">`,
      `<button class="btn-primary" style="width:100%;" onclick="saveTeamName(${ti})">SAVE NAME</button>`
    );
  };

  window.saveTeamName = async (ti) => {
    const newName = el('rename-input').value.trim();
    if (!newName) { toast('Name cannot be empty', 'error'); return; }
    
    const updatedTeams = JSON.parse(JSON.stringify(liveData.teams||[]));
    updatedTeams[ti].name = newName;
    await set(ref(db, `leagues/${window.selectedYear}/teams`), updatedTeams);
    closeModal(); 
    toast('Team renamed!', 'success');
  };

window.editTeamSquad = (ti) => {
    const t = (liveData.teams||[])[ti];
    const rules = t.rosterRules || {};
    const players = (t.players||[]).map(p => {
        let n = p;
        if(p===t.captain) n += ' (C)';
        if(p===t.viceCaptain) n += ' (VC)';
        if(p===t.replacement) n += ' (R)';
        
        // Re-attach the Time Tags for the Admin to see
        if(rules[p]) {
            if(rules[p].in) n += ` [IN:${rules[p].in}]`;
            if(rules[p].out) n += ` [OUT:${rules[p].out}]`;
        }
        return n;
    }).join('\n');

    modal(
      `Edit Squad — ${t.name}`,
      `<div style="font-size:0.85rem;color:var(--gray);margin-bottom:0.75rem;">One player per line. Add <b>(C)</b>, <b>(VC)</b>, and <b>(R)</b>. <br><span style="color:var(--gold);">For injury replacements/trades, use <b>[IN:GW]</b> and <b>[OUT:GW]</b> tags! (e.g. <i>[IN:4]</i>)</span></div>
       <textarea id="squad-input" style="width:100%;height:280px;background:var(--navy3);border:1px solid var(--border);border-radius:6px;color:var(--white);font-family:'DM Sans',sans-serif;font-size:0.9rem;padding:0.75rem;outline:none;resize:vertical;">${players}</textarea>`,
      `<button class="btn-primary" style="width:100%;" onclick="saveSquad(${ti})">SAVE SQUAD</button>`
    );
  };

  window.saveSquad = async (ti) => {
    const raw = el('squad-input').value;
    const players = [];
    const rosterRules = {}; // NEW: Store the transfer tags
    let cap = null, vc = null, rep = null;

    raw.split('\n').forEach(line => {
       let p = line.trim();
       if(!p) return;

       // Parse [IN:X] and [OUT:X] tags silently
       const inMatch = p.match(/\[IN:(\d+)\]/i);
       const outMatch = p.match(/\[OUT:(\d+)\]/i);

       if (inMatch || outMatch) {
           const rule = {};
           if (inMatch) { rule.in = parseInt(inMatch[1]); p = p.replace(inMatch[0], ''); }
           if (outMatch) { rule.out = parseInt(outMatch[1]); p = p.replace(outMatch[0], ''); }
           p = p.trim(); // Clean up trailing spaces
           rosterRules[p] = rule;
       }

       if(p.toUpperCase().includes('(C)')) { p = p.replace(/\(C\)/i, '').trim(); cap = p; }
       else if(p.toUpperCase().includes('(VC)')) { p = p.replace(/\(VC\)/i, '').trim(); vc = p; }
       else if(p.toUpperCase().includes('(R)')) { p = p.replace(/\(R\)/i, '').trim(); rep = p; }
       
       players.push(p);
    });

    const updatedTeams = JSON.parse(JSON.stringify(liveData.teams||[]));
    updatedTeams[ti].players = players;
    updatedTeams[ti].captain = cap;
    updatedTeams[ti].viceCaptain = vc;
    updatedTeams[ti].replacement = rep;
    updatedTeams[ti].rosterRules = rosterRules; // Save the rules to the database!
    
    await set(ref(db, `leagues/${window.selectedYear}/teams`), updatedTeams);
    closeModal(); toast('Squad saved!', 'success');
  };

// --- ROLES LOGIC (THE OMNI-PARSER) ---
  window.saveRoles = async () => {
    const raw = el('roles-input').value;
    const rolesArr = []; 
    // This regex hunts for any team abbreviation or full name
    const iplTeamsRegex = /\b(CSK|CHENNAI|DC|DELHI|GT|GUJARAT|KKR|KOLKATA|LSG|LUCKNOW|MI|MUMBAI|PBKS|PUNJAB|KINGS|RCB|ROYAL|BANGALORE|RR|RAJASTHAN|SRH|SUNRISERS|HYDERABAD)\b/i;

    raw.split('\n').forEach(line => {
      if (!line.trim()) return;
      const lowerLine = line.toLowerCase().trim();
      if (lowerLine.startsWith('team') || lowerLine.startsWith('player')) return; 

      let finalRole = 'AR';      
      let finalUncapped = false; 
      let finalIPLTeam = 'NONE'; // Defaults to NONE if you forget to add a team

      const upperLine = line.toUpperCase();

      // 1. Hunt for Role anywhere
      if (upperLine.match(/\b(WK|WICKETKEEPER|KEEP|KEEPER)\b/)) finalRole = 'WK';
      else if (upperLine.match(/\b(BAT|BATTER|BATSMAN)\b/)) finalRole = 'BAT';
      else if (upperLine.match(/\b(BOWL|BOWLER)\b/)) finalRole = 'BOWL';

      // 2. Hunt for Status anywhere
      if (upperLine.match(/\b(UNCAPPED)\b/)) finalUncapped = true;

      // 3. Hunt for Team anywhere
      const teamMatch = upperLine.match(iplTeamsRegex);
      if (teamMatch) finalIPLTeam = getTeamCode(teamMatch[1]);

      // 4. Extract Name by scrubbing everything else away
      const exclusionRegex = /\b(CSK|CHENNAI|DC|DELHI|GT|GUJARAT|KKR|KOLKATA|LSG|LUCKNOW|MI|MUMBAI|PBKS|PUNJAB|KINGS|RCB|ROYAL|BANGALORE|RR|RAJASTHAN|SRH|SUNRISERS|HYDERABAD|WK|WICKETKEEPER|KEEP|KEEPER|BAT|BATTER|BATSMAN|BOWL|BOWLER|AR|ALLROUNDER|UNCAPPED|CAPPED)\b/ig;
      let nameStr = line.replace(exclusionRegex, '');
      
      // Strip leftover numbers, commas, and emojis
      // Added the airplane symbol (✈︎ and ✈) to the allowed characters list
      let name = nameStr.replace(/[^a-zA-Z\s.\-'\u2708\uFE0E\uFE0F]/g, '').replace(/\s+/g, ' ').trim();
      if (name) {
        rolesArr.push({ name: name, role: finalRole, uncapped: finalUncapped, iplTeam: finalIPLTeam });
      }
    });

    await set(ref(db, `leagues/${window.selectedYear}/playerRoles`), rolesArr);
    toast('Leaderboard Roles & Teams saved!', 'success');
  };

  // --- MATCH & INIT LOGIC ---
  window.initTeams = async () => {
    const teams = [];
    for (let i=1;i<=9;i++) {
      const name = el(`init-team-${i}`)?.value?.trim() || `Team ${i}`;
      teams.push({ name, players: [], captain: null, viceCaptain: null });
    }
    await set(ref(db, `leagues/${window.selectedYear}/teams`), teams);
    toast('Teams created!', 'success');
  };

  window.pullScorecard = async () => {
    const matchId = el('cricapi-match-id')?.value?.trim();
    const label   = el('match-label-input')?.value?.trim();
    const date    = el('match-date-input')?.value?.trim();
    
    if (!matchId) { toast('Enter a CricAPI match ID', 'error'); return; }
    
    toast('Pulling scorecard...', 'info');
    
    try {
      const resp = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${CRICAPI_KEY}&id=${matchId}`);
      const data = await resp.json();

      if (!data || data.status !== 'success') { 
          const actualErrorMessage = data?.reason || data?.message || 'Unknown error';
          
          // 🚨 NEW: Smart error catching for delayed scorecards
          if (actualErrorMessage.toLowerCase().includes("not found")) {
              toast('CricAPI Delay: Match exists, but scorecard is not ready yet. Use RapidAPI fallback or try again later.', 'error');
          } else {
              toast('CricAPI error: ' + actualErrorMessage, 'error'); 
          }
          return; 
      }
      
      const parsed = parseCricAPIScorecard(data.data, label, date);
      openScorecardReview(parsed);
      
    } catch(e) {
      toast('Failed to fetch: ' + e.message, 'error');
    }
  };

  window.addManualMatch = () => {
    const label = el('match-label-input')?.value?.trim() || `Match ${((liveData.matches||[]).length)+1}`;
    const date  = el('match-date-input')?.value?.trim() || '';
    openScorecardReview({ label, date, teams: label, playerStats: [], motm: '' });
  };

// --- NEW: Match Reordering Logic ---
  window.moveMatch = async (index, direction) => {
    // Make a copy of the current matches array
    const updatedMatches = [...(liveData.matches || [])];
    
    // Safety check: ensure we don't move outside the array bounds
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= updatedMatches.length) return;

    // Swap the matches
    const temp = updatedMatches[index];
    updatedMatches[index] = updatedMatches[targetIndex];
    updatedMatches[targetIndex] = temp;

    // Save the newly ordered array to Firebase
    await set(ref(db, `leagues/${window.selectedYear}/matches`), updatedMatches);
    toast('Match order updated!', 'success');
  };


  window.deleteMatch = async (mi) => {
    if (!confirm('Delete this match? This cannot be undone.')) return;
    const updated = [...(liveData.matches||[])];
    updated.splice(mi,1);
    await set(ref(db, `leagues/${window.selectedYear}/matches`), updated);
    toast('Match deleted');
    renderAdmin();
  };

  window.resetAll = async () => {
    if (!confirm('RESET ALL DATA? This will delete all teams, squads, matches and roles. Cannot be undone.')) return;
    await set(ref(db, `leagues/${window.selectedYear}`), null);
    toast('All data reset.', 'info');
  };

  window.reviewMatch = (mi) => {
    const m = (liveData.matches||[])[mi];
    openScorecardReview({ ...m, editIndex: mi });
  };
}

// ── SCORECARD REVIEW MODAL ────────────────────────────────────────────────────
function parseCricAPIScorecard(data, label, date) {
  const players = [];

  function getPlayer(name) {
    if (!name) return null;
    let p = players.find(x => x.name === name);
    if (!p) { 
      p = {name, runs:0, balls:0, fours:0, sixes:0, catches:0, runouts:0, topWickets:0, lowerWickets:0, economy:0, oversBowled:0}; 
      players.push(p); 
    }
    return p;
  }

  // Helper to clean up names from brackets or "sub" tags
  const cleanFielder = (name) => name.replace(/\bsub(?:stitute)?\b/ig, '').replace(/[()]/g, '').trim();

  try {
    (data.scorecard || []).forEach(innings => {
      
      // 1. Parse Bowling FIRST 
      (innings.bowling || []).forEach(b => {
        const bowlName = b.bowler?.name || b.name;
        if (bowlName) {
          let p = getPlayer(bowlName);
          p.oversBowled = parseFloat(b.o || b.overs || 0);
          p.economy     = parseFloat(b.eco || b.economy || 0);
          p.topWickets  = parseInt(b.w || b.wickets || 0); 
        }
      });

      // 2. Parse Batting & Lower Order Wickets & MISSING FIELDING
      (innings.batting || []).forEach((b, index) => {
        const batName = b.batsman?.name || b.name;
        if (batName) {
          let p = getPlayer(batName);
          p.runs  = parseInt(b.r || b.runs || 0);
          p.balls = parseInt(b.b || b.balls || 0);
          p.fours = parseInt(b['4s'] || b.fours || 0);
          p.sixes = parseInt(b['6s'] || b.sixes || 0);
        }

        const outText = b['dismissal-text'] || b.dismissal || "";
        
        // 🚨 NEW: Regex Fallback for "Caught & Bowled" and "Stumpings"
        if (outText) {
            // Caught and Bowled: "c & b BowlerName"
            const cbMatch = outText.match(/^c\s*(?:&|and)\s*b\s+(.+)/i);
            if (cbMatch) {
                getPlayer(cleanFielder(cbMatch[1])).catches += 1;
            }
            
            // Stumpings: "st KeeperName b BowlerName"
            const stumpMatch = outText.match(/^st\s+(.+?)\s+b\s+/i);
            if (stumpMatch) {
                getPlayer(cleanFielder(stumpMatch[1])).runouts += 1; // Equating stumpings to runout points
            }
        }

        const isLowerOrder = index >= 7;
        let bowlerName = b.bowler?.name || (typeof b.bowler === 'string' ? b.bowler : null);
        
        if (!bowlerName && outText) {
           const text = outText.toLowerCase();
           if (text.includes(' b ')) {
               const parts = text.split(' b ');
               bowlerName = parts[parts.length - 1].trim(); 
           }
        }

        if (bowlerName && isLowerOrder) {
            let bowler = players.find(x => 
                x.name.toLowerCase() === bowlerName.toLowerCase() || 
                x.name.toLowerCase().includes(bowlerName.toLowerCase()) || 
                bowlerName.toLowerCase().includes(x.name.toLowerCase())
            );
            
            if (bowler) {
                bowler.lowerWickets += 1;
                bowler.topWickets = Math.max(0, bowler.topWickets - 1);
            }
        }
      });

      // 3. Parse Catching Array (Standard Catches & Runouts)
      (innings.catching || []).forEach(c => {
         const cName = c.catcher?.name || c.name;
         if (cName) {
           let p = getPlayer(cName);
           p.catches += parseInt(c.catch || c.catches || 0);
           p.runouts += parseInt(c.runout || c.runouts || c.ro || 0);
         }
      });

    });
  } catch(e) { console.warn('Parse error', e); }

  return { label: label || data.name || 'Match', date: date || data.date || '', teams: data.teams?.join(' vs ') || '', playerStats: players, motm: '' };
}

function openScorecardReview(matchData) {
  const stats = matchData.playerStats || [];
  const isEdit = matchData.editIndex !== undefined;

  const rows = stats.map((p,pi) => `
    <tr class="stat-edit-row">
      <td><input type="text" class="inline-input name-inp" value="${p.name}" data-pi="${pi}" data-field="name"></td>
      <td><input type="number" class="inline-input" value="${p.runs||0}" data-pi="${pi}" data-field="runs" min="0"></td>
      <td><input type="number" class="inline-input" value="${p.balls||0}" data-pi="${pi}" data-field="balls" min="0"></td>
      <td><input type="number" class="inline-input" value="${p.fours||0}" data-pi="${pi}" data-field="fours" min="0"></td>
      <td><input type="number" class="inline-input" value="${p.sixes||0}" data-pi="${pi}" data-field="sixes" min="0"></td>
      <td><input type="number" class="inline-input" value="${p.catches||0}" data-pi="${pi}" data-field="catches" min="0"></td>
      <td><input type="number" class="inline-input" value="${p.runouts||0}" data-pi="${pi}" data-field="runouts" min="0"></td>
      <td><input type="number" class="inline-input" value="${p.topWickets||0}" data-pi="${pi}" data-field="topWickets" min="0"></td>
      <td><input type="number" class="inline-input" value="${p.lowerWickets||0}" data-pi="${pi}" data-field="lowerWickets" min="0"></td>
      <td><input type="number" class="inline-input" value="${p.oversBowled||0}" data-pi="${pi}" data-field="oversBowled" step="0.1" min="0"></td>
      <td><input type="number" class="inline-input" value="${p.economy||0}" data-pi="${pi}" data-field="economy" step="0.01" min="0"></td>
      <td class="pts-preview" id="pts-preview-${pi}">${fmtPts(calcPlayerTotal(p, p.name === matchData.motm))}</td>
      <td><button class="btn-sm btn-danger" onclick="removeReviewRow(${pi})" style="padding:0.2rem 0.5rem;">✕</button></td>
    </tr>`).join('');

  modal(
    `Review Scorecard — ${matchData.label}`,
    `<div style="overflow-x:auto;">
      <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
        <input type="text" id="rev-label" value="${matchData.label}" class="admin-input" placeholder="Match label" style="flex:2;">
        <input type="text" id="rev-teams" value="${matchData.teams||''}" class="admin-input" placeholder="e.g. MI vs CSK" style="flex:2;">
        <input type="text" id="rev-date"  value="${matchData.date||''}"  class="admin-input" placeholder="Date" style="flex:1;">
        <input type="text" id="rev-motm"  value="${matchData.motm||''}"  class="admin-input" placeholder="🌟 MOTM Name" style="flex:1.5; border-color:var(--gold);">
      </div>
      <table class="review-table" id="review-table">
        <thead>
          <tr>
            <th>Player</th><th>R</th><th>B</th><th>4s</th><th>6s</th>
            <th>Ct</th><th>RO</th><th>W(T)</th><th>W(L)</th><th>Ovs</th><th>Eco</th><th>PTS</th><th></th>
          </tr>
        </thead>
        <tbody id="review-tbody">${rows}</tbody>
      </table>
      <button class="btn-sm" style="margin-top:0.75rem;" onclick="addReviewRow()">+ Add Player</button>
    </div>`,
    `<div style="display:flex;gap:0.75rem;">
      <button class="btn-primary" style="flex:1;" onclick="confirmMatch(${isEdit ? matchData.editIndex : -1})">
        ${isEdit && (liveData.matches||[])[matchData.editIndex]?.confirmed ? '✅ UPDATE CONFIRMED MATCH' : '✅ CONFIRM & SAVE'}
      </button>
      <button class="nav-btn" style="flex:0;" onclick="closeModal()">Cancel</button>
    </div>`
  );

  window._reviewDraft = { ...matchData, playerStats: JSON.parse(JSON.stringify(stats)) };

  // Live points preview on input change
  el('modal-body').addEventListener('input', e => {
    const inp = e.target;
    
    // Live update for MOTM typing
    if (inp.id === 'rev-motm') {
        window._reviewDraft.motm = inp.value.trim();
        window._reviewDraft.playerStats.forEach((p, pi) => {
            const ptsEl = el(`pts-preview-${pi}`);
            if (ptsEl) {
                const pts = calcPlayerTotal(p, p.name === window._reviewDraft.motm);
                ptsEl.textContent = fmtPts(pts);
                ptsEl.className = `pts-preview ${pts>=0?'pos':'neg'}`;
            }
        });
        return;
    }

    if (!inp.dataset.pi) return;
    const pi = parseInt(inp.dataset.pi);
    const field = inp.dataset.field;
    const val = field === 'name' ? inp.value : parseFloat(inp.value)||0;
    window._reviewDraft.playerStats[pi][field] = val;
    const ptsEl = el(`pts-preview-${pi}`);
    if (ptsEl) {
      const pts = calcPlayerTotal(window._reviewDraft.playerStats[pi], window._reviewDraft.playerStats[pi].name === window._reviewDraft.motm);
      ptsEl.textContent = fmtPts(pts);
      ptsEl.className = `pts-preview ${pts>=0?'pos':'neg'}`;
    }
  });

  window.addReviewRow = () => {
    const newP = {name:'New Player',runs:0,balls:0,fours:0,sixes:0,catches:0,runouts:0,topWickets:0,lowerWickets:0,economy:0,oversBowled:0};
    window._reviewDraft.playerStats.push(newP);
    openScorecardReview(window._reviewDraft);
  };

  window.removeReviewRow = (pi) => {
    window._reviewDraft.playerStats.splice(pi,1);
    openScorecardReview(window._reviewDraft);
  };

  window.confirmMatch = async (editIdx) => {
    const draft = window._reviewDraft;
    draft.label  = el('rev-label')?.value?.trim() || draft.label;
    draft.teams  = el('rev-teams')?.value?.trim() || '';
    draft.date   = el('rev-date')?.value?.trim()  || '';
    draft.motm   = el('rev-motm')?.value?.trim()  || '';
    draft.confirmed = true;

    const updated = JSON.parse(JSON.stringify(liveData.matches||[]));
    if (editIdx >= 0) updated[editIdx] = draft;
    else updated.push(draft);
    
    await set(ref(db, `leagues/${window.selectedYear}/matches`), updated);
    closeModal();
    toast('Match confirmed & saved!', 'success');
    renderAdmin();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM OF THE WEEK / OVERALL SEASON MODAL (OPTIMIZER)
// ─────────────────────────────────────────────────────────────────────────────
window.showDreamTeamModal = (selectedGW = 'ALL') => {
  const matches = liveData.matches || [];
  const roles = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : [];

  // 1. Smart Counter to find matches for Gameweeks
  const franchiseMatchCount = {};
  const matchGW = [];
  matches.forEach(m => {
    const gwMap = {};
    if (m.confirmed && m.teams) {
      m.teams.split(/vs/i).forEach(t => {
        const team = getTeamCode(t);
        if (!franchiseMatchCount[team]) franchiseMatchCount[team] = 0;
        franchiseMatchCount[team]++;
        gwMap[team] = franchiseMatchCount[team];
      });
    }
    matchGW.push(gwMap);
  });

  // 2. Gather player points (Filtered by GW or ALL)
  const playersThisGW = {};
  matches.forEach((m, mi) => {
    if (!m.confirmed || !m.playerStats) return;
    m.playerStats.forEach(stat => {
      const roleData = roles.find(r => r.name === stat.name);
      if (roleData && roleData.iplTeam) {
        
        let include = false;
        if (selectedGW === 'ALL') {
            include = true; // Include every confirmed match!
        } else if (matchGW[mi] && matchGW[mi][roleData.iplTeam] == selectedGW) {
            include = true; // Include only this specific GW
        }

        if (include) {
           const rawPts = calcPlayerTotal(stat, stat.name === m.motm);
           if (rawPts > 0) {
               if (!playersThisGW[stat.name]) playersThisGW[stat.name] = { name: stat.name, role: roleData.role, pts: 0 };
               playersThisGW[stat.name].pts += rawPts;
           }
        }
      }
    });
  });

  // 3. Group and Sort by Role
  const byRole = { BAT: [], BOWL: [], AR: [], WK: [] };
  Object.values(playersThisGW).forEach(p => { if (byRole[p.role]) byRole[p.role].push(p); });
  Object.keys(byRole).forEach(r => byRole[r].sort((a, b) => b.pts - a.pts));

  // 4. THE OPTIMIZER ALGORITHM 
  let bestTeam = null;
  let maxTotal = -1;

  for (let b = 3; b <= 6; b++) {
    for (let w = 3; w <= 6; w++) {
      for (let a = 1; a <= 4; a++) {
        for (let k = 1; k <= 4; k++) {
          if (b + w + a + k === 11) { 
            if (byRole.BAT.length >= b && byRole.BOWL.length >= w && byRole.AR.length >= a && byRole.WK.length >= k) {
              const xi = [ ...byRole.BAT.slice(0, b), ...byRole.BOWL.slice(0, w), ...byRole.AR.slice(0, a), ...byRole.WK.slice(0, k) ];
              xi.sort((p1, p2) => p2.pts - p1.pts);
              let sum = 0;
              xi.forEach((p, index) => { sum += index === 0 ? p.pts * 2 : p.pts; }); 
              if (sum > maxTotal) { maxTotal = sum; bestTeam = xi; }
            }
          }
        }
      }
    }
  }

  // Helper to draw the player cards
  function renderPitchRow(players, label) {
    if (players.length === 0) return '';
    return `
      <div style="margin-bottom:1.5rem;">
        <div style="font-family:'Rajdhani'; font-size:0.75rem; color:var(--gray); letter-spacing:2px; margin-bottom:0.5rem; text-align:center;">${label}</div>
        <div style="display:flex; justify-content:center; gap:0.75rem; flex-wrap:wrap;">
          ${players.map(p => {
             const isCap = p === bestTeam[0]; 
             return `
             <div class="dt-player-card ${isCap ? 'dt-captain' : ''}">
                <div class="dt-name">${p.name} ${isCap ? '<b>(C)</b>' : ''}</div>
                <div class="dt-pts">${showPts(isCap ? p.pts * 2 : p.pts)} pts</div>
             </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // 5. Fire the Modal
  const dropdownHTML = `
    <select style="background:var(--navy3);border:1px solid var(--gold);color:var(--white);padding:0.6rem 0.8rem;border-radius:6px;font-family:'Rajdhani';font-weight:700;outline:none;cursor:pointer;margin-bottom:1rem;width:100%;" onchange="showDreamTeamModal(this.value === 'ALL' ? 'ALL' : parseInt(this.value))">
      <option value="ALL" ${selectedGW === 'ALL' ? 'selected' : ''}>🌟 OVERALL SEASON TEAM 🌟</option>
      ${[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(i => `<option value="${i}" ${selectedGW==i?'selected':''}>GAMEWEEK ${i}</option>`).join('')}
      
      <!-- 🚨 UPDATED: Authentic Playoff Names -->
      <option value="15" ${selectedGW=='15'?'selected':''}>Q1 / ELIMINATOR</option>
      <option value="16" ${selectedGW=='16'?'selected':''}>QUALIFIER 2</option>
      <option value="17" ${selectedGW=='17'?'selected':''}>THE FINAL</option>
    </select>
  `;

  const bodyHTML = `
    ${dropdownHTML}
    ${!bestTeam ? `<div class="empty-state" style="padding:2rem;">Not enough match data for this selection yet!</div>` : `
    <div style="background:var(--card); border:1px solid var(--border); border-radius:10px; padding:1.5rem; text-align:center;">
      <div style="font-family:'Bebas Neue',sans-serif; font-size:2.5rem; color:var(--gold); margin-bottom:1rem;">${showPts(maxTotal)} PTS</div>
      <div class="pitch-container" style="padding:1.5rem 1rem;">
        ${renderPitchRow(bestTeam.filter(p=>p.role==='WK'), 'WICKETKEEPERS')}
        ${renderPitchRow(bestTeam.filter(p=>p.role==='BAT'), 'BATTERS')}
        ${renderPitchRow(bestTeam.filter(p=>p.role==='AR'), 'ALLROUNDERS')}
        ${renderPitchRow(bestTeam.filter(p=>p.role==='BOWL'), 'BOWLERS')}
      </div>
    </div>`}
  `;

  modal(`🌟 PERFECT XI (DREAM TEAM)`, bodyHTML, `<button class="btn-primary" style="width:100%;" onclick="closeModal()">CLOSE</button>`);
};

// ─────────────────────────────────────────────────────────────────────────────
// DRAG & DROP PLAYING XII BUILDER (WITH DB PERSISTENCE & AUTO-RESET)
// ─────────────────────────────────────────────────────────────────────────────
window.showPlayingXIIModal = () => {
  const teams = liveData.teams || [];
  const matches = liveData.matches || [];
  const roles = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : [];
  const myTeam = teams[session.teamIndex];
  if (!myTeam) return;

  // 1. Calculate up-to-date points for everyone in the squad AND build a "Points Hash"
  let currentSquadPtsHash = 0;
  const playerStats = (myTeam.players || []).map(pName => {
    let totalPts = 0;
    const roleData = roles.find(r => r.name === pName) || { role: 'AR' };
    matches.forEach((m, mi) => {
      if (!m.confirmed || !m.playerStats) return;
      const stat = m.playerStats.find(s => s.name === pName);
      if (stat) totalPts += getTeamPlayerPts(stat, myTeam, m.motm, mi);
    });
    currentSquadPtsHash += totalPts; // Tally up total team points
    return { name: pName, role: roleData.role, pts: totalPts };
  });

  // Save the hash globally so the Save button can grab it later
  window._currentSquadPtsHash = currentSquadPtsHash;

  let allSquad = [];

  // 2. CHECK PERSISTENCE: Have points changed since last save?
  const pointsMatch = myTeam.savedXIIPts !== undefined && Math.abs(myTeam.savedXIIPts - currentSquadPtsHash) < 0.1;

  if (pointsMatch && Array.isArray(myTeam.savedXIIOrder) && myTeam.savedXIIOrder.length > 0) {
      // 🟢 POINTS MATCH! Load their custom dragged order
      myTeam.savedXIIOrder.forEach(savedName => {
          if (savedName === 'Empty Slot') return;
          const p = playerStats.find(x => x.name === savedName);
          if (p) allSquad.push(p);
      });
      // Catch any players added to the squad who aren't in the saved list (throw them on the bench)
      playerStats.forEach(p => {
          if (!allSquad.find(x => x.name === p.name)) allSquad.push(p);
      });
  } else {
      // 🔴 POINTS CHANGED (Or first load)! Run the Optimizer
      const byRole = { BAT: [], BOWL: [], AR: [], WK: [] };
      playerStats.forEach(p => { if (byRole[p.role]) byRole[p.role].push(p); });
      Object.keys(byRole).forEach(r => byRole[r].sort((a, b) => b.pts - a.pts));

      let best11 = null;
      let maxTotal = -1;

      for (let b = 3; b <= 6; b++) {
        for (let w = 3; w <= 6; w++) {
          for (let a = 1; a <= 4; a++) {
            for (let k = 1; k <= 4; k++) {
              if (b + w + a + k === 11) {
                if (byRole.BAT.length >= b && byRole.BOWL.length >= w && byRole.AR.length >= a && byRole.WK.length >= k) {
                  const xi = [ ...byRole.BAT.slice(0, b), ...byRole.BOWL.slice(0, w), ...byRole.AR.slice(0, a), ...byRole.WK.slice(0, k) ];
                  xi.sort((p1, p2) => p2.pts - p1.pts);
                  let sum = 0;
                  xi.forEach(p => { sum += p.pts; });
                  if (sum > maxTotal) { maxTotal = sum; best11 = xi; }
                }
              }
            }
          }
        }
      }

      if (!best11) best11 = [...playerStats].sort((a,b) => b.pts - a.pts).slice(0, 11);

      const roleOrder = { 'BAT': 1, 'WK': 2, 'AR': 3, 'BOWL': 4, '-': 5 };
      best11.sort((a, b) => {
          if (roleOrder[a.role] !== roleOrder[b.role]) return roleOrder[a.role] - roleOrder[b.role];
          return b.pts - a.pts; 
      });

      const remaining = playerStats.filter(p => !best11.find(x => x.name === p.name));
      remaining.sort((a,b) => b.pts - a.pts); 
      const impact = remaining.length > 0 ? remaining.shift() : null; 

      allSquad = [...best11];
      if (impact) allSquad.push(impact);
      allSquad.push(...remaining); 
  }

  // Pad to 12 if they have a weirdly small squad
  while (allSquad.length < 12) { allSquad.push({ name: 'Empty Slot', role: '-', pts: 0 }); }

  const initialTop12Pts = allSquad.slice(0, 12).reduce((sum, p) => sum + p.pts, 0);

  // 3. Build the COMPACT UI 
  // Notice we added data-name="${p.name}" so the save function can grab exactly who was dragged!
  const listHTML = allSquad.map((p, index) => {
      const roleColor = p.role === 'BAT' ? '#60a5fa' : p.role === 'BOWL' ? '#f87171' : p.role === 'AR' ? '#fbbf24' : '#a78bfa';
      return `
        <div class="drag-item" data-pts="${p.pts}" data-name="${p.name}" draggable="true" style="display:flex; justify-content:space-between; align-items:center; background:var(--navy3); border:1px solid rgba(255,255,255,0.05); padding:0.4rem 0.6rem; margin-bottom:0.25rem; border-radius:6px; cursor:grab; transition:transform 0.1s, opacity 0.2s;">
           <div style="display:flex; align-items:center; gap:0.5rem;">
              <div style="color:var(--gray); font-size:1rem; cursor:grab; padding-right:0.25rem;">☰</div>
              <div class="dt-rank" style="width:20px; font-family:'Rajdhani'; font-weight:700; font-size:0.9rem;"></div>
              <div style="line-height:1.2;">
                <div class="dt-player-name" style="font-weight:600; font-size:0.85rem;">${p.name}</div>
                <div style="font-size:0.6rem; color:${roleColor}; font-weight:700;">${p.role}</div>
              </div>
           </div>
           <div style="font-family:'Rajdhani'; font-weight:700; color:var(--white); font-size:0.85rem;">${showPts(p.pts)} pts</div>
        </div>
      `;
  }).join('');

  modal(`🏏 PLAYING XII BUILDER`,
     `<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem; gap:1rem;">
         <div style="font-size:0.75rem; color:var(--gray); line-height:1.4; flex:1;">
             Drag and drop players between the Playing XI, your Impact Sub, and the Bench. <br>
             <span style="color:var(--gold);">If match points update, this lineup will auto-reset to the optimal 11!</span>
         </div>
         <div style="background:rgba(201,168,76,0.1); border:1px solid var(--gold); padding:0.5rem 1rem; border-radius:8px; text-align:center; min-width:100px;">
             <div style="font-size:0.65rem; color:var(--gold); letter-spacing:1px; font-weight:700;">TOTAL</div>
             <div id="xii-total-pts" style="font-family:'Bebas Neue',sans-serif; font-size:1.8rem; color:var(--white); line-height:1;">${showPts(initialTop12Pts)} PTS</div>
         </div>
      </div>
      <div id="sortable-xii-list" style="overflow-y: auto; padding-right: 4px;">
         ${listHTML}
      </div>`,
     // Swapped closeModal() to saveAndCloseXII()
     `<button class="btn-primary" style="width:100%;" onclick="saveAndCloseXII()">SAVE & CLOSE</button>`
  );

  // 4. Hook up the HTML5 Drag & Drop Engine
  const list = document.getElementById('sortable-xii-list');
  let draggedItem = null;

  list.addEventListener('dragstart', (e) => {
      const target = e.target.closest('.drag-item');
      if (target) {
          draggedItem = target;
          setTimeout(() => { target.style.opacity = '0.4'; target.style.transform = 'scale(0.98)'; }, 0);
      }
  });

  list.addEventListener('dragend', (e) => {
      const target = e.target.closest('.drag-item');
      if (target) {
          target.style.transform = 'scale(1)';
          draggedItem = null;
          updateXIIIndices();
      }
  });

  list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const afterElement = getDragAfterElement(list, e.clientY);
      if (!draggedItem) return;
      if (afterElement == null) list.appendChild(draggedItem);
      else list.insertBefore(draggedItem, afterElement);
  });

  function getDragAfterElement(container, y) {
      const draggableElements = [...container.querySelectorAll('.drag-item:not([style*="opacity: 0.4"])')];
      return draggableElements.reduce((closest, child) => {
          const box = child.getBoundingClientRect();
          const offset = y - box.top - box.height / 2;
          if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
          else return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function updateXIIIndices() {
      const items = list.querySelectorAll('.drag-item');
      let liveTotal = 0;

      items.forEach((item, idx) => {
          const numDiv = item.querySelector('.dt-rank');
          const nameDiv = item.querySelector('.dt-player-name');
          
          if (idx < 12) liveTotal += parseFloat(item.dataset.pts || 0);
          
          nameDiv.innerHTML = nameDiv.textContent.replace(' (IMPACT)', '').replace(' (BENCH)', '');
          
          if (idx < 11) {
              numDiv.textContent = idx + 1;
              numDiv.style.color = 'var(--gold)';
              item.style.borderLeft = '2px solid rgba(255,255,255,0.05)';
              item.style.opacity = '1';
          } else if (idx === 11) {
              numDiv.textContent = '12';
              numDiv.style.color = '#60a5fa'; 
              item.style.borderLeft = '4px solid #60a5fa';
              item.style.opacity = '1';
              nameDiv.innerHTML += ' <span style="color:#60a5fa; font-size:0.75rem; margin-left:6px;">(IMPACT)</span>';
          } else {
              numDiv.textContent = '—';
              numDiv.style.color = 'var(--gray)';
              item.style.borderLeft = '2px solid var(--gray)';
              item.style.opacity = '0.5'; 
              nameDiv.innerHTML += ' <span style="color:var(--gray); font-size:0.75rem; margin-left:6px;">(BENCH)</span>';
          }
      });

      const totalEl = document.getElementById('xii-total-pts');
      if (totalEl) totalEl.textContent = showPts(liveTotal) + ' PTS';
  }

  updateXIIIndices();
};

// 5. The Database Saving Engine
window.saveAndCloseXII = async () => {
    const list = document.getElementById('sortable-xii-list');
    if (!list) return closeModal();

    // Scrape the names in the exact order they were dragged
    const customOrder = Array.from(list.querySelectorAll('.drag-item')).map(item => item.dataset.name).filter(Boolean);

    // Save it to Firebase!
    const updatedTeams = JSON.parse(JSON.stringify(liveData.teams || []));
    updatedTeams[session.teamIndex].savedXIIOrder = customOrder;
    updatedTeams[session.teamIndex].savedXIIPts = window._currentSquadPtsHash;
    
    await set(ref(db, `leagues/${window.selectedYear}/teams`), updatedTeams);
    toast('Playing XII format saved!', 'success');
    closeModal();
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: VIEW ALL TEAMS PLAYING XII (SORTED BY POINTS)
// ─────────────────────────────────────────────────────────────────────────────
window.showAllTeamsXIIModal = () => {
  const teams = liveData.teams || [];
  const matches = liveData.matches || [];
  const roles = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : [];

  // 1. Calculate the data for ALL teams first and store it in an array
  const teamLineups = teams.map((t) => {
      let currentSquadPtsHash = 0;
      const playerStats = (t.players || []).map(pName => {
          let totalPts = 0;
          const roleData = roles.find(r => r.name === pName) || { role: 'AR' };
          matches.forEach((m, mi) => {
              if (!m.confirmed || !m.playerStats) return;
              const stat = m.playerStats.find(s => s.name === pName);
              if (stat) totalPts += getTeamPlayerPts(stat, t, m.motm, mi);
          });
          currentSquadPtsHash += totalPts;
          return { name: pName, role: roleData.role, pts: totalPts };
      });

      let best12 = [];
      const pointsMatch = t.savedXIIPts !== undefined && Math.abs(t.savedXIIPts - currentSquadPtsHash) < 0.1;

      // Check if they have a valid custom save, OR run the optimizer
      if (pointsMatch && Array.isArray(t.savedXIIOrder) && t.savedXIIOrder.length > 0) {
          t.savedXIIOrder.forEach(savedName => {
              if (savedName === 'Empty Slot') return;
              const p = playerStats.find(x => x.name === savedName);
              if (p) best12.push(p);
          });
          playerStats.forEach(p => { if (!best12.find(x => x.name === p.name)) best12.push(p); });
      } else {
          const byRole = { BAT: [], BOWL: [], AR: [], WK: [] };
          playerStats.forEach(p => { if (byRole[p.role]) byRole[p.role].push(p); });
          Object.keys(byRole).forEach(r => byRole[r].sort((a, b) => b.pts - a.pts));

          let best11 = null; let maxTotal = -1;
          for (let b = 3; b <= 6; b++) {
              for (let w = 3; w <= 6; w++) {
                  for (let a = 1; a <= 4; a++) {
                      for (let k = 1; k <= 4; k++) {
                          if (b + w + a + k === 11) {
                              if (byRole.BAT.length >= b && byRole.BOWL.length >= w && byRole.AR.length >= a && byRole.WK.length >= k) {
                                  const xi = [ ...byRole.BAT.slice(0, b), ...byRole.BOWL.slice(0, w), ...byRole.AR.slice(0, a), ...byRole.WK.slice(0, k) ];
                                  xi.sort((p1, p2) => p2.pts - p1.pts);
                                  let sum = 0; xi.forEach(p => { sum += p.pts; });
                                  if (sum > maxTotal) { maxTotal = sum; best11 = xi; }
                              }
                          }
                      }
                  }
              }
          }

          if (!best11) best11 = [...playerStats].sort((a,b) => b.pts - a.pts).slice(0, 11);
          const roleOrder = { 'BAT': 1, 'WK': 2, 'AR': 3, 'BOWL': 4, '-': 5 };
          best11.sort((a, b) => {
              if (roleOrder[a.role] !== roleOrder[b.role]) return roleOrder[a.role] - roleOrder[b.role];
              return b.pts - a.pts; 
          });

          const remaining = playerStats.filter(p => !best11.find(x => x.name === p.name));
          remaining.sort((a,b) => b.pts - a.pts); 
          const impact = remaining.length > 0 ? remaining.shift() : null; 

          best12 = [...best11];
          if (impact) best12.push(impact);
          best12.push(...remaining);
      }

      while (best12.length < 12) { best12.push({ name: 'Empty Slot', role: '-', pts: 0 }); }
      best12 = best12.slice(0, 12); 

      const top12Pts = best12.reduce((sum, p) => sum + p.pts, 0);

      // Package it up for sorting
      return {
          teamName: t.name,
          best12: best12,
          totalPts: top12Pts
      };
  });

  // 2. SORT THE TEAMS BY HIGHEST PLAYING XII POINTS!
  teamLineups.sort((a, b) => b.totalPts - a.totalPts);

  // 3. Build the UI HTML
  let allTeamsHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:1rem;">`;

  teamLineups.forEach((data, rank) => {
      // Add a slight gold tint to the #1 team's card
      const isFirst = rank === 0;
      
      allTeamsHTML += `
      <div style="background:var(--card); border:1px solid ${isFirst ? 'var(--gold)' : 'var(--border)'}; border-radius:8px; padding:1rem; box-shadow:0 4px 6px rgba(0,0,0,0.3); position:relative;">
          ${isFirst ? `<div style="position:absolute; top:-2px; right:-5px; background:var(--gold); color:var(--navy); font-weight:bold; font-size:0.7rem; padding:2px 6px; border-radius:4px; font-family:'Bebas Neue';">STRONGEST 12</div>` : ''}
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:0.5rem; margin-bottom:0.5rem;">
              <div style="font-family:'Bebas Neue'; font-size:1.4rem; color:var(--gold); letter-spacing:1px;">
                  <span style="color:var(--gray); font-size:1rem; margin-right:6px;">#${rank + 1}</span>${data.teamName}
              </div>
              <div style="font-family:'Rajdhani'; font-weight:700; color:var(--white);">${showPts(data.totalPts)} PTS</div>
          </div>
          <div style="font-size:0.8rem;">
              ${data.best12.map((p, idx) => {
                  let badge = idx < 11 ? `<span style="color:var(--gold); min-width:20px; display:inline-block;">${idx+1}.</span>` : `<span style="color:#60a5fa; min-width:20px; display:inline-block;">12.</span>`;
                  let pName = idx === 11 ? `${p.name} <span style="color:#60a5fa; font-size:0.65rem; margin-left:4px;">(IMPACT)</span>` : p.name;
                  let color = p.role === 'BAT' ? '#60a5fa' : p.role === 'BOWL' ? '#f87171' : p.role === 'AR' ? '#fbbf24' : '#a78bfa';
                  
                  return `<div style="display:flex; justify-content:space-between; padding:0.15rem 0; border-bottom:1px solid rgba(255,255,255,0.02);">
                      <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${badge} <span style="font-weight:600;">${pName}</span> <span style="font-size:0.6rem; color:${color}; font-weight:700; margin-left:4px;">${p.role}</span></div>
                      <div style="color:var(--gray); font-family:'Rajdhani'; font-weight:700; min-width:35px; text-align:right;">${showPts(p.pts)}</div>
                  </div>`;
              }).join('')}
          </div>
      </div>`;
  });

  allTeamsHTML += `</div>`;

  modal(`🔍 LEAGUE-WIDE PLAYING XIIs`, 
      `<div style="font-size:0.85rem; color:var(--gray); margin-bottom:1.5rem;">
         A live look at exactly what 12 players every manager has locked in, <strong style="color:var(--gold);">sorted by the strongest Starting 12</strong>.
       </div>
       <div style="max-height:65vh; overflow-y:auto; padding-right:6px;">${allTeamsHTML}</div>`, 
      `<button class="btn-primary" style="width:100%;" onclick="closeModal()">CLOSE</button>`
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: MONEYBALL PRICE EDITOR (SMART EXCEL PASTE)
// ─────────────────────────────────────────────────────────────────────────────
window.editDraftPrices = () => {
    const prices = liveData.draftPrices || {};
    // Loads existing data neatly separated by a tab
    const textData = Object.keys(prices).map(p => `${p}\t${prices[p]}`).join('\n');

    modal(
        `💰 EDIT DRAFT PRICES (IN CRORES)`,
        `<div style="font-size:0.85rem; color:var(--gray); margin-bottom:0.75rem;">
            <b>SMART PASTE:</b> Just copy and paste directly from your Excel column! <br>
            <span style="color:var(--gold);">The app will automatically remove the ✈︎ symbols and read the prices (e.g. <i>16.50</i>).</span>
         </div>
         <textarea id="price-input" style="width:100%;height:300px;background:var(--navy3);border:1px solid var(--border);border-radius:6px;color:var(--white);font-family:'DM Sans',sans-serif;font-size:0.9rem;padding:0.75rem;outline:none;resize:vertical;white-space:nowrap;">${textData}</textarea>`,
        `<button class="btn-primary" style="width:100%;" onclick="saveDraftPrices()">SAVE PRICES</button>`
    );
};

window.saveDraftPrices = async () => {
    const raw = el('price-input').value;
    const prices = {};

    raw.split('\n').forEach(line => {
        // 1. Instantly delete the airplane emojis so names match the API!
        let cleanLine = line.trim();
        if (!cleanLine) return;

        let pName = "";
        let pPrice = NaN;

        // 2. Check how the data was pasted
        if (cleanLine.includes('=')) {
            const parts = cleanLine.split('=');
            pName = parts[0].trim();
            pPrice = parseFloat(parts[1].trim());
        } else if (cleanLine.includes('\t')) {
            // Standard Excel Paste (Tab separated)
            const parts = cleanLine.split('\t');
            pName = parts[0].trim();
            pPrice = parseFloat(parts[parts.length - 1].trim()); 
        } else {
            // Mashed together paste (e.g., "Yashasvi Jaiswal16.50")
            // Regex splits letters/spaces from the decimal numbers at the end
            const match = cleanLine.match(/^(.*?)(\d+(\.\d+)?)$/);
            if (match) {
                pName = match[1].trim();
                pPrice = parseFloat(match[2].trim());
            }
        }

        if (pName && !isNaN(pPrice)) {
            prices[pName] = pPrice;
        }
    });

    await set(ref(db, `leagues/${window.selectedYear}/draftPrices`), prices);
    closeModal();
    toast('Excel draft prices parsed and saved!', 'success');
};


// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED MONEYBALL MATRIX (WITH MULTI-SELECT TOGGLE FILTERS)
// ─────────────────────────────────────────────────────────────────────────────
window.showMoneyballMatrix = () => {
    const prices = liveData.draftPrices || {};
    const matches = liveData.matches || [];
    const teams = liveData.teams || [];
    const roles = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : [];

    // Reset filters every time the modal opens
    window.mbFilters = {
        roles: new Set(),
        statuses: new Set(),
        tiers: new Set(),
        owners: new Set()
    };

    window.toggleMbFilter = (category, value) => {
        if (window.mbFilters[category].has(value)) {
            window.mbFilters[category].delete(value);
        } else {
            window.mbFilters[category].add(value);
        }
        renderMbPlayers();
    };

    // 1. SMART GAMEWEEK TRACKER (Needed to know when players joined)
    const matchGW = [];
    const franchiseMatchCount = {};
    matches.forEach(m => {
        const gwMap = {};
        if (m.confirmed && m.teams) {
            m.teams.split(/vs/i).forEach(t => {
                const team = getTeamCode(t);
                if (!franchiseMatchCount[team]) franchiseMatchCount[team] = 0;
                franchiseMatchCount[team]++;
                gwMap[team] = franchiseMatchCount[team];
            });
        }
        matchGW.push(gwMap);
    });

    // 2. CALCULATE SHIELDED POINTS AND MATCHES
    const playerTracker = {};
    matches.forEach((m, mi) => {
        if (!m.confirmed || !m.playerStats) return;
        m.playerStats.forEach(stat => {
            const pName = stat.name;
            const roleData = roles.find(r => r.name === pName);
            const iplTeam = roleData ? roleData.iplTeam : null;
            const gwNum = iplTeam ? matchGW[mi][iplTeam] : null;

            const ownerTeam = teams.find(t => (t.players || []).includes(pName));

            let skipPoints = false;
            if (ownerTeam && ownerTeam.rosterRules && ownerTeam.rosterRules[pName] && gwNum) {
                const rule = ownerTeam.rosterRules[pName];
                if (rule.in && gwNum < rule.in) skipPoints = true;
                if (rule.out && gwNum > rule.out) skipPoints = true;
            }

            if (!playerTracker[pName]) playerTracker[pName] = { pts: 0, gamesPlayed: 0 };
            
            if (!skipPoints) {
                const bat = calcBattingTotal(stat.runs||0, stat.balls||0, stat.fours||0, stat.sixes||0);
                const bowl = calcBowlingTotal(stat.topWickets||0, stat.lowerWickets||0, stat.economy||0, stat.oversBowled||0);
                const field = calcFieldingPoints(stat.catches||0, stat.runouts||0);
                const motmPts = (m.motm === pName) ? 25 : 0;
                
                playerTracker[pName].pts += (bat + bowl + field + motmPts);
                playerTracker[pName].gamesPlayed += 1;
            }
        });
    });

    // 3. CALCULATE LEAGUE BASELINE 
    let globalSpentCr = 0;
    let globalPts = 0;

    teams.forEach(t => {
        (t.players || []).forEach(pName => {
            const price = prices[pName];
            if (price && price > 0) {
                globalSpentCr += price;
                globalPts += (playerTracker[pName] ? playerTracker[pName].pts : 0);
            }
        });
    });

    const leagueBaselinePtsPerCr = globalSpentCr > 0 ? (globalPts / globalSpentCr) : 0;

    // 4. BUILD ARRAYS (Players & Teams)
    const playerMatrix = [];
    Object.keys(prices).forEach(pName => {
        const priceCr = prices[pName];
        if (priceCr <= 0) return;
        const tracker = playerTracker[pName];
        if (!tracker || tracker.gamesPlayed === 0) return;

        const ownerTeam = teams.find(t => (t.players || []).includes(pName));
        const pts = tracker.pts;
        const expectedPts = priceCr * leagueBaselinePtsPerCr;
        
        const roleData = roles.find(r => r.name === pName) || { role: '-', uncapped: false };

        playerMatrix.push({ 
            name: pName, 
            owner: ownerTeam ? ownerTeam.name : "Free Agent", 
            price: priceCr, 
            pts: pts, 
            value: pts / priceCr,
            surplus: pts - expectedPts,
            role: roleData.role,
            uncapped: roleData.uncapped
        });
    });

    const teamROIArray = [];
    teams.forEach(t => {
        let totalPts = 0; let totalSpentCr = 0; let validPlayers = 0; let expectedPts = 0;
        
        (t.players || []).forEach(pName => {
            const price = prices[pName];
            if (price && price > 0) {
                totalSpentCr += price;
                totalPts += (playerTracker[pName] ? playerTracker[pName].pts : 0);
                expectedPts += (price * leagueBaselinePtsPerCr);
                validPlayers++;
            }
        });
        
        teamROIArray.push({ 
            name: t.name, 
            spent: totalSpentCr, 
            pts: totalPts, 
            surplus: totalPts - expectedPts, 
            validCount: validPlayers 
        });
    });

    // 5. DYNAMIC RENDERING FUNCTIONS
    let currentPlayerSort = 'value';
    let playerSortAsc = false; 

    const makePill = (category, value, label) => {
        const isActive = window.mbFilters[category].has(value);
        const style = isActive 
            ? "background:rgba(201,168,76,0.2); border:1px solid var(--gold); color:var(--gold);" 
            : "background:var(--navy3); border:1px solid rgba(255,255,255,0.1); color:var(--gray);";
        return `<button style="${style} cursor:pointer; font-family:'Rajdhani'; font-weight:600; font-size:0.75rem; padding:0.3rem 0.7rem; border-radius:20px; transition:all 0.2s;" onclick="toggleMbFilter('${category}', '${value}')">${label}</button>`;
    };

    // --- PLAYER TAB RENDERING (INTERACTIVE WITH FILTERS) ---
    window.renderMbPlayers = (sortKey) => {
        if (sortKey) {
            if (currentPlayerSort === sortKey) {
                playerSortAsc = !playerSortAsc; 
            } else {
                currentPlayerSort = sortKey;
                playerSortAsc = false; 
            }
        }

        // FILTER THE DATABASE (Uses Sets for multiple selections)
        let filteredMatrix = playerMatrix.filter(p => {
            // Role Filter
            if (window.mbFilters.roles.size > 0 && !window.mbFilters.roles.has(p.role)) return false;
            
            // Status Filter
            const pStatus = p.uncapped ? 'UNCAPPED' : 'CAPPED';
            if (window.mbFilters.statuses.size > 0 && !window.mbFilters.statuses.has(pStatus)) return false;
            
            // Tier Filter
            let pTier = 'BARGAIN';
            if (p.price >= 10) pTier = 'SUPERSTAR';
            else if (p.price >= 4) pTier = 'MID';
            if (window.mbFilters.tiers.size > 0 && !window.mbFilters.tiers.has(pTier)) return false;
            
            // Owner Filter
            const pOwner = p.owner === "Free Agent" ? 'FREE_AGENT' : p.owner;
            if (window.mbFilters.owners.size > 0 && !window.mbFilters.owners.has(pOwner)) return false;
            
            return true;
        });

        // SORT THE FILTERED LIST
        filteredMatrix.sort((a, b) => {
            return playerSortAsc ? a[currentPlayerSort] - b[currentPlayerSort] : b[currentPlayerSort] - a[currentPlayerSort];
        });

        const ptsArrow = currentPlayerSort === 'pts' ? (playerSortAsc ? '▲' : '▼') : '<span style="color:var(--gray);font-size:0.7rem;">↕</span>';
        const valArrow = currentPlayerSort === 'value' ? (playerSortAsc ? '▲' : '▼') : '<span style="color:var(--gray);font-size:0.7rem;">↕</span>';
        const surpArrow = currentPlayerSort === 'surplus' ? (playerSortAsc ? '▲' : '▼') : '<span style="color:var(--gray);font-size:0.7rem;">↕</span>';

        const ownerPills = `
            ${makePill('owners', 'FREE_AGENT', '🕵️ Free Agents')}
            ${teams.map(t => makePill('owners', t.name, t.name)).join('')}
        `;

        const filterHTML = `
            <div style="background:rgba(0,0,0,0.2); padding:1rem; border-radius:8px; margin-bottom:1rem; border:1px solid rgba(255,255,255,0.05); font-size:0.8rem;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.75rem;">
                    <span style="color:var(--gray); font-family:'Bebas Neue'; letter-spacing:1px; width:50px;">ROLE:</span>
                    ${makePill('roles', 'BAT', 'Batters')}
                    ${makePill('roles', 'BOWL', 'Bowlers')}
                    ${makePill('roles', 'AR', 'All-Rounders')}
                    ${makePill('roles', 'WK', 'Wicketkeepers')}
                </div>
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.75rem;">
                    <span style="color:var(--gray); font-family:'Bebas Neue'; letter-spacing:1px; width:50px;">STATUS:</span>
                    ${makePill('statuses', 'CAPPED', 'Capped')}
                    ${makePill('statuses', 'UNCAPPED', 'Uncapped ★')}
                </div>
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.75rem;">
                    <span style="color:var(--gray); font-family:'Bebas Neue'; letter-spacing:1px; width:50px;">PRICE:</span>
                    ${makePill('tiers', 'SUPERSTAR', '10Cr+')}
                    ${makePill('tiers', 'MID', '4Cr - 9.9Cr')}
                    ${makePill('tiers', 'BARGAIN', '< 4Cr')}
                </div>
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                    <span style="color:var(--gray); font-family:'Bebas Neue'; letter-spacing:1px; width:50px;">OWNER:</span>
                    ${ownerPills}
                </div>
            </div>
        `;

        let tableHTML = `<table class="table" style="width:100%; text-align:left;">
            <thead>
                <tr>
                    <th style="width:30px; text-align:center;">#</th>
                    <th>PLAYER</th>
                    <th style="text-align:center;">OWNER</th>
                    <th style="text-align:center;">PRICE</th>
                    <th style="text-align:center; color:var(--gold); cursor:pointer; user-select:none;" onclick="renderMbPlayers('pts')" title="Sort by Points">PTS ${ptsArrow}</th> 
                   <th style="text-align:center; color:var(--gold); cursor:pointer; user-select:none;" onclick="renderMbPlayers('value')" title="Sort by Value">VALUE ${valArrow}</th>
                    <th style="text-align:center; color:var(--gold); cursor:pointer; user-select:none;" onclick="renderMbPlayers('surplus')" title="Sort by Surplus">SURPLUS ${surpArrow}</th>
                </tr>
            </thead><tbody>`;
        
        filteredMatrix.forEach((p, index) => {
            let rowStyle = "";
            
            const top10Threshold = filteredMatrix.length > 0 ? [...filteredMatrix].sort((a,b)=>b.value-a.value)[Math.min(9, filteredMatrix.length-1)].value : 0;
            const bot10Threshold = filteredMatrix.length > 0 ? [...filteredMatrix].sort((a,b)=>a.value-b.value)[Math.min(9, filteredMatrix.length-1)].value : 0;
            
            if (p.value >= top10Threshold && filteredMatrix.length > 0) rowStyle = "background: rgba(74, 222, 128, 0.1);"; 
            if (p.value <= bot10Threshold && filteredMatrix.length > 20) rowStyle = "background: rgba(248, 113, 113, 0.1);"; 
            
            const surplusStr = p.surplus >= 0 ? `+${showPts(p.surplus)}` : `${showPts(p.surplus)}`;
            const surplusColor = p.surplus >= 0 ? '#4ade80' : '#f87171';

            tableHTML += `<tr style="${rowStyle}">
                <td style="text-align:center; color:var(--gray);">${playerSortAsc ? filteredMatrix.length - index : index + 1}</td>
                <td style="font-weight:bold;">${p.name} <span style="font-size:0.65rem; color:var(--gray); margin-left:4px; font-weight:normal;">${p.role}</span>${p.uncapped ? '<span style="color:var(--gold); font-size:0.8rem; margin-left:4px;" title="Uncapped Player">★</span>' : ''}</td>
                <td style="text-align:center; color:#60a5fa; font-size:0.8rem;">${p.owner}</td>
                <td style="text-align:center; color:var(--gray);">₹${p.price.toFixed(2)}Cr</td>
                <td style="text-align:center; font-family:'Rajdhani'; font-weight:700;">${showPts(p.pts)}</td>
                <td style="text-align:center; color:var(--gold); font-weight:bold;">${p.value.toFixed(1)}</td>
                <td style="text-align:center; font-family:'Bebas Neue'; letter-spacing:1px; color:${surplusColor}; font-size:1.1rem;">${surplusStr}</td>
            </tr>`;
        });
        tableHTML += `</tbody></table>`;
        if (filteredMatrix.length === 0) tableHTML = `<div class="empty-small" style="text-align:center; padding: 2rem;">No players match these filters.</div>`;
        
        const container = document.getElementById('mb-players-view');
        if (container) {
            container.innerHTML = filterHTML + `<div id="mb-players-table-container">${tableHTML}</div>`;
        }
    };

    // --- TEAM TAB RENDERING (STATIC SURPLUS ONLY) ---
    window.renderMbTeams = () => {
        teamROIArray.sort((a, b) => b.surplus - a.surplus);

        let html = `<table class="table" style="width:100%; text-align:left;">
            <thead>
                <tr>
                    <th style="width:40px; text-align:center;">#</th>
                    <th>FRANCHISE</th>
                    <th style="text-align:center;">SPENT</th>
                    <th style="text-align:center;">PTS</th>
                    <th style="text-align:center; color:var(--gold);">NET SURPLUS</th>
                </tr>
            </thead><tbody>`;

        teamROIArray.forEach((t, index) => {
            if (t.validCount === 0) return;
            
            let rowStyle = "";
            const isTopSurp = index === 0; 
            const isBotSurp = index === teamROIArray.length - 1; 

            if (isTopSurp) rowStyle = "background: rgba(74, 222, 128, 0.1);"; 
            if (isBotSurp && teamROIArray.length > 3) rowStyle = "background: rgba(248, 113, 113, 0.1);"; 
            
            const surplusStr = t.surplus >= 0 ? `+${showPts(t.surplus)}` : `${showPts(t.surplus)}`;
            const surplusColor = t.surplus >= 0 ? '#4ade80' : '#f87171';

            html += `<tr style="${rowStyle}">
                <td style="text-align:center; color:var(--gray);">${index + 1}</td>
                <td style="font-weight:bold; font-size:1.1rem;">${t.name}</td>
                <td style="text-align:center; color:var(--gray);">₹${t.spent.toFixed(2)}Cr</td>
                <td style="text-align:center; font-family:'Rajdhani'; font-weight:700;">${showPts(t.pts)}</td>
                <td style="text-align:center; font-family:'Bebas Neue'; letter-spacing:1px; color:${surplusColor}; font-size:1.2rem;">${surplusStr}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
        if (teamROIArray.filter(t => t.validCount > 0).length === 0) html = `<div class="empty-small">No franchise data available.</div>`;
        
        const container = document.getElementById('mb-teams-table-container');
        if (container) container.innerHTML = html;
    };

    // 6. MODAL INITIALIZATION & UI
    window.switchMbTab = (tab) => {
        document.getElementById('mb-players-view').style.display = tab === 'players' ? 'block' : 'none';
        document.getElementById('mb-teams-view').style.display = tab === 'teams' ? 'block' : 'none';
        document.getElementById('mb-btn-players').className = tab === 'players' ? 'nav-btn active' : 'nav-btn';
        document.getElementById('mb-btn-teams').className = tab === 'teams' ? 'nav-btn active' : 'nav-btn';
    };

    modal(`⚾ THE MONEYBALL HUB`, 
        `<div style="display:flex; gap:10px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:1rem; margin-bottom:1rem;">
            <button id="mb-btn-players" class="nav-btn active" onclick="switchMbTab('players')">PLAYER METRICS</button>
            <button id="mb-btn-teams" class="nav-btn" onclick="switchMbTab('teams')">FRANCHISE PERFORMANCE</button>
         </div>
         <div style="max-height:60vh; overflow-y:auto; padding-right:5px;">
         <div style="font-size: 0.85 rem; color:var(--gray); margin-bottom:1.5rem; line-height: 1.5; background:var(--navy3); padding:0.8rem; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
           <strong style="color:var(--gold);">How is Surplus calculated?</strong><br> 
           The app calculates a League Baseline (Total League Points ÷ Total League Spend). It multiplies a player's auction price by this baseline to find their Expected Points. The Surplus is simply their Actual Points minus their Expected Points.
         </div>
         
            <div id="mb-players-view" style="display:block;">
                </div>
            <div id="mb-teams-view" style="display:none;"><div id="mb-teams-table-container"></div></div>
         </div>`, 
        `<button class="btn-primary" style="width:100%;" onclick="closeModal()">CLOSE</button>`
    );

    renderMbPlayers();
    renderMbTeams();
};

window.processRapidApiData = (rawData) => {
    if (!rawData || !rawData.scorecard) {
        alert("Invalid RapidAPI JSON format!");
        return null;
    }

    const players = {};
    const getPlayer = (name) => {
        if (!players[name]) {
            players[name] = { 
                name, runs: 0, balls: 0, fours: 0, sixes: 0, 
                topWickets: 0, lowerWickets: 0, economy: 0, 
                oversBowled: 0, catches: 0, runouts: 0 
            };
        }
        return players[name];
    };

    // Helper: Removes "sub", "substitute", and brackets from fielder names
    const cleanFielder = (name) => {
        return name.replace(/\bsub(?:stitute)?\b/ig, '').replace(/[()]/g, '').trim();
    };

    rawData.scorecard.forEach(innings => {
        
        // 1. Process Bowlers FIRST to give them their base wickets & economy
        (innings.bowler || []).forEach(b => {
            const p = getPlayer(b.name);
            p.topWickets = parseInt(b.wickets || 0); // Start by putting all wickets here
            p.oversBowled = parseFloat(b.overs || 0);
            p.economy = parseFloat(b.economy || 0);
        });

        // 2. Process Batters, Fielders, and Re-allocate Lower Order Wickets
        (innings.batsman || []).forEach((b, index) => {
            const p = getPlayer(b.name);
            p.runs = parseInt(b.runs || 0); 
            p.balls = parseInt(b.balls || 0); 
            p.fours = parseInt(b.fours || 0); 
            p.sixes = parseInt(b.sixes || 0);

            const outStr = (b.outdec || "").trim();
            if (!outStr) return;

            // FIX: Handle "c & b" or "c and b" explicitly so it doesn't create an "and" player
            const cbMatch = outStr.match(/^c\s*(?:&|and)\s*b\s+(.+)/i);
            if (cbMatch) {
                getPlayer(cleanFielder(cbMatch[1])).catches += 1;
            } else {
                // Normal catch
                const catchMatch = outStr.match(/^c\s+(.+?)\s+b\s+/i);
                if (catchMatch) getPlayer(cleanFielder(catchMatch[1])).catches += 1;
            }

            // Detect Stumpings
            const stumpMatch = outStr.match(/^st\s+(.+?)\s+b\s+/i);
            if (stumpMatch) getPlayer(cleanFielder(stumpMatch[1])).runouts += 1;

            // Detect Runouts (and split if multiple players are involved)
            const runoutMatch = outStr.match(/run out\s*\((.+?)\)/i);
            if (runoutMatch) {
                runoutMatch[1].split('/').forEach(f => getPlayer(cleanFielder(f)).runouts += 1);
            }

            // FIX: Lower Order Wickets (Index 7+ means Batter #8 through #11)
            if (index >= 7) {
                // Finds the bowler's name at the end of the string (e.g. "c Fielder b Bowler")
                const bowlerMatch = outStr.match(/\bb\s+(.+)$/i);
                
                if (bowlerMatch) {
                    const extractedBowler = bowlerMatch[1].trim();
                    
                    // Look through our players to find the bowler who took this wicket
                    let bowler = Object.values(players).find(x => 
                        x.name.toLowerCase() === extractedBowler.toLowerCase() || 
                        x.name.toLowerCase().includes(extractedBowler.toLowerCase()) || 
                        extractedBowler.toLowerCase().includes(x.name.toLowerCase())
                    );

                    // Re-allocate the wicket!
                    if (bowler) {
                        bowler.lowerWickets += 1;
                        bowler.topWickets = Math.max(0, bowler.topWickets - 1);
                    }
                }
            }
        });
    });

    const team1 = rawData.scorecard[0]?.batteamname || "TBA";
    const team2 = rawData.scorecard[1]?.batteamname || "TBA";

    return {
        teams: `${team1} vs ${team2}`,
        confirmed: rawData.ismatchcomplete,
        status: rawData.status,
        playerStats: Object.values(players)
    };
};

// The function triggered by the Admin button
window.importRapidApiMatch = () => {
    const rawText = document.getElementById('rapid-api-input').value;
    const matchIndex = parseInt(document.getElementById('rapid-api-match-select').value);

    try {
        const rawJson = JSON.parse(rawText);
        const parsedData = processRapidApiData(rawJson);

        if (parsedData && liveData.matches[matchIndex]) {
            // Update the existing match with the new RapidAPI stats
            liveData.matches[matchIndex].teams = parsedData.teams;
            liveData.matches[matchIndex].confirmed = parsedData.confirmed;
            liveData.matches[matchIndex].status = parsedData.status;
            liveData.matches[matchIndex].playerStats = parsedData.playerStats;
            
            // Trigger your database save function (assuming you use updateData or similar)
            // updateData(); 
            
            alert(`Match ${matchIndex + 1} updated successfully via RapidAPI!`);
            renderAdmin(); // Refresh the admin UI
        }
    } catch(e) {
        alert("Error parsing JSON. Make sure you copied the entire RapidAPI text perfectly!");
        console.error(e);
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC LINEUPS TAB (THE TRUE CHAMPIONSHIP PAGE WITH PODIUM UI)
// ─────────────────────────────────────────────────────────────────────────────
function renderLineups() {
  const teams = liveData.teams || [];
  const matches = liveData.matches || [];
  const roles = Array.isArray(liveData.playerRoles) ? liveData.playerRoles : [];

  if (teams.length === 0) {
    el('tab-lineups').innerHTML = `<div class="empty-state">No teams have been formed yet.</div>`;
    return;
  }

  // 1. Calculate the XII and Bench for all teams
  const teamLineups = teams.map((t) => {
    let currentSquadPtsHash = 0;
    const playerStats = (t.players || []).map(pName => {
      let totalPts = 0;
      const roleData = roles.find(r => r.name === pName) || { role: 'AR' };
      matches.forEach((m, mi) => {
        if (!m.confirmed || !m.playerStats) return;
        const stat = m.playerStats.find(s => s.name === pName);
        if (stat) totalPts += getTeamPlayerPts(stat, t, m.motm, mi);
      });
      currentSquadPtsHash += totalPts;
      return { 
        name: pName, 
        role: roleData.role, 
        pts: totalPts, 
        isCap: t.captain === pName, 
        isVC: t.viceCaptain === pName, 
        isRep: t.replacement === pName 
      };
    });

    let best12 = [];
    const pointsMatch = t.savedXIIPts !== undefined && Math.abs(t.savedXIIPts - currentSquadPtsHash) < 0.1;

    if (pointsMatch && Array.isArray(t.savedXIIOrder) && t.savedXIIOrder.length > 0) {
      t.savedXIIOrder.forEach(savedName => {
        if (savedName === 'Empty Slot') return;
        const p = playerStats.find(x => x.name === savedName);
        if (p) best12.push(p);
      });
      playerStats.forEach(p => { if (!best12.find(x => x.name === p.name)) best12.push(p); });
    } else {
      const byRole = { BAT: [], BOWL: [], AR: [], WK: [] };
      playerStats.forEach(p => { if (byRole[p.role]) byRole[p.role].push(p); });
      Object.keys(byRole).forEach(r => byRole[r].sort((a, b) => b.pts - a.pts));

      let best11 = null; let maxTotal = -1;
      for (let b = 3; b <= 6; b++) {
        for (let w = 3; w <= 6; w++) {
          for (let a = 1; a <= 4; a++) {
            for (let k = 1; k <= 4; k++) {
              if (b + w + a + k === 11) {
                if (byRole.BAT.length >= b && byRole.BOWL.length >= w && byRole.AR.length >= a && byRole.WK.length >= k) {
                  const xi = [ ...byRole.BAT.slice(0, b), ...byRole.BOWL.slice(0, w), ...byRole.AR.slice(0, a), ...byRole.WK.slice(0, k) ];
                  xi.sort((p1, p2) => p2.pts - p1.pts);
                  let sum = 0; xi.forEach(p => { sum += p.pts; });
                  if (sum > maxTotal) { maxTotal = sum; best11 = xi; }
                }
              }
            }
          }
        }
      }

      if (!best11) best11 = [...playerStats].sort((a,b) => b.pts - a.pts).slice(0, 11);
      const roleOrder = { 'BAT': 1, 'WK': 2, 'AR': 3, 'BOWL': 4, '-': 5 };
      best11.sort((a, b) => {
        if (roleOrder[a.role] !== roleOrder[b.role]) return roleOrder[a.role] - roleOrder[b.role];
        return b.pts - a.pts; 
      });

      const remaining = playerStats.filter(p => !best11.find(x => x.name === p.name));
      remaining.sort((a,b) => b.pts - a.pts); 
      const impact = remaining.length > 0 ? remaining.shift() : null; 

      best12 = [...best11];
      if (impact) best12.push(impact);
      best12.push(...remaining);
    }

    while (best12.length < 12) { 
      best12.push({ name: 'Empty Slot', role: '-', pts: 0, isCap: false, isVC: false, isRep: false }); 
    }
    
    const playingXII = best12.slice(0, 12); 
    const bench = playerStats.filter(p => !playingXII.find(x => x.name === p.name)).sort((a,b) => b.pts - a.pts);
    const top12Pts = playingXII.reduce((sum, p) => sum + p.pts, 0);

    return { teamName: t.name, playingXII: playingXII, bench: bench, totalPts: top12Pts };
  });

  // 2. Sort by highest Playing XII points
  teamLineups.sort((a, b) => b.totalPts - a.totalPts);

  // 3. Reusable Card Template Generator Function
  const buildCardHTML = (data, rank, customStyles = "") => {
    const is1st = rank === 1;
    const is2nd = rank === 2;
    const is3rd = rank === 3;
    
    // Calculate the total points sitting on the bench
    const benchTotal = data.bench.reduce((sum, p) => sum + p.pts, 0);
    
    // Determine distinctive border frames for the podium spots
    let borderStyle = "var(--border)";
    let medalIcon = "";
    if (is1st) { borderStyle = "var(--gold)"; medalIcon = "👑 "; }
    else if (is2nd) { borderStyle = "#9ca3af"; medalIcon = "🥈 "; }
    else if (is3rd) { borderStyle = "#b45309"; medalIcon = "🥉 "; }

    return `
      <div style="background:var(--card); border:1px solid ${borderStyle}; border-radius:8px; padding:1.2rem; box-shadow:0 4px 6px rgba(0,0,0,0.3); ${customStyles}">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:0.75rem; margin-bottom:0.75rem;">
          <div style="font-family:'Bebas Neue'; font-size:1.6rem; color:var(--white); letter-spacing:1px;">
            <span style="color:var(--gray); font-size:1.1rem; margin-right:6px;">#${rank}</span>${medalIcon}${data.teamName}
          </div>
          <div style="font-family:'Rajdhani'; font-weight:700; font-size:1.4rem; color:var(--gold);">${showPts(data.totalPts)} PTS</div>
        </div>
        
        <div style="font-family:'Rajdhani'; font-size:0.75rem; color:#60a5fa; letter-spacing:1px; margin-bottom:0.4rem; margin-top:0.8rem;">PLAYING XII</div>
        <div style="font-size:0.85rem;">
          ${data.playingXII.map((p, idx) => {
            let badge = idx < 11 ? `<span style="color:var(--gold); min-width:22px; display:inline-block;">${idx+1}.</span>` : `<span style="color:#60a5fa; min-width:22px; display:inline-block;">12.</span>`;
            let color = p.role === 'BAT' ? '#60a5fa' : p.role === 'BOWL' ? '#f87171' : p.role === 'AR' ? '#fbbf24' : '#a78bfa';
            
            let nameStr = p.name;
            if (p.isCap) nameStr += ' <span style="color:var(--gold);font-size:0.75rem;">(C)</span>';
            if (p.isVC) nameStr += ' <span style="color:#9ca3af;font-size:0.75rem;">(VC)</span>';
            if (p.isRep) nameStr += ' <span style="color:#60a5fa;font-size:0.75rem;">(R)</span>';
            if (idx === 11 && p.name !== 'Empty Slot') nameStr += ' <span style="color:#60a5fa; font-size:0.65rem; margin-left:4px;">(IMPACT)</span>';
            
            return `
            <div style="display:flex; justify-content:space-between; padding:0.25rem 0; border-bottom:1px solid rgba(255,255,255,0.02);">
              <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${badge} <span style="font-weight:600; color:var(--white);">${nameStr}</span> <span style="font-size:0.65rem; color:${color}; font-weight:700; margin-left:4px;">${p.role}</span></div>
              <div style="color:var(--gray); font-family:'Rajdhani'; font-weight:700; min-width:35px; text-align:right;">${showPts(p.pts)}</div>
            </div>`;
          }).join('')}
        </div>

        <div style="font-family:'Rajdhani'; font-size:0.75rem; color:var(--gray); letter-spacing:1px; margin-bottom:0.4rem; margin-top:1.5rem;">THE BENCH</div>
        <div style="font-size:0.85rem;">
          ${data.bench.length === 0 ? `<div style="color:var(--gray); font-size:0.75rem; font-style:italic;">No players remaining.</div>` : data.bench.map(p => {
            let color = p.role === 'BAT' ? '#60a5fa' : p.role === 'BOWL' ? '#f87171' : p.role === 'AR' ? '#fbbf24' : '#a78bfa';
            return `
            <div style="display:flex; justify-content:space-between; padding:0.25rem 0; border-bottom:1px solid rgba(255,255,255,0.02); opacity:0.6;">
              <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><span style="color:var(--gray); min-width:22px; display:inline-block;">-</span> <span style="font-weight:600; color:var(--gray);">${p.name}</span> <span style="font-size:0.65rem; color:${color}; font-weight:700; margin-left:4px;">${p.role}</span></div>
              <div style="color:var(--gray); font-family:'Rajdhani'; font-weight:700; min-width:35px; text-align:right;">${showPts(p.pts)}</div>
            </div>`;
          }).join('')}
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.5rem; padding-top:0.6rem; border-top:1px dashed rgba(255,255,255,0.15);">
          <div style="font-family:'Rajdhani'; font-size:0.75rem; color:var(--gray); letter-spacing:1px;">BENCH TALLY</div>
          <div style="font-family:'Rajdhani'; font-weight:700; font-size:0.85rem; color:var(--gray);">${showPts(benchTotal)} PTS</div>
        </div>
      </div>`;
  };

  // 4. Extract segments for separate layout handling
  const podiumData = teamLineups.slice(0, 3);
  const remainingData = teamLineups.slice(3);

  // Assemble the HTML for the top 3 podium items with explicit order strings
  let podiumHTML = "";
  if (podiumData.length > 0) {
    podiumHTML = `
      <div style="display:flex; gap:1.5rem; justify-content:center; align-items:flex-end; flex-wrap:wrap; margin-bottom: 3rem; padding: 1rem 0;">
        ${podiumData.map((data, index) => {
          const rank = index + 1;
          if (rank === 1) {
            // 1st Place: Taller elevation, clean drop shadow glow effect, visual order 2
            return buildCardHTML(data, rank, "flex: 1 1 320px; max-width: 400px; order: 2; transform: translateY(-10px); box-shadow: 0 10px 20px rgba(201,168,76,0.15);");
          } else if (rank === 2) {
            // 2nd Place: Left side, visual order 1
            return buildCardHTML(data, rank, "flex: 1 1 300px; max-width: 380px; order: 1;");
          } else if (rank === 3) {
            // 3rd Place: Right side, visual order 3
            return buildCardHTML(data, rank, "flex: 1 1 300px; max-width: 380px; order: 3;");
          }
        }).join('')}
      </div>`;
  }

  let remainingHTML = "";
  if (remainingData.length > 0) {
    remainingHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:1.5rem;">
        ${remainingData.map((data, index) => buildCardHTML(data, index + 4, "flex:1;")).join('')}
      </div>`;
  }

  el('tab-lineups').innerHTML = `
    <div class="page-header" style="margin-bottom:1.5rem;">
      <div>
        <div class="page-title">FINAL LINEUPS & CHAMPIONSHIP STANDINGS</div>
      </div>
    </div>
    ${podiumHTML}
    ${remainingHTML}
  `;
}
  
// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────
el('login-btn').addEventListener('click', tryLogin);
el('login-pass').addEventListener('keydown', e => { if(e.key==='Enter') tryLogin(); });
el('modal-close').addEventListener('click', closeModal);
el('modal-backdrop').addEventListener('click', e => { if(e.target===el('modal-backdrop')) closeModal(); });