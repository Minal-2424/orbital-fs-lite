const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const redis = require("./redisClient");
const { startElection, amILeader } = require("./leader");
const multer = require("multer");
const { LRUCache } = require("lru-cache");
const orbital = require("./orbital");

// ── File-level cache (reconstructed files) ──
const fileCache = new LRUCache({
  max: 20,
  maxSize: 200 * 1024 * 1024,
  sizeCalculation: (v) => v.length,
});

// ── Chunk-level predictive cache (pre-fetched chunks) ──
const chunkCache = new LRUCache({
  max: 100,
  maxSize: 100 * 1024 * 1024,
  sizeCalculation: (v) => v.length,
});

// Stats for demo
const cacheStats = { hits: 0, misses: 0, predictiveHits: 0, prefetched: 0 };

const path = require("path");
const upload = multer({ storage: multer.memoryStorage() });
const app = express();
app.use(express.json({ limit: "200mb" }));

// CORS for dashboard
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Serve dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

const PORT = process.argv[2];
if (!PORT) { console.error("Provide port"); process.exit(1); }

const MASTER_ID = `master-${PORT}`;
startElection(MASTER_ID);

const NODES = [
  "http://localhost:4001",
  "http://localhost:4002",
  "http://localhost:4003",
];

// =============================================
// ALIVE NODE DETECTION
// =============================================
async function getAliveNodes() {
  const now = Date.now();
  const alive = [];
  for (const url of NODES) {
    const nodeId = `node-${url.split(":").pop()}`;
    const lastSeen = await redis.get(`node:${nodeId}`);
    if (lastSeen && now - Number(lastSeen) < 6000) alive.push(url);
  }
  return alive;
}

// =============================================
// 🆕 FEATURE 1: ORBIT-AWARE CHUNK DISTRIBUTION
// =============================================
function selectNodesForChunk(aliveNodes, chunkIndex) {
  const bestPair = orbital.findBestNodePair(aliveNodes);

  if (bestPair) {
    console.log(
      `   🛰️  Orbit-aware: ${bestPair.primarySat} → ${bestPair.replicaSat}` +
      ` | Visible: ✅ | CrossPlane: ${bestPair.crossPlane ? "✅" : "❌"}` +
      ` | Score: ${bestPair.combinedScore}`
    );
    return { primary: bestPair.primary, replica: bestPair.replica, method: "orbit-aware", details: bestPair };
  }

  console.log("   ⚠️  No visible pairs — falling back to round-robin");
  const p = chunkIndex % aliveNodes.length;
  const r = (p + 1) % aliveNodes.length;
  return { primary: aliveNodes[p], replica: aliveNodes[r], method: "round-robin-fallback", details: null };
}

