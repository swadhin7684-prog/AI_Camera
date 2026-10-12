import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.database.db import init_db, cleanup_expired_data
from backend.database.admin_db import init_admin_db
from backend.services.camera_service import camera_service
from backend.api.routes import router as api_router
from backend.api.admin_routes import router as admin_router, license_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("sentinelx.main")

from backend.paths import DATA_DIR, ensure_data_directories, get_alarm_dir, get_frontend_dist_dir
ensure_data_directories()

# Background telemetry broadcaster for real-time WebSocket updates
async def telemetry_broadcast_task():
    was_active = False
    while True:
        try:
            if camera_service.ws_clients:
                if camera_service.is_active:
                    was_active = True
                    await camera_service.broadcast_ws()
                elif was_active:
                    # Transition to inactive: send stopped payload to all clients
                    was_active = False
                    await camera_service.broadcast_ws()
        except Exception as e:
            logger.debug(f"Broadcast error: {e}")
        await asyncio.sleep(0.1)  # 10 Hz telemetry updates

# Periodic 24-Hour FIFO retention cleanup loop (runs every 10 minutes)
async def periodic_fifo_cleanup_task():
    while True:
        try:
            await asyncio.sleep(600)  # Every 10 minutes
            res = cleanup_expired_data(retention_hours=24.0, max_fifo_records=500)
            if res.get("deleted_incidents", 0) > 0 or res.get("deleted_alerts", 0) > 0 or res.get("deleted_snapshots", 0) > 0:
                logger.info(f"Periodic FIFO 24h cleanup evicted: {res}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in periodic FIFO cleanup: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing SentinelX Database...")
    init_db()
    logger.info("Initializing SentinelX Admin & Licensing Database...")
    init_admin_db()
    # Execute startup FIFO retention check (removes stale > 24h records immediately)
    try:
        startup_purge = cleanup_expired_data(retention_hours=24.0, max_fifo_records=500)
        logger.info(f"Startup 24h FIFO cleanup check completed: {startup_purge}")
    except Exception as e:
        logger.error(f"Startup FIFO cleanup error: {e}")

    telemetry_task = asyncio.create_task(telemetry_broadcast_task())
    cleanup_task = asyncio.create_task(periodic_fifo_cleanup_task())
    logger.info("SentinelX AI Backend initialized and ready.")
    yield
    # Shutdown
    logger.info("Shutting down SentinelX AI...")
    telemetry_task.cancel()
    cleanup_task.cancel()
    camera_service.stop_camera()

app = FastAPI(
    title="SENTINELX AI — Industrial Worker Safety & PPE Monitoring System",
    description="Local Edge AI Computer Vision Platform for Safety Compliance",
    version="1.1.0",
    lifespan=lifespan
)

from fastapi import Response

# CORS for HTTP requests without interfering with WebSockets
@app.middleware("http")
async def cors_middleware(request, call_next):
    if request.method == "OPTIONS":
        response = Response(status_code=200)
    else:
        response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Mount API routes
app.include_router(api_router)
app.include_router(admin_router)
app.include_router(license_router)

# Mount local data directory for photos and incident snapshots
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")

# Mount alarm audio directory
ALARM_DIR = get_alarm_dir()
if os.path.exists(ALARM_DIR):
    app.mount("/Alarm", StaticFiles(directory=ALARM_DIR), name="alarm_dir")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    camera_service.ws_clients.add(websocket)
    try:
        # Send initial state
        await websocket.send_json(camera_service.get_detections_payload())
        while True:
            # Keepalive receiver
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        camera_service.ws_clients.discard(websocket)
    except Exception:
        camera_service.ws_clients.discard(websocket)

# Mount frontend production dist if built (Must be mounted AFTER all API and WebSocket routes)
FRONTEND_DIST = get_frontend_dist_dir()
if FRONTEND_DIST and os.path.exists(FRONTEND_DIST) and os.path.exists(os.path.join(FRONTEND_DIST, "index.html")):
    logger.info(f"Mounted production frontend from: {FRONTEND_DIST}")
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:
    logger.warning("Frontend dist directory not found.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, log_level="info")
