const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const http = require('http');

const BACKEND_PORT = 8000;
const BACKEND_HOST = '127.0.0.1';
const IS_DEV = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === '1';

// Setup AppData logging paths
const appDataDir = path.join(app.getPath('appData'), 'SentinelX AI');
try {
  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true });
  }
} catch (e) {
  console.warn('Could not initialize AppData directory:', e);
}

const backendLogPath = path.join(appDataDir, 'backend_service.log');

let mainWindow = null;
let pythonProcess = null;
let spawnedByUs = false;

function detectAppMode() {
  if (process.env.APP_MODE === 'admin') return 'admin';
  if (process.env.APP_MODE === 'user') return 'user';
  if (process.argv.includes('--app-mode=admin') || process.argv.includes('--admin')) return 'admin';
  if (process.argv.includes('--app-mode=user') || process.argv.includes('--user')) return 'user';

  try {
    const exeName = path.basename(process.execPath || '').toLowerCase();
    if (exeName.includes('admin')) return 'admin';
  } catch (_) {}

  try {
    const appName = (app.getName() || '').toLowerCase();
    if (appName.includes('admin')) return 'admin';
  } catch (_) {}

  return 'user';
}

function getAppLogPath(mode) {
  return path.join(appDataDir, `desktop_app_${mode}.log`);
}

function createLogger(mode) {
  const logPath = getAppLogPath(mode);
  return {
    log: (msg) => {
      const line = `[${new Date().toISOString()}] [INFO] [${mode.toUpperCase()}] ${msg}\n`;
      console.log(msg);
      try {
        fs.appendFileSync(logPath, line);
      } catch (_) {}
    },
    logError: (msg) => {
      const line = `[${new Date().toISOString()}] [ERROR] [${mode.toUpperCase()}] ${msg}\n`;
      console.error(msg);
      try {
        fs.appendFileSync(logPath, line);
      } catch (_) {}
    }
  };
}

function getPythonCommand() {
  if (process.platform === 'win32') {
    const localPython = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python314', 'python.exe');
    if (fs.existsSync(localPython)) return localPython;

    try {
      const output = execSync('where python', { encoding: 'utf8' });
      const firstLine = output.trim().split(/\r?\n/)[0].trim();
      if (firstLine && firstLine.endsWith('.exe')) return firstLine;
    } catch (_) {}
    return 'python';
  }
  return 'python3';
}

function getPackagedBackendPath() {
  const candidates = [
    path.join(process.resourcesPath, 'backend', 'sentinelx_backend.exe'),
    path.join(process.resourcesPath, 'sentinelx_backend.exe'),
    path.join(process.resourcesPath, 'app', 'backend', 'sentinelx_backend.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function checkBackendAlive(callback) {
  let responded = false;
  let req = null;
  const done = (val) => {
    if (!responded) {
      responded = true;
      if (req) {
        try {
          req.destroy();
        } catch (_) {}
      }
      callback(val);
    }
  };

  req = http.get(
    {
      host: BACKEND_HOST,
      port: BACKEND_PORT,
      path: '/api/health',
      timeout: 2500
    },
    (res) => {
      res.resume();
      done(res.statusCode === 200);
    }
  );

  req.on('error', () => done(false));
  req.on('timeout', () => done(false));
}

function waitForBackend(callback, logger, maxAttempts = 120, intervalMs = 500) {
  let attempts = 0;
  let isResolved = false;

  const poll = () => {
    if (isResolved) return;

    checkBackendAlive((alive) => {
      if (isResolved) return;

      if (alive) {
        isResolved = true;
        logger.log('SentinelX AI Backend is online and responding to health check.');
        callback(true);
      } else {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, intervalMs);
        } else {
          isResolved = true;
          logger.logError(`Backend readiness check timed out after ${(maxAttempts * intervalMs) / 1000} seconds.`);
          dialog.showErrorBox(
            'SentinelX Startup Timeout',
            'The SentinelX AI backend took longer than expected to initialize.\n\nPlease verify that port 8000 is available and check log file at:\n' +
            backendLogPath +
            '\n\nThen restart the application.'
          );
          callback(false);
        }
      }
    });
  };

  poll();
}

