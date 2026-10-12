# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, collect_all

block_cipher = None

# Collect all ultralytics datas and binaries
ultralytics_datas, ultralytics_binaries, ultralytics_hidden = collect_all('ultralytics')

# Collect uvicorn submodules
uvicorn_submodules = collect_submodules('uvicorn')

# Collect torchvision
torchvision_datas, torchvision_binaries, torchvision_hidden = collect_all('torchvision')

project_dir = os.path.abspath(SPECPATH)
models_dir = os.path.join(project_dir, 'models')
alarm_dir = os.path.join(project_dir, 'Alarm')
frontend_dist_dir = os.path.join(project_dir, 'frontend', 'dist')

extra_datas = [
    (models_dir, 'models'),
    (alarm_dir, 'Alarm'),
]

if os.path.exists(frontend_dist_dir):
    extra_datas.append((frontend_dist_dir, 'frontend/dist'))

extra_datas.extend(ultralytics_datas)
extra_datas.extend(torchvision_datas)

hidden_imports = [
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'uvicorn.lifespan.off',
    'fastapi',
    'fastapi.responses',
    'fastapi.staticfiles',
    'fastapi.middleware.cors',
    'starlette',
    'starlette.middleware',
    'starlette.middleware.cors',
    'starlette.responses',
    'starlette.staticfiles',
    'websockets',
    'websockets.legacy',
    'websockets.legacy.server',
    'websockets.legacy.client',
    'torch',
    'torchvision',
    'cv2',
    'qrcode',
    'qrcode.image.pil',
    'PIL',
    'PIL.Image',
    'sqlite3',
    'multipart',
    'python_multipart',
    'backend',
    'backend.main',
    'backend.paths',
    'backend.api.routes',
    'backend.api.admin_routes',
    'backend.database.db',
    'backend.database.admin_db',
    'backend.services.camera_service',
    'backend.services.video_analysis_service',
    'backend.services.license_service',
    'backend.vision.detector',
    'backend.vision.face_id',
    'backend.vision.tracker',
    'backend.vision.compliance',
    'backend.models.schemas',
] + uvicorn_submodules + ultralytics_hidden + torchvision_hidden

a = Analysis(
    ['run_backend.py'],
    pathex=[project_dir],
    binaries=ultralytics_binaries + torchvision_binaries,
    datas=extra_datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'IPython', 'notebook', 'pytest'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='sentinelx_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='sentinelx_backend',
)
