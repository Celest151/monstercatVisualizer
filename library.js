const playlist = [];
const playlistStorageKey = 'visualizer-library-playlist-v1';
const selectedIndexStorageKey = 'visualizer-library-selected-index-v1';
const playlistMigratedStorageKey = 'visualizer-library-file-store-migrated-v1';
const sidebarWidthStorageKey = 'visualizer-library-sidebar-width-v1';
const playlistColumnWidthsStorageKey = 'visualizer-library-column-widths-v1';
const recordingOutputFolderStorageKey = 'visualizer-library-recording-output-folder-v1';
const recordingDefaults = {
    width: 1920,
    height: 1080,
    fps: 60,
};
const defaultColumnWidths = {
    playing: 72,
    artist: 220,
    track: 72,
    title: 260,
    duration: 78,
};
let selectedIndex = -1;
let playingIndex = -1;
let isPlaying = false;
let dragDepth = 0;
let playbackState = null;
let resizingColumn = null;
let isRecording = false;
let stopRecordingRequested = false;
let isSeeking = false;
let dragSourceIndex = null;

const tracksEl = document.getElementById('tracks');
const statusEl = document.getElementById('status');
const searchEl = document.getElementById('search');
const seekEl = document.getElementById('seek');
const selectionPropertiesEl = document.getElementById('selectionProperties');
const panelSplitter = document.getElementById('panelSplitter');
const playPauseButton = document.getElementById('playPause');
const playPauseIcon = document.getElementById('playPauseIcon');

setupMenus();
setupPanelResize();
setupColumnResize();
playPauseButton.addEventListener('click', () => {
    if (playingIndex === -1) {
        playIndex(selectedIndex >= 0 ? selectedIndex : 0);
        return;
    }

    window.desktopPlayer.togglePlayback();
});
document.getElementById('stop').addEventListener('click', () => window.desktopPlayer.stop());
document.getElementById('next').addEventListener('click', playNext);
document.getElementById('previous').addEventListener('click', playPrevious);
searchEl.addEventListener('input', render);
seekEl.addEventListener('input', () => {
    isSeeking = true;
});
seekEl.addEventListener('change', () => {
    window.desktopPlayer.seek(Number(seekEl.value));
    isSeeking = false;
});

document.addEventListener('dragenter', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth++;
    showDropTarget();
});
document.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideDropTarget();
});
document.addEventListener('drop', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    addDroppedFiles(event);
});
window.addEventListener('beforeunload', savePlaylist);

window.desktopPlayer.onNext(playNext);
window.desktopPlayer.onPrevious(playPrevious);
window.desktopPlayer.onPlaybackState(state => {
    isPlaying = state.playing;
    playbackState = state;
    updateNowPlayingInfo();
    setPlayPauseIcon();
    if (!isSeeking) {
        seekEl.max = state.duration || 100;
        seekEl.value = state.currentTime || 0;
    }
    render();
});
window.desktopPlayer.onRecordingStatus(state => {
    updateRecordingStatus(state);
});
window.desktopPlayer.onContextMenuCommand((command, index) => {
    if (command === 'play') {
        playIndex(index);
    } else if (command === 'record') {
        selectedIndex = index;
        savePlaylist();
        render();
        recordSelectedTrack();
    } else if (command === 'remove') {
        selectedIndex = index;
        removeSelected();
    }
});

function setupMenus() {
    document.querySelectorAll('.menu-button').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            toggleMenu(button.dataset.menu);
        });
    });

    document.querySelectorAll('[data-command]').forEach(button => {
        button.addEventListener('click', async () => {
            closeMenus();
            await runMenuCommand(button.dataset.command);
        });
    });

    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeMenus();
    });
}

function toggleMenu(menuId) {
    const menu = document.getElementById(menuId);
    const isOpen = menu.classList.contains('open');
    closeMenus();

    if (!isOpen) {
        menu.classList.add('open');
        document.querySelector(`[data-menu="${menuId}"]`)?.classList.add('open');
    }
}

function closeMenus() {
    document.querySelectorAll('.menu-dropdown.open').forEach(menu => menu.classList.remove('open'));
    document.querySelectorAll('.menu-button.open').forEach(button => button.classList.remove('open'));
}

