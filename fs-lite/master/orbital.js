// orbital.js — Orbital Simulation for COSMEON FS-LITE
// Simulates satellite positions, visibility, energy, and radiation zones

const EARTH_RADIUS = 6371; // km
const ORBIT_ALTITUDE = 550; // km (LEO, similar to Starlink)
const ORBIT_RADIUS = EARTH_RADIUS + ORBIT_ALTITUDE;
const SPEED_MULTIPLIER = 60; // 1 real second = 60 simulated seconds

// ========================
// SATELLITE NODE DEFINITIONS
// ========================
const SATELLITE_CONFIG = {
  "http://localhost:4001": {
    id: "SAT-ALPHA",
    orbitPeriod: 5400,
    orbitOffset: 0,
    inclination: 53,
    planeId: "PLANE-A",
    batteryCapacity: 100,
    solarPanelEfficiency: 0.3,
    port: 4001
  },
  "http://localhost:4002": {
    id: "SAT-BETA",
    orbitPeriod: 5400,
    orbitOffset: (2 * Math.PI) / 3,
    inclination: 53,
    planeId: "PLANE-B",
    batteryCapacity: 100,
    solarPanelEfficiency: 0.3,
    port: 4002
  },
  "http://localhost:4003": {
    id: "SAT-GAMMA",
    orbitPeriod: 5400,
    orbitOffset: (4 * Math.PI) / 3,
    inclination: 53,
    planeId: "PLANE-C",
    batteryCapacity: 100,
    solarPanelEfficiency: 0.3,
    port: 4003
  }
};

// ========================
// RADIATION ZONES
// ========================
const RADIATION_ZONES = [
  { name: "South Atlantic Anomaly", angleStart: 200, angleEnd: 320, severity: "HIGH" },
  { name: "Polar Region North", angleStart: 80, angleEnd: 100, severity: "MEDIUM" },
  { name: "Polar Region South", angleStart: 260, angleEnd: 280, severity: "MEDIUM" }
];

// ========================
// GROUND STATION (for ground-to-satellite visibility)
// ========================
const GROUND_STATION = {
  name: "COSMEON-GS-India",
  angleFOV: 75, // field of view: satellite visible within ±75° of ground station
  position: 0   // reference angle
};

// In-memory energy state
const energyState = {};

function initEnergy() {
  for (const [url, config] of Object.entries(SATELLITE_CONFIG)) {
    energyState[url] = {
      battery: 85 + Math.random() * 15,
      lastUpdate: Date.now()
    };
  }
}
initEnergy();

// ========================
// CORE: Get satellite position at a given time
// ========================
function getSatellitePosition(nodeUrl, timestamp = null) {
  const config = SATELLITE_CONFIG[nodeUrl];
  if (!config) return null;

  const t = timestamp || Date.now();
  const simTime = (t / 1000) * SPEED_MULTIPLIER;

  const angle = ((2 * Math.PI * simTime) / config.orbitPeriod + config.orbitOffset) % (2 * Math.PI);
  const angleDeg = ((angle * 180) / Math.PI) % 360;

  const x = ORBIT_RADIUS * Math.cos(angle);
  const y = ORBIT_RADIUS * Math.sin(angle);

  // Sunlit if angle 0-180°
  const sunlit = angleDeg >= 0 && angleDeg < 180;

  // Check radiation zone
  let radiationZone = null;
  for (const zone of RADIATION_ZONES) {
    if (angleDeg >= zone.angleStart && angleDeg <= zone.angleEnd) {
      radiationZone = zone;
      break;
    }
  }

  // Ground station visibility
  let gsAngleDiff = Math.abs(angleDeg - GROUND_STATION.position);
  if (gsAngleDiff > 180) gsAngleDiff = 360 - gsAngleDiff;
  const groundVisible = gsAngleDiff < GROUND_STATION.angleFOV;

  return {
    nodeUrl,
    satelliteId: config.id,
    planeId: config.planeId,
    angle: Number(angleDeg.toFixed(2)),
    angleRad: Number(angle.toFixed(4)),
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    sunlit,
    radiationZone: radiationZone ? radiationZone.name : "Safe",
    radiationSeverity: radiationZone ? radiationZone.severity : "NONE",
    groundStationVisible: groundVisible,
    timestamp: t
  };
}

