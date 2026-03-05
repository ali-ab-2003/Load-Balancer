# Distributed Load Balancer — Docker Setup

Full containerized system: 3 Node.js backends, a round-robin load balancer
with active health checks, a real-time metrics dashboard, and a traffic simulator.

## Project Layout

```
loadbalancer-docker/
├── backend/
│   ├── Dockerfile
│   └── server.js
├── loadbalancer/
│   ├── Dockerfile
│   └── load_balancer_health.js
├── simulator/
│   ├── Dockerfile
│   └── traffic_simulator.js
├── dashboard/
│   ├── Dockerfile
│   └── dashboard.html
├── docker-compose.yml
└── .dockerignore
```

## Port Map

| Service       | Container Port | Host Port | URL                          |
|---------------|----------------|-----------|------------------------------|
| server-1      | 5001           | 5001      | http://localhost:5001        |
| server-2      | 5002           | 5002      | http://localhost:5002        |
| server-3      | 5003           | 5003      | http://localhost:5003        |
| load-balancer | 8080           | 8080      | http://localhost:8080        |
| metrics API   | 8090           | 8090      | http://localhost:8090/metrics|
| dashboard     | 3000           | 3000      | http://localhost:3000        |

---

## Quick Start

### 1. Build all images
```bash
docker-compose build
```

### 2. Start the full stack (backends + LB + dashboard)
```bash
docker-compose up
```

Or run detached (background):
```bash
docker-compose up -d
```

### 3. Verify everything is up
```bash
docker-compose ps
```

Expected output:
```
NAME             STATUS          PORTS
server-1         Up (healthy)    0.0.0.0:5001->5001/tcp
server-2         Up (healthy)    0.0.0.0:5002->5002/tcp
server-3         Up (healthy)    0.0.0.0:5003->5003/tcp
load-balancer    Up (healthy)    0.0.0.0:8080->8080/tcp, 0.0.0.0:8090->8090/tcp
dashboard        Up              0.0.0.0:3000->3000/tcp
```

---

## Testing

### Hit the load balancer directly
```bash
# Single request
curl http://localhost:8080

# Watch round-robin — 9 requests, confirm 3 servers take turns
for i in {1..9}; do curl -s http://localhost:8080 | grep server_id; done
```

### Check raw metrics JSON
```bash
curl http://localhost:8090/metrics
```

### Open the live dashboard
```
http://localhost:3000
```

---

## Running the Traffic Simulator

The simulator is a one-shot container controlled with a Docker Compose profile.

### Default (1000 requests, 50 concurrent)
```bash
docker-compose --profile simulator run --rm simulator
```

### Custom load
```bash
# 5000 requests, 100 concurrent
docker-compose --profile simulator run \
  -e TOTAL_REQUESTS=5000 \
  -e CONCURRENCY=100 \
  --rm simulator
```

Run the simulator in one terminal while watching the dashboard at
http://localhost:3000 — you'll see the bar charts and counters updating live.

---

## Simulating a Server Failure

While the stack is running, kill a backend:
```bash
docker stop server-2
```

Within ~3 seconds the load balancer's health check fires. You'll see in the
load balancer logs:
```
[DOWN   ] server-2 is UNREACHABLE ✗
```

The dashboard badge for server-2 flips to DOWN and traffic redistributes
between server-1 and server-3. No requests fail.

Bring it back:
```bash
docker start server-2
```
Within ~3 seconds:
```
[UP     ] server-2 is back ONLINE ✓
```

---

## Auto-Restart Behaviour

`restart: unless-stopped` is set on all core services. If a container crashes
Docker restarts it automatically. Test it:

```bash
# Simulate a crash — Docker restarts it within seconds
docker kill server-1
docker-compose ps   # watch server-1 restart
```

---

## Useful Commands

```bash
# Tail logs for a specific service
docker-compose logs -f load-balancer
docker-compose logs -f server-1

# Rebuild a single image after code changes
docker-compose build load-balancer
docker-compose up -d --no-deps load-balancer

# Scale backends (e.g. add a 4th instance on port 5004)
# Edit docker-compose.yml and add server-4, then:
docker-compose up -d

# Stop everything and remove containers
docker-compose down

# Stop and also delete volumes/images (full clean)
docker-compose down --rmi all
```

---

## Environment Variable Reference

### Backend servers
| Variable  | Default   | Description           |
|-----------|-----------|-----------------------|
| SERVER_ID | server-1  | Identifier in responses |
| PORT      | 5001      | Port to listen on     |

### Load balancer
| Variable  | Default              | Description                        |
|-----------|----------------------|------------------------------------|
| BACKENDS  | localhost:5001-5003  | JSON array of backend descriptors  |

### Traffic simulator
| Variable        | Default                    | Description              |
|-----------------|----------------------------|--------------------------|
| TARGET_URL      | http://load-balancer:8080  | Where to send traffic    |
| TOTAL_REQUESTS  | 1000                       | Total requests to send   |
| CONCURRENCY     | 50                         | Max in-flight at once    |