function setupColumnResize() {
    applyColumnWidths(loadColumnWidths());

    document.querySelectorAll('.column-resizer').forEach(handle => {
        handle.addEventListener('pointerdown', event => {
            event.preventDefault();
            event.stopPropagation();

            const column = handle.dataset.column;
            resizingColumn = {
                column,
                startX: event.clientX,
                startWidth: getColumnWidth(column),
            };
            handle.setPointerCapture(event.pointerId);
            document.body.classList.add('resizing-columns');
        });

        handle.addEventListener('pointermove', event => {
            if (!resizingColumn) return;

            const nextWidth = clampColumnWidth(resizingColumn.column, resizingColumn.startWidth + event.clientX - resizingColumn.startX);
            setColumnWidth(resizingColumn.column, nextWidth);
        });

        handle.addEventListener('pointerup', event => {
            if (handle.hasPointerCapture(event.pointerId)) {
                handle.releasePointerCapture(event.pointerId);
            }

            finishColumnResize();
        });

        handle.addEventListener('pointercancel', finishColumnResize);
    });
}

function finishColumnResize() {
    if (!resizingColumn) return;

    resizingColumn = null;
    document.body.classList.remove('resizing-columns');
    saveColumnWidths();
}

function loadColumnWidths() {
    try {
        return {
            ...defaultColumnWidths,
            ...JSON.parse(localStorage.getItem(playlistColumnWidthsStorageKey) || '{}'),
        };
    } catch {
        return { ...defaultColumnWidths };
    }
}

function saveColumnWidths() {
    const widths = {};
    Object.keys(defaultColumnWidths).forEach(column => {
        widths[column] = getColumnWidth(column);
    });
    localStorage.setItem(playlistColumnWidthsStorageKey, JSON.stringify(widths));
}

function applyColumnWidths(widths) {
    Object.entries(widths).forEach(([column, width]) => {
        setColumnWidth(column, width);
    });
}

function setColumnWidth(column, width) {
    const col = document.querySelector(`col[data-column="${column}"]`);
    if (!col) return;
    col.style.width = `${clampColumnWidth(column, Number(width))}px`;
}

function getColumnWidth(column) {
    const col = document.querySelector(`col[data-column="${column}"]`);
    const currentWidth = Number.parseFloat(col?.style.width || '');
    if (currentWidth) return currentWidth;
    return defaultColumnWidths[column] || 120;
}

function clampColumnWidth(column, width) {
    const minWidths = {
        playing: 50,
        artist: 90,
        track: 58,
        title: 120,
        duration: 64,
    };
    return Math.max(minWidths[column] || 64, Math.min(width, 700));
}

function setupPanelResize() {
    const savedWidth = Number(localStorage.getItem(sidebarWidthStorageKey));
    if (savedWidth) {
        setSidebarWidth(savedWidth);
    }

    panelSplitter.addEventListener('pointerdown', event => {
        event.preventDefault();
        panelSplitter.setPointerCapture(event.pointerId);
        document.body.classList.add('resizing-panels');
    });

    panelSplitter.addEventListener('pointermove', event => {
        if (!document.body.classList.contains('resizing-panels')) return;

        const width = clampSidebarWidth(event.clientX);
        setSidebarWidth(width);
    });

    panelSplitter.addEventListener('pointerup', event => {
        if (panelSplitter.hasPointerCapture(event.pointerId)) {
            panelSplitter.releasePointerCapture(event.pointerId);
        }

        finishPanelResize();
    });

    panelSplitter.addEventListener('pointercancel', finishPanelResize);
    window.addEventListener('resize', () => {
        const currentWidth = Number(localStorage.getItem(sidebarWidthStorageKey));
        if (currentWidth) setSidebarWidth(clampSidebarWidth(currentWidth));
    });
}

function finishPanelResize() {
    if (!document.body.classList.contains('resizing-panels')) return;

    document.body.classList.remove('resizing-panels');
    localStorage.setItem(sidebarWidthStorageKey, String(getSidebarWidth()));
}

