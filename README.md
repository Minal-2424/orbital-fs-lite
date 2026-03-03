# COSMEON FS-LITE: Distributed File System with Orbital Intelligence

A distributed file system with advanced orbital simulation, predictive caching, and energy-aware node selection. Built for high availability and performance in dynamic satellite networks.

## 🚀 Features

### Core Distributed File System
- **Multi-node storage** with automatic replication (2 replicas per chunk)
- **Leader election** using Redis for high availability
- **Chunk-based storage** with SHA-256 integrity verification
- **File reconstruction** from distributed chunks
- **Automatic rebalancing** when nodes go offline

### 🛰️ Orbital Intelligence (NOVEL FEATURES)
1. **Orbit-Aware Chunk Distribution**
   - Distributes chunks based on satellite visibility
   - Prefers cross-plane replication for fault tolerance
   - Considers line-of-sight communication constraints

2. **Predictive Orbital Caching**
   - Pre-fetches data from satellites entering eclipse
   - Monitors radiation zone exposure
   - Tracks ground station visibility loss
   - Proactive data migration before node unavailability

3. **Energy-Aware Node Selection**
   - Solar panel efficiency simulation
   - Battery level monitoring and scoring
   - Eclipse detection and energy drain modeling
   - Radiation zone impact on node reliability

## 📋 System Requirements

- **Node.js** 16+ (recommended: 18+)
- **Redis** (for leader election and metadata storage)
- **Port availability** for 3 storage nodes and 1 master

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Storage Node  │    │   Storage Node  │    │   Storage Node  │
│     (4001)      │    │     (4002)      │    │     (4003)      │
│                 │    │                 │    │                 │
│ • Chunk Storage │    │ • Chunk Storage │    │ • Chunk Storage │
│ • Heartbeat     │    │ • Heartbeat     │    │ • Heartbeat     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │     Master      │
                    │   (Port 3000)   │
                    │                 │
                    │ • Leader Election│
                    │ • File Upload   │
                    │ • File Download │
                    │ • Rebalancing   │
                    │ • Orbital Logic │
                    └─────────────────┘
                                 │
                    ┌─────────────────┐
                    │      Redis      │
                    │   (Metadata)    │
                    └─────────────────┘
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Install master dependencies
cd fs-lite/master
npm install

# Install node dependencies
cd ../node
npm install
```

### 2. Start Redis Server

```bash
# Start Redis (default port 6379)
redis-server

# Or with custom config
redis-server /path/to/redis.conf
```

### 3. Launch Storage Nodes

Open 3 terminal windows and run each command:

```bash
# Terminal 1: Storage Node 1
cd fs-lite/node
node server.js 4001

# Terminal 2: Storage Node 2
cd fs-lite/node
node server.js 4002

# Terminal 3: Storage Node 3
cd fs-lite/node
node server.js 4003
```

### 4. Launch Master Server

Open a 4th terminal:

```bash
cd fs-lite/master
node server.js 3000
```

## 📁 Project Structure

```
fs-lite/
├── master/
│   ├── server.js          # Master server with orbital logic
│   ├── orbital.js         # Orbital simulation engine
│   ├── leader.js          # Leader election logic
│   ├── redisClient.js     # Redis connection
│   └── package.json
├── node/
│   ├── server.js          # Storage node server
│   ├── storage-4001/      # Chunk storage for node 1
│   ├── storage-4002/      # Chunk storage for node 2
│   ├── storage-4003/      # Chunk storage for node 3
│   └── package.json
└── README.md
```

## 🎮 API Endpoints

### Master Server (Port 3000)

#### File Operations
- `POST /upload` - Upload a file (multipart form)
- `GET /download/:fileId` - Download a file
- `GET /metadata` - List all files
- `GET /metadata/:fileId` - Get file metadata

#### Orbital Intelligence
- `GET /orbital/status` - Full constellation status
- `GET /orbital/visibility` - Satellite visibility matrix
- `GET /orbital/energy` - Energy scores for all nodes
- `GET /orbital/predictions` - Predictive unavailability alerts
- `GET /orbital/cache-stats` - Cache performance statistics

#### Health & Monitoring
- `GET /health` - Master health status
- `GET /metadata` - File system metadata

### Storage Nodes (Ports 4001, 4002, 4003)

- `POST /store` - Store a chunk
- `GET /chunk/:chunkId` - Retrieve a chunk
- `DELETE /chunk/:chunkId` - Delete a chunk
- `GET /health` - Node health status

## 🧪 Testing the System

### 1. Upload a File

```bash
# Upload a test file
curl -X POST \
  -F "file=@/path/to/your/file.txt" \
  http://localhost:3000/upload
