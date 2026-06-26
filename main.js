const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const ffmpegPath = require('ffmpeg-static');
const { startServer } = require('./app');

let mainWindow;
let libraryWindow;
let streamServer;
let activeRecording = null;
let currentPlaybackState = null;
let cachedBestEncoder = null;
let savedVisibility = { name: true, cover: true, artist: true };

const audioExtensions = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac']);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

async function createWindow() {
    try {
        streamServer = await startServer();
    } catch (error) {
        if (error.code !== 'EADDRINUSE') {
            throw error;
        }

        streamServer = await startServer(0);
    }

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 960,
        minHeight: 540,
        backgroundColor: '#0c0c0c',
        title: 'Monstercat Visualizer',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    await mainWindow.loadFile(path.join(__dirname, 'index.html'));

    libraryWindow = new BrowserWindow({
        width: 940,
        height: 460,
        minWidth: 720,
        minHeight: 360,
        backgroundColor: '#202020',
        title: 'Visualizer Library',
        autoHideMenuBar: true,
        x: 80,
        y: 80,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    await libraryWindow.loadFile(path.join(__dirname, 'library.html'));

    libraryWindow.on('closed', () => {
        libraryWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (streamServer) {
        streamServer.close();
        streamServer = null;
    }
});

ipcMain.handle('library:open-files', async () => {
    const result = await dialog.showOpenDialog(libraryWindow || mainWindow, {
        title: 'Add songs',
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Audio files', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'] },
            { name: 'All files', extensions: ['*'] },
        ],
    });

    if (result.canceled) {
        return [];
    }

    return createTracksFromPaths(result.filePaths);
});

ipcMain.handle('library:create-tracks-from-paths', async (_event, filePaths) => {
    return createTracksFromPaths(filePaths);
});

ipcMain.handle('library:load-playlist', () => {
    try {
        const playlistPath = getPlaylistPath();
        if (!fs.existsSync(playlistPath)) {
            return null;
        }

        const data = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
        if (data && data.visibility) {
            savedVisibility = data.visibility;
        }
        return data;
    } catch (error) {
        console.error('Failed to load playlist:', error);
        return null;
    }
});

