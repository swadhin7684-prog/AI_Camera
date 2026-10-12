import sys
import os
import multiprocessing

# Ensure current directory is in sys.path
PROJECT_ROOT = os.path.abspath(os.path.dirname(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

if __name__ == "__main__":
    multiprocessing.freeze_support()

    import logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    logger = logging.getLogger("sentinelx.server")

    from backend.paths import ensure_data_directories, APP_DATA_DIR, DB_PATH, get_models_dir
    ensure_data_directories()

    # Ensure process CWD is the writable AppData directory to prevent any CWD permission errors
    try:
        os.chdir(APP_DATA_DIR)
    except Exception as e:
        logger.warning(f"Could not change CWD to AppData: {e}")

    from backend.database.db import init_db
    init_db()

    logger.info("===================================================")
    logger.info("Starting SentinelX AI Backend Server")
    logger.info(f"App Data Directory: {APP_DATA_DIR}")
    logger.info(f"Database Path:      {DB_PATH}")
    logger.info(f"Models Directory:   {get_models_dir()}")
    logger.info("===================================================")

    import uvicorn
    from backend.main import app

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
        access_log=False
    )