```

### 2. Download a File

```bash
# Download using the fileId from upload response
curl -O http://localhost:3000/download/your-file-id
```

### 3. Check System Status

```bash
# View constellation status
curl http://localhost:3000/orbital/status | jq

# Check cache statistics
curl http://localhost:3000/orbital/cache-stats | jq

# View energy scores
curl http://localhost:3000/orbital/energy | jq
```

## 🛰️ Orbital Simulation Details

### Satellite Configuration
- **Orbit Altitude**: 550 km (LEO)
- **Orbit Period**: 90 minutes (simulated)
- **Inclination**: 53°
- **3 Planes**: A, B, C with 120° offset

### Energy Model
- **Battery Capacity**: 100 units
- **Solar Charging**: +0.08 units/sec in sunlight
- **Battery Drain**: -0.03 units/sec in eclipse
- **Critical Threshold**: <10% battery

### Radiation Zones
- **South Atlantic Anomaly**: High severity
- **Polar Regions**: Medium severity
- **Safe Zones**: No impact

### Ground Station
- **Location**: India (0° reference)
- **Field of View**: ±75°
- **Purpose**: Ground-to-satellite communication

## 🔮 Predictive Features

### Eclipse Prediction
The system predicts when satellites will enter eclipse and proactively:
- Pre-fetches data from nodes about to go dark
- Migrates data from low-battery eclipse nodes
- Updates cache with high-priority chunks

### Radiation Zone Monitoring
- Tracks satellite position relative to radiation zones
- Reduces reliability score for nodes in high-radiation areas
- Triggers data migration from affected nodes

### Energy-Aware Selection
- Prefers nodes with high battery levels
- Avoids nodes in eclipse with low energy
- Considers solar panel efficiency and sunlit status

## 📊 Monitoring and Logs

### Master Server Logs
```
🚀 Master master-3000 running on 3000
🛰️  NOVEL FEATURES ACTIVE:
   1️⃣  Orbit-aware chunk distribution (visibility + cross-plane)
   2️⃣  Predictive orbital caching (eclipse + radiation + ground station)
   3️⃣  Energy-aware node selection (solar/battery scoring)
```

### Storage Node Logs
```
🚀 Storage Node node-4001 running on port 4001
✅ Connected to Redis
```

### Real-time Monitoring
- **Cache Hit Rate**: File and chunk cache performance
- **Energy Scores**: Real-time battery and solar status
- **Visibility Matrix**: Line-of-sight communication status
- **Predictions**: Upcoming node unavailability alerts

## 🔧 Configuration

### Port Configuration
Edit the startup commands to use different ports:

```bash
# Master (change 3000 to desired port)
node server.js 3000

# Storage nodes (change 4001, 4002, 4003)
node server.js 4001
node server.js 4002
node server.js 4003
```

### Redis Configuration
Modify `fs-lite/master/redisClient.js` for custom Redis settings:

```javascript
const client = createClient({
  url: 'redis://localhost:6379'
});
```

### Orbital Parameters
Edit `fs-lite/master/orbital.js` to modify satellite parameters:

```javascript
const ORBIT_ALTITUDE = 550; // Change orbit height
const SPEED_MULTIPLIER = 60; // Change simulation speed
```

## 🚨 Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Check which process is using the port
   lsof -i :3000
   
   # Kill the process
   kill -9 <PID>
   ```

2. **Redis Connection Failed**
   ```bash
   # Start Redis server
   redis-server
   
   # Check Redis status
   redis-cli ping
   ```

3. **Storage Directory Permissions**
   ```bash
   # Ensure write permissions
   chmod 755 fs-lite/node/storage-*
   ```

4. **Node.js Version Issues**
   ```bash
   # Check Node.js version
   node --version
   
   # Update if needed
   npm install -g n
   n stable
   ```

### Health Checks

```bash
# Check all services
curl http://localhost:3000/health
curl http://localhost:4001/health
curl http://localhost:4002/health
curl http://localhost:4003/health

# Check Redis
redis-cli ping
```

## 📈 Performance Optimization

### Cache Tuning
- **File Cache**: 20 files, 200MB max
- **Chunk Cache**: 100 chunks, 100MB max
- **Adjust in server.js** for different workloads

### Network Optimization
- **Timeout**: 2 seconds for chunk operations
- **Heartbeat**: 3 seconds for node health
- **Rebalance**: 10 seconds for automatic recovery

### Simulation Speed
- **Default**: 1 real second = 60 simulated seconds
- **Adjust SPEED_MULTIPLIER** in orbital.js for faster/slower simulation

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Built with Node.js and Express
- Redis for distributed coordination
- Multer for file upload handling
- LRU Cache for performance optimization

## 📞 Support

For questions and support, please open an issue in the repository.