# Distributed Load Balancer

A custom HTTP load balancer built from scratch in Node.js with zero dependencies. Features round-robin routing, active health checks, real-time metrics, and a traffic simulator. Deployable both locally via Docker and to the cloud via Render.

---

## Project Layout

```
load-balancer-project/
├── backend/
│   ├── server.js              # HTTP backend server
│   ├── package.json
│   └── Dockerfile
├── loadbalancer/
│   ├── load_balancer_health.js  # Round-robin LB with health checks + metrics API
│   ├── package.json
│   └── Dockerfile
├── simulator/
│   ├── traffic_simulator.js   # Concurrent traffic generator
│   ├── package.json
│   └── Dockerfile
├── dashboard/
│   ├── dashboard.html         # Real-time metrics UI
│   ├── serve.js               # Static file server
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── .dockerignore
└── README.md
```

---

## Architecture

```
Internet / Traffic Simulator
          │
          ▼
  Load Balancer :8080          (Round Robin + Health Checks)
  Metrics API   :8080/metrics  (JSON snapshot)
    ┌─────┼─────┐
    ▼     ▼     ▼
 :5001  :5002  :5003
server1 server2 server3

Dashboard :3000 → polls /metrics → live UI
```

---

## Port Map

| Service        | Local Port | Render URL                                      |
|----------------|------------|-------------------------------------------------|
| server-1       | 5001       | https://lb-backend-server-11.onrender.com       |
| server-2       | 5002       | https://lb-backend-server-2.onrender.com        |
| server-3       | 5003       | https://lb-backend-server-3.onrender.com        |
| load-balancer  | 8080       | https://lb-load-balancer.onrender.com           |
| metrics API    | 8080/metrics | https://lb-load-balancer.onrender.com/metrics |
| dashboard      | 3000       | https://lb-dashboard.onrender.com               |

---

## Environment Variable Reference

### Backend servers
| Variable   | Default   | Description                  |
|------------|-----------|------------------------------|
| `SERVER_ID`| server-1  | Identifier returned in responses |
| `PORT`     | 5001      | Port to listen on            |

### Load balancer
| Variable   | Default        | Description                        |
|------------|----------------|------------------------------------|
| `BACKEND_1`| localhost:5001 | Full URL of backend server 1       |
| `BACKEND_2`| localhost:5002 | Full URL of backend server 2       |
| `BACKEND_3`| localhost:5003 | Full URL of backend server 3       |
| `PORT`     | 8080           | Port for LB + metrics API          |

### Traffic simulator
| Variable          | Default                    | Description              |
|-------------------|----------------------------|--------------------------|
| `TARGET_URL`      | http://localhost:8080      | Load balancer to target  |
| `TOTAL_REQUESTS`  | 1000                       | Total requests to send   |
| `CONCURRENCY`     | 50                         | Max in-flight at once    |

---

## Option A — Run Locally with Docker

### Prerequisites
- Docker Desktop installed and running

### 1. Build all images
```bash
docker-compose build
```

### 2. Start the full stack
```bash
docker-compose up
```

Or detached (background):
```bash
docker-compose up -d
```

### 3. Verify everything is healthy
```bash
docker-compose ps
```

Expected:
```
NAME             STATUS          PORTS
server-1         Up (healthy)    0.0.0.0:5001->5001/tcp
server-2         Up (healthy)    0.0.0.0:5002->5002/tcp
server-3         Up (healthy)    0.0.0.0:5003->5003/tcp
load-balancer    Up (healthy)    0.0.0.0:8080->8080/tcp
dashboard        Up              0.0.0.0:3000->3000/tcp
```

### 4. Test round-robin
```bash
# 9 requests — should rotate across all 3 servers
for i in {1..9}; do curl -s http://localhost:8080 | grep server_id; done
```

### 5. Open the dashboard
```
http://localhost:3000
```

### 6. Run the traffic simulator
```bash
# Default: 1000 requests, 50 concurrent
docker-compose --profile simulator run --rm simulator

# Heavy load: 5000 requests, 100 concurrent
docker-compose --profile simulator run \
  -e TOTAL_REQUESTS=5000 \
  -e CONCURRENCY=100 \
  --rm simulator
```

### 7. Simulate a server failure
```bash
docker stop server-2
# Watch LB logs — server-2 marked DOWN, traffic redistributes with zero failures
docker start server-2
# server-2 automatically rejoins rotation within 3 seconds
```

### Useful Docker commands
```bash
docker-compose logs -f load-balancer   # tail LB logs
docker-compose logs -f server-1        # tail a backend
docker-compose build load-balancer     # rebuild one image
docker-compose down                    # stop everything
docker-compose down --rmi all          # full clean
```

---

## Option B — Deploy to Render (Cloud)

### Prerequisites
- GitHub account with this repo pushed
- Render account at https://render.com (free tier)

### Deploy order
1. Deploy all three backend servers first
2. Deploy the load balancer with backend URLs as env vars
3. Deploy the dashboard

### Backend servers (repeat 3 times)

| Setting          | server-1                    | server-2                    | server-3                    |
|------------------|-----------------------------|-----------------------------|-----------------------------|
| Name             | lb-backend-server-1         | lb-backend-server-2         | lb-backend-server-3         |
| Root Directory   | `backend`                   | `backend`                   | `backend`                   |
| Start Command    | `node server.js server-1 $PORT` | `node server.js server-2 $PORT` | `node server.js server-3 $PORT` |
| Env: SERVER_ID   | `server-1`                  | `server-2`                  | `server-3`                  |

### Load balancer

| Setting         | Value                          |
|-----------------|--------------------------------|
| Name            | `lb-load-balancer`             |
| Root Directory  | `loadbalancer`                 |
| Start Command   | `node load_balancer_health.js` |
| Env: BACKEND_1  | https://lb-backend-server-1.onrender.com |
| Env: BACKEND_2  | https://lb-backend-server-2.onrender.com |
| Env: BACKEND_3  | https://lb-backend-server-3.onrender.com |

### Dashboard

| Setting        | Value            |
|----------------|------------------|
| Name           | `lb-dashboard`   |
| Root Directory | `dashboard`      |
| Start Command  | `node serve.js`  |

### Test the live deployment
```powershell
# Single request through the load balancer
curl https://lb-load-balancer.onrender.com

# Round robin check — 6 requests
for ($i=1; $i -le 6; $i++) {
    curl https://lb-load-balancer.onrender.com
    Start-Sleep -Milliseconds 300
}

# Live metrics JSON
curl https://lb-load-balancer.onrender.com/metrics
```

### Run simulator against live Render deployment (from local machine)
```powershell
cd simulator
$env:TARGET_URL = "https://lb-load-balancer.onrender.com"
node traffic_simulator.js 500 20
```

### Test failover on Render
1. Go to Render dashboard → click a backend service → click **Suspend**
2. Watch the load balancer logs — server marked DOWN within 3-5 seconds
3. All traffic seamlessly redirects to remaining backends, zero failures
4. Click **Resume** — server rejoins rotation automatically

---

## Key Features

- **Zero dependencies** — built entirely on Node.js built-in modules (`http`, `https`, `url`)
- **Round Robin routing** — even traffic distribution across all live backends
- **Active health checks** — pings every backend every 3 seconds, removes dead servers instantly
- **Automatic failover** — failed requests retry on next live backend transparently
- **Auto-restart** — Docker `restart: unless-stopped` and Render auto-restart keep services running
- **Real-time dashboard** — live bar charts, latency tracking, UP/DOWN badges, event log
- **Cloud-ready** — HTTPS support, Render `$PORT` env var, env-configurable backend URLs