function setSidebarWidth(width) {
    document.body.style.setProperty('--sidebar-width', `${clampSidebarWidth(width)}px`);
}

function getSidebarWidth() {
    const width = getComputedStyle(document.body).getPropertyValue('--sidebar-width');
    return Number.parseFloat(width) || Math.round(window.innerWidth / 2);
}

function clampSidebarWidth(width) {
    const minWidth = 260;
    const maxWidth = Math.max(minWidth, window.innerWidth - 280);
    return Math.min(Math.max(width, minWidth), maxWidth);
}

async function runMenuCommand(command) {
    switch (command) {
        case 'add-files':
            await addFiles();
            break;
        case 'clear-playlist':
            clearPlaylist();
            break;
        case 'close-window':
            window.close();
            break;
        case 'remove-selected':
            await removeSelected();
            break;
        case 'clear-filter':
            searchEl.value = '';
            render();
            break;
        case 'focus-filter':
            searchEl.focus();
            searchEl.select();
            break;
        case 'toggle-visibility-name':
            toggleVisibilityField('name');
            break;
        case 'toggle-visibility-artist':
            toggleVisibilityField('artist');
            break;
        case 'toggle-visibility-cover':
            toggleVisibilityField('cover');
            break;
        case 'refresh-metadata':
        case 'rescan-library':
            await rescanMetadata();
            break;
        case 'play-selected':
            playSelected();
            break;
        case 'toggle-playback':
            if (playingIndex === -1) playSelected();
            else window.desktopPlayer.togglePlayback();
            break;
        case 'stop':
            window.desktopPlayer.stop();
            break;
        case 'previous':
            playPrevious();
            break;
        case 'next':
            playNext();
            break;
        case 'save-library':
            await savePlaylist();
            statusEl.textContent = 'Playlist saved';
            break;
        case 'select-recording-folder':
            await selectRecordingFolder();
            break;
        case 'record-selected':
            await recordSelectedTrack();
            break;
        case 'record-playlist':
            await recordPlaylist();
            break;
        case 'stop-recording':
            stopRecordingRequested = true;
            await window.desktopPlayer.stopRecording();
            statusEl.textContent = 'Stopping recording...';
            break;
        case 'about':
            statusEl.textContent = 'Monstercat Visualizer Library';
            break;
    }
}

async function selectRecordingFolder() {
    const folder = await window.desktopPlayer.selectRecordingOutputFolder();
    if (!folder) return '';

    localStorage.setItem(recordingOutputFolderStorageKey, folder);
    statusEl.textContent = `Recording folder: ${folder}`;
    return folder;
}

async function getRecordingFolder() {
    return localStorage.getItem(recordingOutputFolderStorageKey) || await selectRecordingFolder();
}

async function recordSelectedTrack() {
    if (!playlist[selectedIndex]) return;
    await recordTracks([selectedIndex]);
}

async function recordPlaylist() {
    if (playlist.length === 0) return;
    await recordTracks(playlist.map((_track, index) => index));
}

async function recordTracks(indexes) {
    if (isRecording) return;

    const outputFolder = await getRecordingFolder();
    if (!outputFolder) return;

    isRecording = true;
    stopRecordingRequested = false;

    try {
        for (const index of indexes) {
            if (stopRecordingRequested) break;
            if (!playlist[index]) continue;

            selectedIndex = index;
            playingIndex = index;
            await savePlaylist();
            render();

            const result = await window.desktopPlayer.recordTrack(playlist[index], {
                ...recordingDefaults,
                outputFolder,
            });

            if (result?.stopped) break;
        }
    } catch (error) {
        statusEl.textContent = `Recording failed: ${error.message || error}`;
    } finally {
        isRecording = false;
        stopRecordingRequested = false;
        render();
    }
}

function updateRecordingStatus(state) {
    if (!state) return;

    if (state.state === 'recording') {
        const percent = state.frameCount
            ? Math.round((state.currentFrame / state.frameCount) * 100)
            : 0;
        statusEl.textContent = `${state.message} - ${percent}%`;
        return;
    }

    statusEl.textContent = state.message || 'Recording ready';
}