function startPythonBackend(onReady, logger) {
  checkBackendAlive((alive) => {
    if (alive) {
      logger.log('SentinelX AI Backend is already running on port 8000. Reusing active instance.');
      onReady(true);
      return;
    }

    let spawnCmd = null;
    let spawnArgs = [];
    let spawnCwd = null;

    const yoloConfigDir = path.join(appDataDir, 'yolo_config');
    const yoloSubDir = path.join(yoloConfigDir, 'Ultralytics');
    try {
      fs.mkdirSync(yoloSubDir, { recursive: true });
    } catch (_) {}

    if (app.isPackaged) {
      const packagedExe = getPackagedBackendPath();
      if (!packagedExe) {
        logger.logError('Packaged Python backend executable not found in resources!');
        dialog.showErrorBox(
          'SentinelX - Missing AI Backend',
          `The backend executable could not be located in:\n${path.join(process.resourcesPath, 'backend', 'sentinelx_backend.exe')}\n\nPlease reinstall SentinelX.`
        );
        onReady(false);
        return;
      }
      logger.log(`Launching packaged SentinelX AI backend: ${packagedExe}`);
      spawnCmd = packagedExe;
      spawnArgs = [];
      spawnCwd = appDataDir;
    } else {
      const localCompiled = path.join(__dirname, '..', 'dist', 'sentinelx_backend', 'sentinelx_backend.exe');
      const projectRoot = path.resolve(__dirname, '..');
      if (fs.existsSync(localCompiled) && process.env.USE_COMPILED_BACKEND === '1') {
        logger.log(`Using compiled backend in dev: ${localCompiled}`);
        spawnCmd = localCompiled;
        spawnArgs = [];
        spawnCwd = path.dirname(localCompiled);
      } else {
        const pythonCmd = getPythonCommand();
        logger.log(`Starting SentinelX Python AI Backend from: ${projectRoot} using ${pythonCmd}`);
        spawnCmd = pythonCmd;
        spawnArgs = ['run_backend.py'];
        spawnCwd = projectRoot;
      }
    }

    try {
      const backendLogStream = fs.createWriteStream(backendLogPath, { flags: 'a' });
      backendLogStream.write(`\n--- SentinelX Backend Service Session Started: ${new Date().toISOString()} ---\n`);

      pythonProcess = spawn(
        spawnCmd,
        spawnArgs,
        {
          cwd: spawnCwd,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            SENTINELX_PACKAGED: app.isPackaged ? '1' : '0',
            SENTINELX_DATA_DIR: appDataDir,
            YOLO_CONFIG_DIR: yoloConfigDir,
            PYTHONUNBUFFERED: '1'
          }
        }
      );
      spawnedByUs = true;

      pythonProcess.stdout.on('data', (data) => {
        try { backendLogStream.write(data); } catch (_) {}
        logger.log(`[Backend stdout]: ${data.toString().trim()}`);
      });

      pythonProcess.stderr.on('data', (data) => {
        try { backendLogStream.write(data); } catch (_) {}
        logger.logError(`[Backend stderr]: ${data.toString().trim()}`);
      });

      pythonProcess.on('close', (code) => {
        logger.log(`SentinelX AI background service exited with code ${code}`);
      });
    } catch (e) {
      logger.logError(`Failed to spawn SentinelX backend process: ${e.message}`);
      dialog.showErrorBox(
        'SentinelX Launch Error',
        `Failed to start the AI background service:\n${e.message}`
      );
      onReady(false);
      return;
    }

    waitForBackend(onReady, logger);
  });
}