ipcMain.handle('library:save-playlist', (_event, data) => {
    try {
        const playlistPath = getPlaylistPath();
        fs.mkdirSync(path.dirname(playlistPath), { recursive: true });
        fs.writeFileSync(playlistPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Failed to save playlist:', error);
        return false;
    }
});

ipcMain.handle('recording:select-output-folder', async () => {
    const result = await dialog.showOpenDialog(libraryWindow || mainWindow, {
        title: 'Select recording output folder',
        properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled) {
        return '';
    }

    return result.filePaths[0];
});

ipcMain.handle('recording:record-track', async (_event, track, options = {}) => {
    return recordTrack(track, options);
});

ipcMain.handle('recording:stop', () => {
    if (activeRecording) {
        activeRecording.stopRequested = true;
    }

    return true;
});

async function createTracksFromPaths(filePaths) {
    const tracks = [];

    for (const filePath of filePaths) {
        if (!audioExtensions.has(path.extname(filePath).toLowerCase())) continue;
        tracks.push(await createTrackFromPath(filePath));
    }

    return tracks;
}

async function createTrackFromPath(filePath) {
    const parsed = path.parse(filePath);
    const stats = getFileStats(filePath);
    const tagInfo = await readAudioMetadata(filePath);
    const nameInfo = parseTrackName(parsed.name);
    const trackNo = tagInfo.trackNo || nameInfo.trackNo;
    const artist = tagInfo.artist || nameInfo.artist;
    const title = tagInfo.title || nameInfo.title;

    return {
        id: `${filePath}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        path: filePath,
        url: pathToFileURL(filePath).toString(),
        fileName: parsed.base,
        folderName: parsed.dir,
        size: stats?.size || 0,
        lastModified: stats?.mtime?.toISOString() || '',
        artist,
        title,
        album: tagInfo.album,
        albumArtist: tagInfo.albumArtist,
        date: tagInfo.date,
        genre: tagInfo.genre || 'Default',
        composer: tagInfo.composer,
        comment: tagInfo.comment,
        trackNo,
        additional: '',
        cover: './cover/mcat.png',
        durationSeconds: tagInfo.durationSeconds,
        sampleRate: tagInfo.sampleRate,
        bitsPerSample: tagInfo.bitsPerSample,
        bitrate: tagInfo.bitrate,
        channels: tagInfo.channels,
        codec: tagInfo.codec,
    };
}

async function readAudioMetadata(filePath) {
    try {
        const { parseFile } = await import('music-metadata');
        const metadata = await parseFile(filePath);
        const common = metadata.common || {};
        const format = metadata.format || {};

        return {
            title: common.title || '',
            artist: joinTags(common.artists) || common.artist || '',
            album: common.album || '',
            albumArtist: common.albumartist || '',
            date: common.date || common.year || '',
            genre: joinTags(common.genre),
            composer: joinTags(common.composer),
            comment: joinTags(common.comment),
            trackNo: common.track?.no ? String(common.track.no) : '',
            durationSeconds: format.duration || 0,
            sampleRate: format.sampleRate || 0,
            bitsPerSample: format.bitsPerSample || 0,
            bitrate: format.bitrate || 0,
            channels: format.numberOfChannels || 0,
            codec: format.codec || format.container || '',
        };
    } catch (error) {
        console.warn(`Failed to read metadata for ${filePath}:`, error.message);
        return {};
    }
}

function joinTags(value) {
    if (!value) return '';
    if (Array.isArray(value)) {
        return value.map(formatTagValue).filter(Boolean).join('; ');
    }

    return formatTagValue(value);
}

function formatTagValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (value.text) return value.text;
    if (value.description && value.value) return `${value.description}: ${value.value}`;
    if (value.value) return String(value.value);
    return JSON.stringify(value);
}

function parseTrackName(name) {
    const numbered = name.match(/^(\d{1,3})[\s._-]+(.+)$/);
    const trackNo = numbered ? numbered[1] : '';
    const cleanName = numbered ? numbered[2].trim() : name.trim();
    const parts = cleanName.split(' - ');

    if (parts.length > 1) {
        return {
            artist: parts.slice(0, -1).join(' - ').trim(),
            title: parts[parts.length - 1].trim(),
            trackNo,
        };
    }

    return {
        artist: '',
        title: cleanName,
        trackNo,
    };
}

function getFileStats(filePath) {
    try {
        return fs.statSync(filePath);
    } catch {
        return null;
    }
}

function getPlaylistPath() {
    return path.join(app.getPath('userData'), 'playlist.json');
}

async function getBestVideoEncoder() {
    if (cachedBestEncoder) return cachedBestEncoder;

    const encoders = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf', 'libx264'];
    for (const encoder of encoders) {
        try {
            await new Promise((resolve, reject) => {
                const child = spawn(ffmpegPath, [
                    '-y',
                    '-f', 'lavfi',
                    '-i', 'color=c=black:s=320x240:d=0.1',
                    '-c:v', encoder,
                    '-f', 'null',
                    '-'
                ], { windowsHide: true });
                child.on('close', code => {
                    if (code === 0) resolve();
                    else reject(new Error(`Exit code ${code}`));
                });
                child.on('error', reject);
            });
            cachedBestEncoder = encoder;
            return encoder;
        } catch (err) {
            // Try next encoder
        }
    }
    cachedBestEncoder = 'libx264';
    return cachedBestEncoder;
}

async function recordTrack(track, options = {}) {
    if (activeRecording) {
        throw new Error('A recording is already running.');
    }

    if (!track?.path || !fs.existsSync(track.path)) {
        throw new Error('Recording source audio file does not exist.');
    }

    const outputFolder = options.outputFolder;
    if (!outputFolder) {
        throw new Error('No recording output folder selected.');
    }

    fs.mkdirSync(outputFolder, { recursive: true });

    const originalContentSize = mainWindow.getContentSize();
    let width = originalContentSize[0];
    let height = originalContentSize[1];
    
    // Ensure logical dimensions are even (required for H.264 encoding streams)
    if (width % 2 !== 0) width--;
    if (height % 2 !== 0) height--;

    let targetWidth = Number(options.width) || 1920;
    let targetHeight = Number(options.height) || 1080;
    if (targetWidth % 2 !== 0) targetWidth--;
    if (targetHeight % 2 !== 0) targetHeight--;

    const fps = Number(options.fps) || 60;
    const duration = Number(track.durationSeconds) || await readAudioDuration(track.path);
    const frameCount = Math.max(1, Math.ceil(duration * fps));
    const outputPath = getRecordingOutputPath(outputFolder, track);

    activeRecording = {
        stopRequested: false,
        outputPath,
        frameCount,
    };

    let recordingTrackEnded = false;
    const trackEndedListener = () => {
        recordingTrackEnded = true;
    };
    ipcMain.on('visualizer:track-ended', trackEndedListener);

    let ffmpeg = null;

    try {
        mainWindow.show();
        mainWindow.focus();

        // Capture a dummy frame to determine the physical resolution (accounts for high-DPI scaling)
        const initialImage = await mainWindow.webContents.capturePage({ x: 0, y: 0, width, height });
        const initialBuffer = initialImage.toBitmap();
        
        // Mathematically derive the exact physical W x H from the raw buffer size and logical aspect ratio
        const totalPixels = initialBuffer.length / 4;
        const aspect = width / height;
        const physicalHeight = Math.round(Math.sqrt(totalPixels / aspect));
        const physicalWidth = Math.round(totalPixels / physicalHeight);
        console.log(`Logical resolution: ${width}x${height}, Physical buffer resolution: ${physicalWidth}x${physicalHeight}`);

        const encoder = await getBestVideoEncoder();
        console.log(`Using video encoder: ${encoder}`);

        sendRecordingStatus({
            state: 'recording',
            message: `Recording ${track.title || track.fileName} (${encoder})`,
            outputPath,
            currentFrame: 0,
            frameCount,
            track,
        });

        const ffmpegArgs = [
            '-y',
            '-f', 'rawvideo',
            '-pix_fmt', 'bgra',
            '-s', `${physicalWidth}x${physicalHeight}`,
            '-framerate', String(fps),
            '-i', 'pipe:0',
            '-i', track.path,
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-t', String(duration),
            '-vf', `scale=${targetWidth}:${targetHeight}`, // Always scale to target even dimensions W x H
        ];

        ffmpegArgs.push('-c:v', encoder);

        if (encoder === 'libx264') {
            ffmpegArgs.push('-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p');
        } else if (encoder === 'h264_nvenc') {
            ffmpegArgs.push('-preset', 'fast', '-b:v', '10M', '-pix_fmt', 'yuv420p');
        } else {
            ffmpegArgs.push('-b:v', '10M', '-pix_fmt', 'yuv420p');
        }

        ffmpegArgs.push(
            '-r', String(fps),
            '-c:a', 'aac',
            '-b:a', '320k',
            '-shortest',
            outputPath
        );

        ffmpeg = spawn(ffmpegPath, ffmpegArgs, {
            windowsHide: true,
            stdio: ['pipe', 'ignore', 'pipe'],
        });

        let ffmpegError = '';
        ffmpeg.stderr.on('data', chunk => {
            ffmpegError += chunk.toString();
        });

        currentPlaybackState = null;
        mainWindow.webContents.send('visualizer:play-track', track);

        // Wait for the renderer to report that the audio has started playing
        const playbackStarted = await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (currentPlaybackState && currentPlaybackState.playing) {
                    clearInterval(checkInterval);
                    resolve(true);
                }
            }, 50);
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve(false);
            }, 10000);
        });

        if (!playbackStarted) {
            throw new Error('Playback failed to start within timeout.');
        }

        let writtenFrames = 0;
        let lastImageBuffer = null;
        const startedAt = Date.now();

        while (true) {
            if (activeRecording.stopRequested) break;
            if (recordingTrackEnded) break;

            const elapsed = (Date.now() - startedAt) / 1000;
            if (elapsed >= duration) break;

            const targetFrame = Math.floor(elapsed * fps);
            if (targetFrame > writtenFrames) {
                const image = await mainWindow.webContents.capturePage({ x: 0, y: 0, width, height });
                lastImageBuffer = image.toBitmap();

                const framesToWrite = targetFrame - writtenFrames;
                for (let i = 0; i < framesToWrite; i++) {
                    await writeFrame(ffmpeg.stdin, lastImageBuffer);
                }

                writtenFrames = targetFrame;

                sendRecordingStatus({
                    state: 'recording',
                    message: `Recording ${track.title || track.fileName} (${encoder})`,
                    outputPath,
                    currentFrame: Math.min(writtenFrames, frameCount),
                    frameCount,
                    track,
                });
            } else {
                await sleep(5);
            }
        }

        // Pad the video if we wrote fewer frames than expected to match duration
        if (writtenFrames < frameCount && lastImageBuffer) {
            const paddingFrames = frameCount - writtenFrames;
            for (let i = 0; i < paddingFrames; i++) {
                await writeFrame(ffmpeg.stdin, lastImageBuffer);
            }
            writtenFrames = frameCount;
        }

        ffmpeg.stdin.end();
        const exitCode = await waitForProcess(ffmpeg);
        ffmpeg = null; // Prevent killing in finally block

        if (exitCode !== 0 && !activeRecording.stopRequested) {
            throw new Error(`ffmpeg exited with code ${exitCode}: ${ffmpegError.slice(-1000)}`);
        }

        sendRecordingStatus({
            state: activeRecording.stopRequested ? 'stopped' : 'done',
            message: activeRecording.stopRequested ? 'Recording stopped' : `Saved ${path.basename(outputPath)}`,
            outputPath,
            currentFrame: activeRecording.stopRequested ? 0 : frameCount,
            frameCount,
            track,
        });

        return {
            ok: !activeRecording.stopRequested,
            stopped: activeRecording.stopRequested,
            outputPath,
        };
    } finally {
        ipcMain.off('visualizer:track-ended', trackEndedListener);
        if (ffmpeg) {
            try { ffmpeg.stdin.end(); } catch (e) {}
            try { ffmpeg.kill(); } catch (e) {}
        }
        mainWindow.setContentSize(originalContentSize[0], originalContentSize[1]);
        activeRecording = null;
    }
}

async function readAudioDuration(filePath) {
    const metadata = await readAudioMetadata(filePath);
    return Number(metadata.durationSeconds) || 1;
}

function getRecordingOutputPath(outputFolder, track) {
    const numberPrefix = track.trackNo ? `${track.trackNo}. ` : '';
    const title = track.title || path.parse(track.fileName || track.path).name;
    const artist = track.artist ? `${track.artist} - ` : '';
    const baseName = sanitizeFileName(`${numberPrefix}${artist}${title}`) || 'recording';
    let outputPath = path.join(outputFolder, `${baseName}.mp4`);
    let counter = 2;

    while (fs.existsSync(outputPath)) {
        outputPath = path.join(outputFolder, `${baseName} (${counter++}).mp4`);
    }

    return outputPath;
}

function sanitizeFileName(value) {
    return String(value || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function writeFrame(stream, buffer) {
    return new Promise((resolve, reject) => {
        stream.write(buffer, error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function waitForProcess(child) {
    return new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
    });
}

function sendRecordingStatus(status) {
    libraryWindow?.webContents.send('recording:status', status);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

ipcMain.on('visualizer:play-track', (_event, track) => {
    mainWindow?.webContents.send('visualizer:play-track', track);
});

ipcMain.on('visualizer:toggle-playback', () => {
    mainWindow?.webContents.send('visualizer:toggle-playback');
});

ipcMain.on('visualizer:stop', () => {
    mainWindow?.webContents.send('visualizer:stop');
});

ipcMain.on('visualizer:next', () => {
    libraryWindow?.webContents.send('library:next');
});

ipcMain.on('visualizer:previous', () => {
    libraryWindow?.webContents.send('library:previous');
});

ipcMain.on('visualizer:track-ended', () => {
    if (activeRecording) return;
    libraryWindow?.webContents.send('library:next');
});

ipcMain.on('visualizer:playback-state', (_event, state) => {
    currentPlaybackState = state;
    libraryWindow?.webContents.send('library:playback-state', state);
});

ipcMain.on('visualizer:seek', (_event, time) => {
    mainWindow?.webContents.send('visualizer:seek', time);
});

ipcMain.on('library:show-song-context-menu', (event, index) => {
    const template = [
        {
            label: 'Play',
            click: () => {
                event.sender.send('library:context-menu-command', 'play', index);
            }
        },
        {
            label: 'Record',
            click: () => {
                event.sender.send('library:context-menu-command', 'record', index);
            }
        },
        { type: 'separator' },
        {
            label: 'Remove',
            click: () => {
                event.sender.send('library:context-menu-command', 'remove', index);
            }
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

ipcMain.on('library:update-visibility', (event, visibility) => {
    savedVisibility = visibility;
    mainWindow?.webContents.send('visualizer:update-visibility', visibility);
});

ipcMain.handle('visualizer:get-visibility', () => {
    return savedVisibility;
});