// ========================
// VISIBILITY: Can two satellites see each other?
// ========================
function getVisibility(nodeUrl1, nodeUrl2, timestamp = null) {
  const pos1 = getSatellitePosition(nodeUrl1, timestamp);
  const pos2 = getSatellitePosition(nodeUrl2, timestamp);
  if (!pos1 || !pos2) return { visible: false, reason: "Unknown node" };

  let angleDiff = Math.abs(pos1.angle - pos2.angle);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;

  const visible = angleDiff < 160;
  const latency = Number((angleDiff * 2.5).toFixed(1));

  return {
    node1: { url: nodeUrl1, id: pos1.satelliteId, angle: pos1.angle },
    node2: { url: nodeUrl2, id: pos2.satelliteId, angle: pos2.angle },
    angleBetween: Number(angleDiff.toFixed(2)),
    visible,
    estimatedLatency: latency,
    reason: visible ? "Line of sight clear" : "Earth blocking communication"
  };
}

// ========================
// ENERGY: Simulate battery drain and solar charging
// ========================
function updateEnergy(nodeUrl) {
  const config = SATELLITE_CONFIG[nodeUrl];
  if (!config || !energyState[nodeUrl]) return null;

  const pos = getSatellitePosition(nodeUrl);
  const state = energyState[nodeUrl];
  const elapsed = (Date.now() - state.lastUpdate) / 1000;
  const cappedElapsed = Math.min(elapsed, 15);

  if (pos.sunlit) {
    state.battery = Math.min(100, state.battery + cappedElapsed * 0.08);
  } else {
    state.battery = Math.max(5, state.battery - cappedElapsed * 0.03);
  }

  state.lastUpdate = Date.now();
  return state.battery;
}

function getEnergyScore(nodeUrl) {
  const pos = getSatellitePosition(nodeUrl);
  if (!pos) return { nodeUrl, score: 0, status: "UNKNOWN" };

  updateEnergy(nodeUrl);
  const battery = energyState[nodeUrl].battery;

  let score = battery;
  if (pos.sunlit) score += 20;
  if (battery < 20) score -= 50;
  if (battery < 10) score -= 100;
  if (pos.radiationSeverity === "HIGH") score -= 15;

  return {
    nodeUrl,
    satelliteId: pos.satelliteId,
    battery: Number(battery.toFixed(1)),
    sunlit: pos.sunlit,
    radiationZone: pos.radiationZone,
    radiationSeverity: pos.radiationSeverity,
    groundStationVisible: pos.groundStationVisible,
    score: Number(Math.max(0, Math.min(100, score)).toFixed(1)),
    status: battery < 10 ? "CRITICAL" : battery < 25 ? "LOW" : battery < 50 ? "MODERATE" : "HEALTHY"
  };
}

// ========================
// ORBIT-AWARE DISTRIBUTION: Pick best node pair
// ========================
function findBestNodePair(aliveNodes) {
  const pairs = [];

  for (let i = 0; i < aliveNodes.length; i++) {
    for (let j = i + 1; j < aliveNodes.length; j++) {
      const vis = getVisibility(aliveNodes[i], aliveNodes[j]);
      const e1 = getEnergyScore(aliveNodes[i]);
      const e2 = getEnergyScore(aliveNodes[j]);

      if (!vis.visible) continue;
      if (e1.score < 15 || e2.score < 15) continue;

      const config1 = SATELLITE_CONFIG[aliveNodes[i]];
      const config2 = SATELLITE_CONFIG[aliveNodes[j]];
      const crossPlane = config1.planeId !== config2.planeId;

      const combinedScore =
        (e1.score + e2.score) / 2 +
        (crossPlane ? 20 : 0) -
        vis.estimatedLatency / 10;

      pairs.push({
        primary: aliveNodes[i],
        replica: aliveNodes[j],
        primarySat: e1.satelliteId,
        replicaSat: e2.satelliteId,
        primaryEnergy: e1,
        replicaEnergy: e2,
        visibility: vis,
        crossPlane,
        combinedScore: Number(combinedScore.toFixed(2))
      });
    }
  }

  pairs.sort((a, b) => b.combinedScore - a.combinedScore);
  return pairs.length > 0 ? pairs[0] : null;
}