function isOtherSentinelXRunning(currentMode) {
  if (process.platform !== 'win32') return false;
  try {
    const otherExe = currentMode === 'admin' ? 'SentinelX AI.exe' : 'SentinelX Admin.exe';
    const output = execSync(`tasklist /fi "imagename eq ${otherExe}"`, { encoding: 'utf8' });
    return output.toLowerCase().includes(otherExe.toLowerCase());
  } catch (_) {
    return false;
  }
}

function stopBackendProcess(mode, logger) {
  if (pythonProcess && spawnedByUs) {
    if (isOtherSentinelXRunning(mode)) {
      logger.log(`The companion SentinelX application is still active. Keeping backend service running.`);
      return;
    }

    logger.log('Terminating SentinelX Python AI background process tree...');
    const pid = pythonProcess.pid;
    pythonProcess = null;
    if (process.platform === 'win32' && pid) {
      try {
        execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' });
      } catch (_) {}
    }
  }
}

function runSentinelXApp(mode = 'user') {
  const isModeAdmin = mode === 'admin';
  const appDisplayName = isModeAdmin ? 'SentinelX Admin' : 'SentinelX AI';
  const appId = isModeAdmin ? 'com.sentinelx.ai.admin' : 'com.sentinelx.ai.user';

  app.setName(appDisplayName);
  app.setAppUserModelId(appId);

  const logger = createLogger(mode);

  // Enforce single-instance lock per app variant
  const gotTheLock = app.requestSingleInstanceLock({ appMode: mode });
  if (!gotTheLock) {
    logger.log(`Another instance of ${appDisplayName} is already open. Exiting secondary process.`);
    app.quit();
    process.exit(0);
  }

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createMainWindow() {
    const windowTitle = isModeAdmin
      ? 'SENTINELX AI — Super Admin Control Plane'
      : 'SENTINELX AI — Industrial Worker Safety & PPE Monitoring System';

    mainWindow = new BrowserWindow({
      width: isModeAdmin ? 1366 : 1440,
      height: isModeAdmin ? 850 : 900,
      minWidth: isModeAdmin ? 1024 : 1100,
      minHeight: isModeAdmin ? 700 : 720,
      backgroundColor: '#0B1120',
      title: windowTitle,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false
      },
      show: false
    });

    const splashPath = path.join(__dirname, 'splash.html');
    if (fs.existsSync(splashPath)) {
      mainWindow.loadFile(splashPath, { search: `?app=${mode}` });
    }

    mainWindow.once('ready-to-show', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  function navigateToApplication() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const queryParam = `?app=${mode}`;
    const loadUrl = IS_DEV
      ? `http://localhost:5173/${queryParam}`
      : `http://${BACKEND_HOST}:${BACKEND_PORT}/${queryParam}`;

    logger.log(`Navigating window to application URL: ${loadUrl}`);

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      logger.logError(`Failed to load URL: ${validatedURL} (code ${errorCode}: ${errorDescription})`);
      if (mainWindow && !mainWindow.isDestroyed() && validatedURL && validatedURL.includes(String(BACKEND_PORT))) {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            logger.log(`Retrying application load: ${loadUrl}`);
            mainWindow.loadURL(loadUrl);
          }
        }, 1500);
      }
    });

    mainWindow.webContents.session.clearCache().then(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(loadUrl);
      }
    }).catch(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(loadUrl);
      }
    });
  }

  app.whenReady().then(() => {
    logger.log(`${appDisplayName} desktop application starting...`);
    createMainWindow();

    startPythonBackend((success) => {
      if (success) {
        navigateToApplication();
      } else {
        logger.logError('Backend failed to become ready. Exiting application.');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.close();
        }
        app.quit();
      }
    }, logger);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => stopBackendProcess(mode, logger));
  app.on('will-quit', () => stopBackendProcess(mode, logger));
}

module.exports = {
  runSentinelXApp,
  detectAppMode
};
