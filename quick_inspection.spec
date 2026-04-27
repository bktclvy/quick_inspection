# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec file for Quick Inspection."""

import os
import sys

block_cipher = None
base_dir = os.path.abspath('.')

a = Analysis(
    ['run.py'],
    pathex=[base_dir],
    binaries=[],
    datas=[
        ('dist', 'dist'),           # フロントエンドビルド成果物
        ('config.py', '.'),         # 設定ファイル
    ],
    hiddenimports=[
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
        'backend',
        'backend.app',
        'backend.camera',
        'backend.inference',
        'backend.training',
        'backend.product',
        'backend.state_machine',
        'backend.routes',
        'backend.routes.api',
        'backend.routes.ws',
        'backend.routes.stream',
        'backend.routes.scale',
        'backend.scale',
        'backend.scale_config',
        'backend.box_log',
        'serial',
        'serial.tools',
        'serial.tools.list_ports',
        'serial.serialwin32',
        'webview',
        'webview.platforms.edgechromium',
        'clr_loader',
        'pythonnet',
        'send2trash',
        'aiofiles',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'tkinter',
        'pytest',
    ],
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
    name='QuickInspection',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # GUIアプリ（コンソール非表示）
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='QuickInspection',
)