// =============================================
// 🆕 FEATURE 2: PREDICTIVE ORBITAL CACHING
// Pre-fetches chunks from nodes that are:
//   - Entering eclipse with low battery
//   - In radiation zones
//   - Losing ground station contact
// =============================================
async function predictiveCacheRefresh() {
  if (!amILeader()) return;

  const aliveNodes = await getAliveNodes();
  if (aliveNodes.length < 2) return;

  const predictions = orbital.predictUnavailableNodes(aliveNodes);

  if (predictions.length === 0) return;

  console.log("\n🔮 PREDICTIVE CACHING — Threat Detection:");

  for (const pred of predictions) {
    const icon = pred.urgency === "HIGH" ? "🚨" : "⚠️";
    console.log(`   ${icon} ${pred.satelliteId} | Battery: ${pred.battery.toFixed(1)}% | ${pred.sunlit ? "☀️" : "🌑"} | Score: ${pred.energyScore}`);

    for (const reason of pred.reasons) {
      console.log(`      → ${reason.type}: ${reason.detail}`);
    }

    // Only pre-cache for HIGH urgency
    if (pred.urgency !== "HIGH") {
      console.log(`      → Action: MONITORING (not urgent enough to pre-cache)`);
      continue;
    }

    console.log(`      → Action: PRE-CACHING chunks from ${pred.satelliteId}...`);

    // Find all chunks on this node
    const keys = await redis.keys("file:*");
    let cachedCount = 0;

    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const metadata = JSON.parse(raw);

      for (const chunk of metadata.chunks) {
        if (!chunk.nodes || !chunk.nodes.includes(pred.nodeUrl)) continue;

        const cacheKey = chunk.chunkId;
        if (chunkCache.has(cacheKey)) continue;

        try {
          // Fetch from this node before it goes dark
          const resp = await axios.get(
            `${pred.nodeUrl}/chunk/${chunk.chunkId}`,
            { timeout: 2000 }
          );
          const buf = Buffer.from(resp.data.data, "base64");

          // Verify integrity before caching
          const hash = crypto.createHash("sha256").update(buf).digest("hex");
          if (hash === chunk.hash) {
            chunkCache.set(cacheKey, buf);
            cachedCount++;
            cacheStats.prefetched++;
          } else {
            console.log(`      ⚠️ Integrity mismatch on ${chunk.chunkId} — skipped`);
          }
        } catch (err) {
          console.log(`      ❌ Failed to pre-cache ${chunk.chunkId}: ${err.message}`);
        }
      }
    }

    if (cachedCount > 0) {
      console.log(`      ✅ Pre-cached ${cachedCount} chunks from ${pred.satelliteId}`);
    } else {
      console.log(`      ℹ️  No new chunks to cache from ${pred.satelliteId}`);
    }
  }
}

// Run predictive caching every 8 seconds
setInterval(predictiveCacheRefresh, 8000);

// =============================================
// 🆕 FEATURE 3: ENERGY-AWARE REBALANCER
// + PROACTIVE ECLIPSE MIGRATION
// =============================================
async function rebalance() {
  if (!amILeader()) return;

  const aliveNodes = await getAliveNodes();
  if (aliveNodes.length < 2) return;

  // ── Energy Status Log ──
  console.log("\n🔄 Rebalancer — Energy Status:");
  for (const url of aliveNodes) {
    const e = orbital.getEnergyScore(url);
    const pos = orbital.getSatellitePosition(url);
    const icon = e.status === "HEALTHY" ? "🟢" :
                 e.status === "MODERATE" ? "🟡" :
                 e.status === "LOW" ? "🟠" : "🔴";
    const radIcon = pos.radiationSeverity === "HIGH" ? " ☢️" :
                    pos.radiationSeverity === "MEDIUM" ? " ⚡" : "";
    const gsIcon = pos.groundStationVisible ? " 📡" : "";
    console.log(`   ${icon} ${e.satelliteId}: ${e.battery}% | ${e.sunlit ? "☀️ Sunlit" : "🌑 Eclipse"} | Score: ${e.score}${radIcon}${gsIcon}`);
  }

  // ── Proactive Eclipse Migration ──
  const migrationTargets = orbital.getEclipseMigrationTargets(aliveNodes);
  if (migrationTargets.length > 0) {
    console.log("   ⚡ ECLIPSE MIGRATION:");
    for (const target of migrationTargets) {
      console.log(`      ${target.reason}`);
    }
  }

  // ── Standard Rebalancing + Energy-Aware Logic ──
  const keys = await redis.keys("file:*");

  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const metadata = JSON.parse(raw);
    let updated = false;

    for (const chunk of metadata.chunks) {
      if (!chunk.nodes) continue;

      // Remove dead nodes
      chunk.nodes = chunk.nodes.filter(n => aliveNodes.includes(n));

      if (chunk.nodes.length >= 2) {
        // ── Eclipse migration: move data OFF low-energy eclipse nodes ──
        for (const node of chunk.nodes) {
          const e = orbital.getEnergyScore(node);

          // Migrate if critically low OR in eclipse with battery < 30%
          const shouldMigrate = e.status === "CRITICAL" ||
            (!e.sunlit && e.battery < 30);

          if (shouldMigrate) {
            console.log(`   ⚡ ${e.satelliteId} at ${e.battery}% ${e.sunlit ? "☀️" : "🌑"} — migrating chunk ${chunk.chunkId}`);

            // Find healthy sunlit target
            const target = aliveNodes
              .filter(n => !chunk.nodes.includes(n))
              .map(n => ({ url: n, ...orbital.getEnergyScore(n) }))
              .filter(n => n.score > 40)
              .sort((a, b) => b.score - a.score)[0];

            if (target) {
              try {
                const sourceNode = chunk.nodes.find(n => n !== node);
                const resp = await axios.get(`${sourceNode}/chunk/${chunk.chunkId}`);
                await axios.post(`${target.url}/store`, {
                  chunkId: chunk.chunkId,
                  data: resp.data.data,
                });
                chunk.nodes = chunk.nodes.filter(n => n !== node);
                chunk.nodes.push(target.url);
                updated = true;
                console.log(`      ✅ Migrated to ${target.satelliteId} (score: ${target.score})`);
              } catch (err) {
                console.log(`      ❌ Migration failed: ${err.message}`);
              }
            }
          }
        }
        continue;
      }

      if (chunk.nodes.length === 0) {
        console.log(`   🚨 All replicas lost: ${chunk.chunkId}`);
        continue;
      }

      // Re-replicate using orbit-aware + energy-aware selection
      const sourceNode = chunk.nodes[0];
      const candidates = aliveNodes
        .filter(n => !chunk.nodes.includes(n))
        .map(n => {
          const e = orbital.getEnergyScore(n);
          const vis = orbital.getVisibility(sourceNode, n);
          return { url: n, energy: e, visibility: vis };
        })
        .filter(c => c.visibility.visible && c.energy.score > 20)
        .sort((a, b) => b.energy.score - a.energy.score);

      const target = candidates[0];
      if (!target) continue;

      try {
        const resp = await axios.get(`${sourceNode}/chunk/${chunk.chunkId}`);
        await axios.post(`${target.url}/store`, {
          chunkId: chunk.chunkId,
          data: resp.data.data,
        });
        chunk.nodes.push(target.url);
        updated = true;
        console.log(`   🔄 Re-replicated ${chunk.chunkId} → ${target.energy.satelliteId} (visible ✅, score: ${target.energy.score})`);
      } catch (err) {
        console.log(`   ❌ Rebalance failed: ${err.message}`);
      }
    }

    if (updated) await redis.set(key, JSON.stringify(metadata));
  }
}