async function addFiles() {
    const files = await window.desktopPlayer.openFiles();
    await addTracks(files);
}

async function addTracks(files) {
    for (const file of files) {
        const normalizedTrack = normalizeTrack(file);
        playlist.push({
            ...normalizedTrack,
            duration: normalizedTrack.duration || formatDuration(normalizedTrack.durationSeconds || 0),
            trackNo: normalizedTrack.trackNo,
        });
        loadDuration(playlist[playlist.length - 1]);
    }

    if (selectedIndex === -1 && playlist.length > 0) {
        selectedIndex = 0;
    }

    await savePlaylist();
    render();
    renderProperties();
}

async function addDroppedFiles(event) {
    event.preventDefault();
    dragDepth = 0;
    hideDropTarget();

    const paths = Array.from(event.dataTransfer.files)
        .map(file => window.desktopPlayer.getDroppedFilePath(file))
        .filter(Boolean);

    const files = await window.desktopPlayer.createTracksFromPaths(paths);
    await addTracks(files);
}

function clearPlaylist() {
    playlist.length = 0;
    selectedIndex = -1;
    playingIndex = -1;
    savePlaylist();
    render();
    window.desktopPlayer.stop();
    updateNowPlayingInfo();
    renderProperties();
}

async function removeSelected() {
    if (!playlist[selectedIndex]) return;

    playlist.splice(selectedIndex, 1);
    if (playlist.length === 0) {
        selectedIndex = -1;
        playingIndex = -1;
        window.desktopPlayer.stop();
    } else {
        selectedIndex = Math.min(selectedIndex, playlist.length - 1);
        if (playingIndex >= playlist.length) {
            playingIndex = playlist.length - 1;
        }
    }

    await savePlaylist();
    render();
}

async function reorderPlaylist(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const item = playlist.splice(fromIndex, 1)[0];
    playlist.splice(toIndex, 0, item);

    // Update playingIndex and selectedIndex offsets
    if (playingIndex === fromIndex) {
        playingIndex = toIndex;
    } else if (fromIndex < playingIndex && toIndex >= playingIndex) {
        playingIndex--;
    } else if (fromIndex > playingIndex && toIndex <= playingIndex) {
        playingIndex++;
    }

    if (selectedIndex === fromIndex) {
        selectedIndex = toIndex;
    } else if (fromIndex < selectedIndex && toIndex >= selectedIndex) {
        selectedIndex--;
    } else if (fromIndex > selectedIndex && toIndex <= selectedIndex) {
        selectedIndex++;
    }

    await savePlaylist();
    render();
}

function playSelected() {
    playIndex(selectedIndex >= 0 ? selectedIndex : 0);
}

async function playIndex(index) {
    if (!playlist[index]) return;

    playingIndex = index;
    selectedIndex = index;
    await savePlaylist();
    window.desktopPlayer.playTrack(playlist[index]);
    render();
}

function playNext() {
    if (playlist.length === 0) return;

    const nextIndex = playingIndex === -1 ? 0 : (playingIndex + 1) % playlist.length;
    playIndex(nextIndex);
}

function playPrevious() {
    if (playlist.length === 0) return;

    const nextIndex = playingIndex <= 0 ? playlist.length - 1 : playingIndex - 1;
    playIndex(nextIndex);
}