// ========================
// PREDICTIVE CACHING: Multi-signal prediction
// Checks: eclipse transitions, energy depletion,
// ground station loss, radiation zone entry
// ========================
function predictUnavailableNodes(aliveNodes, lookaheadMinutes = 30) {
  const predictions = [];
  const now = Date.now();

  for (const nodeUrl of aliveNodes) {
    const currentPos = getSatellitePosition(nodeUrl, now);
    const currentEnergy = getEnergyScore(nodeUrl);
    const reasons = [];

    // ── Signal 1: Eclipse transition (entering dark side soon) ──
    let eclipseInMinutes = null;
    if (currentPos.sunlit) {
      // Check when this satellite enters eclipse
      for (let min = 1; min <= lookaheadMinutes; min++) {
        const futureTime = now + (min * 60 * 1000) / SPEED_MULTIPLIER;
        const futurePos = getSatellitePosition(nodeUrl, futureTime);
        if (!futurePos.sunlit) {
          eclipseInMinutes = min;
          break;
        }
      }
      if (eclipseInMinutes !== null && eclipseInMinutes <= 15) {
        reasons.push({
          type: "ECLIPSE_APPROACHING",
          detail: `Entering eclipse in ~${eclipseInMinutes} simulated minutes`,
          minutesUntil: eclipseInMinutes
        });
      }
    }

    // ── Signal 2: Already in eclipse with draining battery ──
    if (!currentPos.sunlit && currentEnergy.battery < 50) {
      reasons.push({
        type: "ECLIPSE_LOW_BATTERY",
        detail: `In eclipse with ${currentEnergy.battery}% battery — draining`,
        battery: currentEnergy.battery
      });
    }

    // ── Signal 3: Entering radiation zone soon ──
    let radiationInMinutes = null;
    if (currentPos.radiationSeverity === "NONE") {
      for (let min = 1; min <= lookaheadMinutes; min++) {
        const futureTime = now + (min * 60 * 1000) / SPEED_MULTIPLIER;
        const futurePos = getSatellitePosition(nodeUrl, futureTime);
        if (futurePos.radiationSeverity === "HIGH") {
          radiationInMinutes = min;
          break;
        }
      }
      if (radiationInMinutes !== null && radiationInMinutes <= 15) {
        reasons.push({
          type: "RADIATION_ZONE_APPROACHING",
          detail: `Entering ${RADIATION_ZONES[0].name} in ~${radiationInMinutes} simulated minutes`,
          minutesUntil: radiationInMinutes
        });
      }
    }

    // ── Signal 4: Currently in radiation zone ──
    if (currentPos.radiationSeverity === "HIGH") {
      reasons.push({
        type: "IN_RADIATION_ZONE",
        detail: `Currently in ${currentPos.radiationZone} — data at risk`,
        zone: currentPos.radiationZone
      });
    }

    // ── Signal 5: Ground station visibility loss ──
    let gsLossInMinutes = null;
    if (currentPos.groundStationVisible) {
      for (let min = 1; min <= lookaheadMinutes; min++) {
        const futureTime = now + (min * 60 * 1000) / SPEED_MULTIPLIER;
        const futurePos = getSatellitePosition(nodeUrl, futureTime);
        if (!futurePos.groundStationVisible) {
          gsLossInMinutes = min;
          break;
        }
      }
      if (gsLossInMinutes !== null && gsLossInMinutes <= 10) {
        reasons.push({
          type: "GROUND_STATION_LOSS",
          detail: `Losing ground station contact in ~${gsLossInMinutes} simulated minutes`,
          minutesUntil: gsLossInMinutes
        });
      }
    }

    // ── Signal 6: Low energy score overall ──
    if (currentEnergy.score < 40) {
      reasons.push({
        type: "LOW_ENERGY_SCORE",
        detail: `Energy score ${currentEnergy.score} — below safe threshold`,
        score: currentEnergy.score
      });
    }

    // Build prediction if any signals triggered
    if (reasons.length > 0) {
      const urgency = reasons.some(r =>
        r.type === "ECLIPSE_LOW_BATTERY" ||
        r.type === "IN_RADIATION_ZONE" ||
        r.type === "LOW_ENERGY_SCORE"
      ) ? "HIGH" : "MEDIUM";

      predictions.push({
        nodeUrl,
        satelliteId: currentPos.satelliteId,
        currentAngle: currentPos.angle,
        sunlit: currentPos.sunlit,
        battery: currentEnergy.battery,
        energyScore: currentEnergy.score,
        radiationZone: currentPos.radiationZone,
        groundStationVisible: currentPos.groundStationVisible,
        reasons,
        urgency,
        recommendation: urgency === "HIGH" ? "PRE_CACHE_NOW" : "MONITOR_AND_PREPARE"
      });
    }
  }

  predictions.sort((a, b) => {
    if (a.urgency === "HIGH" && b.urgency !== "HIGH") return -1;
    if (b.urgency === "HIGH" && a.urgency !== "HIGH") return 1;
    return a.energyScore - b.energyScore;
  });

  return predictions;
}