setInterval(rebalance, 10000);

// =============================================
// UPLOAD — orbit-aware distribution
// =============================================
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!amILeader()) return res.status(403).json({ error: "Not leader" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const storedChunks = [];

  try {
    const aliveNodes = await getAliveNodes();
    if (aliveNodes.length < 2) {
      return res.status(500).json({ error: "Not enough alive nodes for replication" });
    }

    const fileId = uuidv4();
    const filename = req.file.originalname;
    const buffer = req.file.buffer;
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const chunkSize = 1024 * 1024;
    const chunks = [];
    for (let i = 0; i < buffer.length; i += chunkSize) {
      chunks.push(buffer.slice(i, i + chunkSize));
    }

    console.log(`\n📤 UPLOAD: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB, ${chunks.length} chunks)`);
    console.log("━".repeat(60));

    // Show orbital status
    console.log("🛰️  Orbital Status:");
    for (const url of aliveNodes) {
      const pos = orbital.getSatellitePosition(url);
      const e = orbital.getEnergyScore(url);
      const radIcon = pos.radiationSeverity !== "NONE" ? ` ☢️ ${pos.radiationZone}` : "";
      const gsIcon = pos.groundStationVisible ? " 📡" : "";
      console.log(`   ${pos.satelliteId} | ${pos.angle}° | ${pos.sunlit ? "☀️" : "🌑"} | ${e.battery}% | Score: ${e.score}${radIcon}${gsIcon}`);
    }

    const metadata = {
      fileId, filename, fileHash,
      totalChunks: chunks.length,
      uploadTime: new Date().toISOString(),
      chunks: [],
      orbitalInfo: { distributionMethod: "orbit-aware", nodesUsed: [] }
    };

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `${fileId}_chunk_${i}`;
      const hash = crypto.createHash("sha256").update(chunks[i]).digest("hex");

      console.log(`\n   Chunk ${i}/${chunks.length - 1}:`);
      const selection = selectNodesForChunk(aliveNodes, i);

      try {
        await axios.post(`${selection.primary}/store`, { chunkId, data: chunks[i].toString("base64") });
        await axios.post(`${selection.replica}/store`, { chunkId, data: chunks[i].toString("base64") });
        storedChunks.push({ chunkId, nodes: [selection.primary, selection.replica] });
      } catch (err) {
        console.error("   ❌ Replication failed, rolling back...");
        for (const c of storedChunks) {
          for (const n of c.nodes) {
            try { await axios.delete(`${n}/chunk/${c.chunkId}`); } catch (_) {}
          }
        }
        return res.status(500).json({ error: "Upload failed during replication. Rolled back." });
      }

      metadata.chunks.push({
        chunkId, hash,
        nodes: [selection.primary, selection.replica],
        distribution: {
          method: selection.method,
          primarySat: selection.details?.primarySat || "unknown",
          replicaSat: selection.details?.replicaSat || "unknown",
          crossPlane: selection.details?.crossPlane || false,
          score: selection.details?.combinedScore || 0
        }
      });
    }

    const usedNodes = new Set();
    metadata.chunks.forEach(c => c.nodes.forEach(n => usedNodes.add(n)));
    metadata.orbitalInfo.nodesUsed = [...usedNodes].map(url => {
      const pos = orbital.getSatellitePosition(url);
      return { url, satelliteId: pos.satelliteId, planeId: pos.planeId };
    });

    await redis.set(`file:${fileId}`, JSON.stringify(metadata));

    console.log("\n" + "━".repeat(60));
    console.log(`✅ Upload complete: ${fileId}`);
    console.log(`   Chunks: ${chunks.length} | Nodes: ${usedNodes.size} | Method: orbit-aware`);

    return res.json({
      message: "Upload successful", fileId, filename,
      totalChunks: chunks.length, fileHash,
      distribution: metadata.orbitalInfo
    });
  } catch (err) {
    console.error("Upload failed:", err.message);
    return res.status(500).json({ error: "Upload failed" });
  }
});