function render() {
    const filter = searchEl.value.trim().toLowerCase();
    tracksEl.innerHTML = '';
    renderProperties();

    playlist.forEach((track, index) => {
        const haystack = `${track.artist} ${track.title} ${track.fileName}`.toLowerCase();
        if (filter && !haystack.includes(filter)) return;

        const row = document.createElement('tr');
        row.className = [
            index === selectedIndex ? 'selected' : '',
            index === playingIndex ? 'playing' : '',
        ].join(' ').trim();
        row.innerHTML = `
            <td>${index === playingIndex ? (isPlaying ? 'Playing' : 'Paused') : ''}</td>
            <td title="${escapeHtml([track.artist, track.album].filter(Boolean).join(' - '))}">${escapeHtml([track.artist, track.album].filter(Boolean).join(' - '))}</td>
            <td>${track.trackNo || ''}</td>
            <td title="${escapeHtml(track.fileName)}">${escapeHtml(track.title)}</td>
            <td>${track.duration || ''}</td>
        `;
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', event => {
            dragSourceIndex = index;
            row.classList.add('dragging-row');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(index));
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging-row');
            document.querySelectorAll('tr').forEach(r => {
                r.classList.remove('drag-over-above', 'drag-over-below');
            });
        });
        row.addEventListener('dragover', event => {
            if (dragSourceIndex === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';

            const rect = row.getBoundingClientRect();
            const relativeY = event.clientY - rect.top;
            const isAbove = relativeY < rect.height / 2;

            row.classList.toggle('drag-over-above', isAbove);
            row.classList.toggle('drag-over-below', !isAbove);
        });
        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over-above', 'drag-over-below');
        });
        row.addEventListener('drop', event => {
            event.preventDefault();
            if (dragSourceIndex === null || dragSourceIndex === index) return;

            const rect = row.getBoundingClientRect();
            const relativeY = event.clientY - rect.top;
            const isAbove = relativeY < rect.height / 2;

            let targetIndex = isAbove ? index : index + 1;
            if (dragSourceIndex < targetIndex) {
                targetIndex--;
            }

            reorderPlaylist(dragSourceIndex, targetIndex);
            dragSourceIndex = null;
        });

        row.addEventListener('click', () => {
            selectedIndex = index;
            savePlaylist();
            render();
        });
        row.addEventListener('dblclick', () => playIndex(index));
        row.addEventListener('contextmenu', event => {
            event.preventDefault();
            selectedIndex = index;
            savePlaylist();
            render();
            window.desktopPlayer.showSongContextMenu(index);
        });
        tracksEl.appendChild(row);
    });
}

function loadDuration(track) {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = track.url;
    audio.onloadedmetadata = () => {
        track.duration = formatDuration(audio.duration);
        track.durationSeconds = audio.duration;
        savePlaylist();
        render();
    };
}