// ========================
// ECLIPSE MIGRATION: Find nodes entering eclipse
// that should have data pre-migrated
// ========================
function getEclipseMigrationTargets(aliveNodes) {
  const targets = [];

  for (const nodeUrl of aliveNodes) {
    const pos = getSatellitePosition(nodeUrl);
    const energy = getEnergyScore(nodeUrl);

    // Already in eclipse with moderate-low battery
    if (!pos.sunlit && energy.battery < 40) {
      // Find best sunlit node to migrate TO
      const sunlitNodes = aliveNodes
        .filter(n => n !== nodeUrl)
        .map(n => ({ url: n, ...getEnergyScore(n) }))
        .filter(n => n.sunlit && n.score > 50)
        .sort((a, b) => b.score - a.score);

      if (sunlitNodes.length > 0) {
        targets.push({
          fromNode: nodeUrl,
          fromSat: energy.satelliteId,
          fromBattery: energy.battery,
          fromSunlit: false,
          toNode: sunlitNodes[0].url,
          toSat: sunlitNodes[0].satelliteId,
          toScore: sunlitNodes[0].score,
          reason: `${energy.satelliteId} in eclipse at ${energy.battery}% — migrate to sunlit ${sunlitNodes[0].satelliteId}`
        });
      }
    }
  }

  return targets;
}

// ========================
// CONSTELLATION STATUS: Full dashboard snapshot
// ========================
function getConstellationStatus(aliveNodeUrls = []) {
  const satellites = [];

  for (const [url, config] of Object.entries(SATELLITE_CONFIG)) {
    const pos = getSatellitePosition(url);
    const energy = getEnergyScore(url);
    const alive = aliveNodeUrls.includes(url);

    satellites.push({
      url,
      ...pos,
      ...energy,
      alive,
      planeId: config.planeId
    });
  }

  const urls = Object.keys(SATELLITE_CONFIG);
  const visibility = [];
  for (let i = 0; i < urls.length; i++) {
    for (let j = i + 1; j < urls.length; j++) {
      visibility.push(getVisibility(urls[i], urls[j]));
    }
  }

  const predictions = predictUnavailableNodes(aliveNodeUrls);
  const eclipseMigrations = getEclipseMigrationTargets(aliveNodeUrls);

  return {
    satellites,
    visibility,
    predictions,
    eclipseMigrations,
    groundStation: GROUND_STATION,
    timestamp: Date.now()
  };
}

module.exports = {
  SATELLITE_CONFIG,
  GROUND_STATION,
  getSatellitePosition,
  getVisibility,
  getEnergyScore,
  updateEnergy,
  findBestNodePair,
  predictUnavailableNodes,
  getEclipseMigrationTargets,
  getConstellationStatus,
  energyState,
  initEnergy,
  SPEED_MULTIPLIER
};