// =============================================
// DOWNLOAD — with predictive + file cache
// =============================================
app.get("/download/:fileId", async (req, res) => {
  const { fileId } = req.params;
  const t0 = Date.now();

  try {
    console.log(`\n📥 Download: ${fileId}`);

    // ── Check file cache ──
    if (fileCache.has(fileId)) {
      cacheStats.hits++;
      console.log(`⚡ File cache HIT — served in ${Date.now() - t0}ms`);
      const buf = fileCache.get(fileId);
      res.setHeader("Content-Disposition", `attachment; filename="cached_${fileId}"`);
      res.setHeader("Content-Type", "application/octet-stream");
      return res.send(buf);
    }

    cacheStats.misses++;
    console.log("   🌀 Cache MISS — reconstructing from satellites");

    const raw = await redis.get(`file:${fileId}`);
    if (!raw) return res.status(404).json({ error: "File not found" });

    const metadata = JSON.parse(raw);
    const buffers = [];

    for (const chunk of metadata.chunks) {
      let chunkBuf = null;

      // ── Check predictive chunk cache ──
      if (chunkCache.has(chunk.chunkId)) {
        cacheStats.predictiveHits++;
        console.log(`   🔮 PREDICTIVE cache HIT: ${chunk.chunkId} (pre-fetched!)`);
        chunkBuf = chunkCache.get(chunk.chunkId);
      } else {
        // Fetch from nodes — sorted by energy score (prefer healthy)
        const rankedNodes = chunk.nodes
          .map(n => ({ url: n, ...orbital.getEnergyScore(n) }))
          .sort((a, b) => b.score - a.score);

        for (const node of rankedNodes) {
          try {
            const resp = await axios.get(
              `${node.url}/chunk/${chunk.chunkId}`,
              { timeout: 2000 }
            );
            chunkBuf = Buffer.from(resp.data.data, "base64");
            console.log(`   ✅ ${chunk.chunkId} from ${node.satelliteId} (energy: ${node.score})`);
            break;
          } catch (err) {
            console.log(`   ❌ ${chunk.chunkId} failed from ${node.satelliteId}`);
          }
        }
      }

      if (!chunkBuf) {
        console.log(`   🚨 All sources failed: ${chunk.chunkId}`);
        return res.status(500).json({ error: `All sources failed for ${chunk.chunkId}` });
      }

      // Integrity check
      const hash = crypto.createHash("sha256").update(chunkBuf).digest("hex");
      if (hash !== chunk.hash) {
        console.log(`   🚨 SHA-256 INTEGRITY FAILED: ${chunk.chunkId}`);
        return res.status(500).json({ error: "Integrity check failed" });
      }

      buffers.push(chunkBuf);
    }

    const finalBuf = Buffer.concat(buffers);

    // Full file hash verification
    if (metadata.fileHash) {
      const fullHash = crypto.createHash("sha256").update(finalBuf).digest("hex");
      if (fullHash !== metadata.fileHash) {
        console.log("   🚨 Full file SHA-256 FAILED");
        return res.status(500).json({ error: "Full file integrity check failed" });
      }
      console.log("   ✅ Full file SHA-256 integrity verified");
    }

    // Store in file cache
    fileCache.set(fileId, finalBuf);
    console.log(`   💾 Cached | ${(finalBuf.length / 1024 / 1024).toFixed(2)} MB | ${Date.now() - t0}ms`);

    res.setHeader("Content-Disposition", `attachment; filename="${metadata.filename}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(finalBuf);
  } catch (err) {
    console.error("Download failed:", err.message);
    res.status(500).json({ error: "Download failed" });
  }
});

// =============================================
// ORBITAL API ENDPOINTS
// =============================================
app.get("/orbital/status", async (req, res) => {
  const alive = await getAliveNodes();
  res.json(orbital.getConstellationStatus(alive));
});

app.get("/orbital/visibility", async (req, res) => {
  const alive = await getAliveNodes();
  const results = [];
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      results.push(orbital.getVisibility(alive[i], alive[j]));
    }
  }
  res.json(results);
});

app.get("/orbital/energy", async (req, res) => {
  const alive = await getAliveNodes();
  res.json(alive.map(url => orbital.getEnergyScore(url)));
});

app.get("/orbital/predictions", async (req, res) => {
  const alive = await getAliveNodes();
  res.json(orbital.predictUnavailableNodes(alive));
});

// 🆕 Cache statistics endpoint
app.get("/orbital/cache-stats", (req, res) => {
  const total = cacheStats.hits + cacheStats.misses;
  res.json({
    ...cacheStats,
    totalRequests: total,
    hitRate: total > 0 ? `${((cacheStats.hits / total) * 100).toFixed(1)}%` : "0%",
    fileCacheSize: fileCache.size,
    chunkCacheSize: chunkCache.size
  });
});

// =============================================
// STANDARD ENDPOINTS
// =============================================
app.get("/health", (req, res) => {
  res.json({ master: MASTER_ID, leader: amILeader() });
});

app.get("/metadata", async (req, res) => {
  const keys = await redis.keys("file:*");
  const result = [];
  for (const key of keys) {
    const d = await redis.get(key);
    if (d) result.push(JSON.parse(d));
  }
  res.json({ totalFiles: result.length, files: result });
});

app.get("/metadata/:fileId", async (req, res) => {
  const d = await redis.get(`file:${req.params.fileId}`);
  if (!d) return res.status(404).json({ error: "File not found" });
  res.json(JSON.parse(d));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Master ${MASTER_ID} running on ${PORT}`);
  console.log("🛰️  NOVEL FEATURES ACTIVE:");
  console.log("   1️⃣  Orbit-aware chunk distribution (visibility + cross-plane)");
  console.log("   2️⃣  Predictive orbital caching (eclipse + radiation + ground station)");
  console.log("   3️⃣  Energy-aware node selection (solar/battery scoring)");
  console.log("━".repeat(60));
});