async function loadSavedPlaylist() {
    try {
        const savedData = await window.desktopPlayer.loadPlaylist();
        const localStorageData = readLocalStoragePlaylist();
        const shouldMigrateLocalStorage = !localStorage.getItem(playlistMigratedStorageKey)
            && localStorageData.playlist.length > 0;
        const source = savedData?.playlist?.length ? savedData : localStorageData;
        const savedPlaylist = source.playlist || [];
        const savedSelectedIndex = Number(source.selectedIndex);

        if (!Array.isArray(savedPlaylist)) return;

        for (const track of savedPlaylist) {
            if (!track || !track.path) continue;

            const normalizedTrack = normalizeTrack(track);
            playlist.push({
                id: track.id || `${track.path}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                path: track.path,
                url: track.url || normalizedTrack.url,
                fileName: normalizedTrack.fileName,
                folderName: track.folderName || getFolderNameFromPath(track.path),
                size: track.size || 0,
                lastModified: track.lastModified || '',
                artist: normalizedTrack.artist,
                title: normalizedTrack.title,
                album: normalizedTrack.album,
                albumArtist: normalizedTrack.albumArtist,
                date: normalizedTrack.date,
                composer: normalizedTrack.composer,
                comment: normalizedTrack.comment,
                additional: track.additional || '',
                cover: track.cover || './cover/mcat.png',
                genre: normalizedTrack.genre,
                duration: track.duration || '',
                durationSeconds: track.durationSeconds || 0,
                sampleRate: track.sampleRate || 0,
                bitsPerSample: track.bitsPerSample || 0,
                bitrate: track.bitrate || 0,
                channels: track.channels || 0,
                codec: track.codec || '',
                trackNo: normalizedTrack.trackNo,
            });
        }

        if (playlist.length > 0) {
            selectedIndex = Number.isInteger(savedSelectedIndex)
                ? Math.min(Math.max(savedSelectedIndex, 0), playlist.length - 1)
                : 0;
        }

        playlist.forEach(loadDuration);
        await refreshMissingMetadata();
        if (shouldMigrateLocalStorage || savedPlaylist.length > 0) {
            localStorage.setItem(playlistMigratedStorageKey, '1');
            await savePlaylist();
        }
    } catch (error) {
        console.warn('Failed to load saved playlist:', error);
    }
}

function readLocalStoragePlaylist() {
    try {
        return {
            playlist: JSON.parse(localStorage.getItem(playlistStorageKey) || '[]'),
            selectedIndex: localStorage.getItem(selectedIndexStorageKey),
        };
    } catch {
        return {
            playlist: [],
            selectedIndex: -1,
        };
    }
}

async function savePlaylist() {
    const tracksToSave = playlist.map(track => ({
        id: track.id,
        path: track.path,
        url: track.url,
        fileName: track.fileName,
        folderName: track.folderName,
        size: track.size,
        lastModified: track.lastModified,
        artist: track.artist,
        title: track.title,
        album: track.album,
        albumArtist: track.albumArtist,
        date: track.date,
        composer: track.composer,
        comment: track.comment,
        additional: track.additional,
        cover: track.cover,
        genre: track.genre,
        duration: track.duration,
        durationSeconds: track.durationSeconds,
        sampleRate: track.sampleRate,
        bitsPerSample: track.bitsPerSample,
        bitrate: track.bitrate,
        channels: track.channels,
        codec: track.codec,
        trackNo: track.trackNo,
    }));

    localStorage.setItem(playlistStorageKey, JSON.stringify(tracksToSave));
    localStorage.setItem(selectedIndexStorageKey, String(selectedIndex));
    await window.desktopPlayer.savePlaylist({
        playlist: tracksToSave,
        selectedIndex,
    });
}

function inferTrackNumber(fileName) {
    const match = fileName.match(/^(\d{1,3})[\s._-]/);
    return match ? match[1] : '';
}

function normalizeTrack(track) {
    const fileName = track.fileName || getFileNameFromPath(track.path) || track.title || 'Unknown file';
    const parsedName = stripExtension(fileName);
    const parsed = parseTrackName(parsedName);
    const trackNo = track.trackNo || parsed.trackNo;
    const oldTitle = String(track.title || '').trim();
    const titleLooksUnparsed = !oldTitle
        || oldTitle === fileName
        || oldTitle === parsedName
        || /^\d{1,3}[\s._-]+/.test(oldTitle);
    const artist = track.artist && track.artist !== 'Unknown Artist'
        ? track.artist
        : parsed.artist;
    const title = titleLooksUnparsed ? parsed.title : stripLeadingTrackNumber(oldTitle);

    return {
        ...track,
        fileName,
        url: track.url || '',
        folderName: track.folderName || getFolderNameFromPath(track.path),
        lastModified: track.lastModified || '',
        artist,
        title,
        album: track.album || '',
        albumArtist: track.albumArtist || '',
        date: track.date || '',
        composer: track.composer || '',
        comment: track.comment || '',
        genre: track.genre || '',
        durationSeconds: track.durationSeconds || 0,
        sampleRate: track.sampleRate || 0,
        bitsPerSample: track.bitsPerSample || 0,
        bitrate: track.bitrate || 0,
        channels: track.channels || 0,
        codec: track.codec || '',
        trackNo,
    };
}

async function refreshMissingMetadata() {
    const staleTracks = playlist.filter(track => !track.album && !track.sampleRate && track.path);
    if (staleTracks.length === 0) return;

    const refreshedTracks = await window.desktopPlayer.createTracksFromPaths(staleTracks.map(track => track.path));
    for (const refreshedTrack of refreshedTracks) {
        const existingTrack = playlist.find(track => track.path === refreshedTrack.path);
        if (!existingTrack) continue;

        Object.assign(existingTrack, {
            ...normalizeTrack({
                ...existingTrack,
                ...refreshedTrack,
            }),
            id: existingTrack.id,
            duration: existingTrack.duration || formatDuration(refreshedTrack.durationSeconds || 0),
        });
    }
}

async function rescanMetadata() {
    if (playlist.length === 0) return;

    const refreshedTracks = await window.desktopPlayer.createTracksFromPaths(playlist.map(track => track.path));
    for (const refreshedTrack of refreshedTracks) {
        const existingTrack = playlist.find(track => track.path === refreshedTrack.path);
        if (!existingTrack) continue;

        Object.assign(existingTrack, {
            ...normalizeTrack({
                ...existingTrack,
                ...refreshedTrack,
            }),
            id: existingTrack.id,
            duration: formatDuration(refreshedTrack.durationSeconds || existingTrack.durationSeconds || 0),
        });
    }

    await savePlaylist();
    render();
}

function parseTrackName(name) {
    const numbered = name.match(/^(\d{1,3})[\s._-]+(.+)$/);
    const trackNo = numbered ? numbered[1] : '';
    const cleanName = numbered ? numbered[2].trim() : name.trim();
    const parts = cleanName.split(' - ');

    if (parts.length > 1) {
        return {
            artist: parts.slice(0, -1).join(' - ').trim(),
            title: stripLeadingTrackNumber(parts[parts.length - 1].trim()),
            trackNo,
        };
    }

    return {
        artist: '',
        title: stripLeadingTrackNumber(cleanName),
        trackNo,
    };
}

function stripLeadingTrackNumber(value) {
    return String(value || '').replace(/^\d{1,3}[\s._-]+/, '').trim();
}

function stripExtension(fileName) {
    return String(fileName || '').replace(/\.[^.]+$/, '');
}

function getFileNameFromPath(filePath) {
    return String(filePath || '').split(/[\\/]/).pop();
}

function getFolderNameFromPath(filePath) {
    const normalized = String(filePath || '').replace(/[\\/][^\\/]*$/, '');
    return normalized;
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return '';

    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remaining}`;
}

function showDropTarget() {
    document.body.classList.add('dragging');
}

function hideDropTarget() {
    document.body.classList.remove('dragging');
}

function setPlayPauseIcon() {
    playPauseButton.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    playPauseIcon.setAttribute('href', isPlaying ? '#icon-pause' : '#icon-play');
}

function updateNowPlayingInfo() {
    if (!playbackState || !playbackState.track) {
        document.title = 'Visualizer Library';
        if (!isRecording) {
            statusEl.textContent = playbackState?.status || 'Playback stopped';
        }
        return;
    }

    const track = playbackState.track;
    const titleParts = [
        track.artist && track.artist !== 'Unknown Artist' ? track.artist : '',
        track.trackNo ? `#${track.trackNo}` : '',
        track.title || track.fileName || 'Unknown Title',
        track.additional ? `// ${track.additional}` : '',
    ].filter(Boolean);

    document.title = `${titleParts.join(' ')} [Visualizer Library]`;
    if (!isRecording) {
        statusEl.textContent = formatPlaybackDetails(playbackState);
    }
}

function renderProperties() {
    const track = playlist[selectedIndex];
    if (!track) {
        selectionPropertiesEl.innerHTML = '<div class="property-section">Metadata</div>';
        return;
    }

    const metadataRows = [
        ['Artist Name', track.artist],
        ['Track Title', track.title],
        ['Album Title', track.album],
        ['Date', track.date],
        ['Genre', track.genre && track.genre !== 'Default' ? track.genre : ''],
        ['Composer', track.composer],
        ['Album Artist', track.albumArtist],
        ['Track Number', track.trackNo],
        ['Comment', track.comment],
    ];
    const locationRows = [
        ['File name', track.fileName],
        ['Folder name', track.folderName],
        ['File path', track.path],
        ['Subsong index', '0'],
        ['File size', formatFileSize(track.size)],
        ['Last modified', formatDateTime(track.lastModified)],
    ];
    const generalRows = [
        ['Items Selected', '1'],
        ['Duration', formatPreciseDuration(track.durationSeconds, track.duration, track.sampleRate)],
        ['Sample rate', track.sampleRate ? `${track.sampleRate} Hz` : ''],
        ['Channels', track.channels],
        ['Bits per sample', track.bitsPerSample],
        ['Bitrate', formatBitrate(track.bitrate, track.size, track.durationSeconds)],
        ['Codec', track.codec],
    ];

    selectionPropertiesEl.innerHTML = [
        renderPropertySection('Metadata', metadataRows),
        renderPropertySection('Location', locationRows),
        renderPropertySection('General', generalRows),
    ].join('');
}

function renderPropertySection(title, rows) {
    return `
        <div class="property-section">${escapeHtml(title)}</div>
        ${rows.map(([name, value]) => renderPropertyRow(name, value)).join('')}
    `;
}

function renderPropertyRow(name, value) {
    const text = value === 0 ? '0' : String(value || '');
    return `
        <div class="property-row">
            <span title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <span title="${escapeHtml(text)}">${escapeHtml(text)}</span>
        </div>
    `;
}

function formatFileSize(size) {
    if (!size) return '';
    const mb = size / 1024 / 1024;
    return `${mb.toFixed(1)} MB (${size.toLocaleString()} bytes)`;
}

function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
}

function formatPreciseDuration(seconds, fallback, sampleRate) {
    if (!seconds) return fallback || '';
    const samples = sampleRate ? ` (${Math.round(seconds * sampleRate).toLocaleString()} samples)` : '';
    return `${seconds.toFixed(3)}${samples}`;
}

function formatBitrate(bitrate, size, duration) {
    if (bitrate) return `${Math.round(bitrate / 1000)} kbps`;
    return getEstimatedBitrate(size, duration);
}

function formatPlaybackDetails(state) {
    const track = state.track || {};
    const fileType = getFileType(track.fileName || track.path);
    const duration = state.duration || parseDuration(track.duration) || 0;
    const bitrate = getEstimatedBitrate(track.size, duration);
    const timeInfo = `${formatDuration(state.currentTime || 0)} / ${formatDuration(duration)}`;
    const playState = state.playing ? 'Playing' : 'Paused';
    const trackInfo = [
        track.artist && track.artist !== 'Unknown Artist' ? track.artist : '',
        track.title,
    ].filter(Boolean).join(' - ');
    const details = [fileType, bitrate, timeInfo, trackInfo || state.status].filter(Boolean);

    return `${playState} | ${details.join(' | ')}`;
}

function getEstimatedBitrate(size, duration) {
    if (!size || !duration) return '';
    return `${Math.round((size * 8) / duration / 1000)} kbps`;
}

function getFileType(fileName) {
    const extension = String(fileName || '').split('.').pop();
    return extension && extension !== fileName ? extension.toUpperCase() : '';
}

function parseDuration(duration) {
    const match = String(duration || '').match(/^(\d+):(\d{2})$/);
    if (!match) return 0;

    return Number(match[1]) * 60 + Number(match[2]);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

setPlayPauseIcon();
updateNowPlayingInfo();

let currentVisibility = { name: true, artist: true, cover: true };

function loadVisibilitySettings() {
    try {
        const saved = localStorage.getItem('visualizer-visibility-v1');
        if (saved) {
            currentVisibility = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Failed to load visibility settings:', e);
    }
    return currentVisibility;
}

function saveVisibilitySettings() {
    try {
        localStorage.setItem('visualizer-visibility-v1', JSON.stringify(currentVisibility));
    } catch (e) {
        console.warn('Failed to save visibility settings:', e);
    }
    window.desktopPlayer.updateVisibility(currentVisibility);
    updateViewMenuItems(currentVisibility);
}

function toggleVisibilityField(field) {
    currentVisibility[field] = !currentVisibility[field];
    saveVisibilitySettings();
}

function updateViewMenuItems(visibility) {
    const nameBtn = document.getElementById('viewToggleName');
    const artistBtn = document.getElementById('viewToggleArtist');
    const coverBtn = document.getElementById('viewToggleCover');

    if (nameBtn) nameBtn.textContent = (visibility.name ? '✓ ' : '  ') + 'Show Name';
    if (artistBtn) artistBtn.textContent = (visibility.artist ? '✓ ' : '  ') + 'Show Artist';
    if (coverBtn) coverBtn.textContent = (visibility.cover ? '✓ ' : '  ') + 'Show Cover';
}

loadSavedPlaylist().then(() => {
    loadVisibilitySettings();
    updateViewMenuItems(currentVisibility);
    window.desktopPlayer.updateVisibility(currentVisibility);
    render();
});
