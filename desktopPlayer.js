let song = false;
let loading = false;
let progressTimer = false;

window.desktopPlayer.onPlayTrack(track => {
    song = {
        Artist: track.artist || '',
        Title: track.title || track.fileName || 'Unknown Title',
        Additional: track.additional || '',
        Audio: track.url,
        Cover: track.cover || './cover/mcat.png',
        Genre: track.genre || 'Default',
        Track: track,
    };

    playSong();
});

window.desktopPlayer.onTogglePlayback(() => {
    const audio = document.getElementById('audio');
    if (audio.paused) {
        audio.play();
    } else {
        audio.pause();
    }
});

window.desktopPlayer.onStop(() => {
    const audio = document.getElementById('audio');
    audio.pause();
    audio.currentTime = 0;
    stopProgressUpdates();
    song = false;
    sendPlaybackState('Playback stopped');
});

window.desktopPlayer.onSeek(time => {
    const audio = document.getElementById('audio');
    if (audio) {
        audio.currentTime = time;
    }
});

async function playSong() {
    if (!song || loading) return;
    loading = true;

    typeOut(document.getElementById('title'), 300);
    await sleep(80);
    typeOut(document.getElementById('artist'), 300);
    await sleep(80);
    await typeOut(document.getElementById('additional'), 300, true);

    const audio = document.getElementById('audio');
    audio.src = song.Audio;
    changeColor(song.Genre);
    switchCover(song.Cover);

    await sleep(250);

    document.getElementById('artistTest').innerText = song.Artist || song.Title;
    document.getElementById('artistTest').style.fontSize = '111px';

    let isOk = false;
    let fontSize = 111;
    while (!isOk) {
        if (document.getElementById('artistTest').offsetWidth > 1348) {
            document.getElementById('artistTest').style.fontSize = `${fontSize--}px`;
        } else {
            isOk = true;
        }
    }

    if (song.Additional) {
        document.getElementById('artist').style.fontSize = (fontSize < 111 ? fontSize : 93) + 'px';
        document.getElementById('title').style.marginTop = '0px';
    } else {
        document.getElementById('artist').style.fontSize = (fontSize < 111 ? fontSize : 111) + 'px';
        document.getElementById('title').style.marginTop = '-5px';
    }

    typeIn(document.getElementById('additional'), song.Additional || '', 650, true);
    typeIn(document.getElementById('artist'), song.Artist, 650);
    await sleep(80);
    await typeIn(document.getElementById('title'), song.Title, 650);

    loading = false;
}

document.getElementById('audio').oncanplaythrough = () => {
    document.getElementById('audio').play();
};

document.getElementById('audio').onplay = () => {
    startProgressUpdates();
    sendPlaybackState();
};

document.getElementById('audio').onpause = () => {
    sendPlaybackState();
};

document.getElementById('audio').onended = () => {
    stopProgressUpdates();
    window.desktopPlayer.trackEnded();
};

document.getElementById('audio').ontimeupdate = () => {
    sendPlaybackState();
};

document.getElementById('audio').onloadedmetadata = () => {
    sendPlaybackState();
};

function startProgressUpdates() {
    if (progressTimer) return;
    progressTimer = setInterval(sendPlaybackState, 1000);
}

function stopProgressUpdates() {
    if (!progressTimer) return;
    clearInterval(progressTimer);
    progressTimer = false;
}

function sendPlaybackState(status) {
    const audio = document.getElementById('audio');
    const track = song ? song.Track : null;
    const playing = !audio.paused && !audio.ended;

    window.desktopPlayer.playbackState({
        playing,
        status,
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        track: track ? {
            artist: track.artist || song.Artist || '',
            title: track.title || song.Title,
            album: track.album || '',
            albumArtist: track.albumArtist || '',
            date: track.date || '',
            genre: track.genre || '',
            composer: track.composer || '',
            comment: track.comment || '',
            additional: track.additional || song.Additional || '',
            fileName: track.fileName || '',
            path: track.path || '',
            folderName: track.folderName || '',
            lastModified: track.lastModified || '',
            size: track.size || 0,
            trackNo: track.trackNo || '',
            duration: track.duration || '',
            durationSeconds: track.durationSeconds || 0,
            sampleRate: track.sampleRate || 0,
            bitsPerSample: track.bitsPerSample || 0,
            bitrate: track.bitrate || 0,
            channels: track.channels || 0,
            codec: track.codec || '',
        } : null,
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function typeOut(element, duration, isAdditional) {
    const text = element.innerText;
    if (!text.length) return;

    for (let i = 0; i <= text.length; i++) {
        element.innerText = text.slice(0, text.length - i);
        if (element.innerText === '' && !isAdditional) {
            element.innerText = ' ';
        }
        await sleep(duration / text.length);
    }
}

async function typeIn(element, text, duration, isAdditional) {
    if (!text.length) {
        element.innerText = isAdditional ? '' : ' ';
        return;
    }

    for (let i = 0; i <= text.length; i++) {
        element.innerText = text.slice(0, i);
        if (element.innerText === '' && !isAdditional) {
            element.innerText = ' ';
        }
        await sleep(duration / text.length);
    }
}

async function switchCover(url) {
    const cover = document.getElementById('cover');
    const coverNew = document.getElementById('coverNew');
    coverNew.src = url;

    coverNew.onload = async () => {
        cover.style.scale = '0.95';
        cover.style.transform = 'rotateY(90deg)';
        await sleep(90);
        coverNew.style.transform = 'rotateY(0deg)';
        coverNew.style.scale = '1';

        await sleep(200);
        cover.src = coverNew.src;
        cover.onload = async () => {
            cover.style.transform = 'rotateY(0deg)';
            cover.style.scale = '1';
            await sleep(200);
            cover.style.opacity = '1';
            coverNew.style.opacity = '0';
            coverNew.style.transform = 'rotateY(270deg)';
            coverNew.style.scale = '0.95';
        };
    };
}

function applyVisibility(visibility) {
    if (!visibility) return;
    const titleEl = document.getElementById('title');
    const artistEl = document.getElementById('artist');
    const additionalEl = document.getElementById('additional');
    const coverEl = document.getElementById('cover');
    const coverNewEl = document.getElementById('coverNew');

    if (titleEl) titleEl.style.display = visibility.name ? '' : 'none';
    if (artistEl) artistEl.style.display = visibility.artist ? '' : 'none';
    if (additionalEl) additionalEl.style.display = visibility.artist ? '' : 'none';
    if (coverEl) coverEl.style.display = visibility.cover ? '' : 'none';
    if (coverNewEl) coverNewEl.style.display = visibility.cover ? '' : 'none';
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const visibility = await window.desktopPlayer.getVisibilitySettings();
        applyVisibility(visibility);
    } catch (e) {
        console.warn('Failed to load visibility settings:', e);
    }
});

window.desktopPlayer.onUpdateVisibility(visibility => {
    applyVisibility(visibility);
});
