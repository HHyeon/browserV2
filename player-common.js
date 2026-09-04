/**
 * player-common.js - 공통 비디오 플레이어 유틸리티
 *
 * 사용법:
 *   const pc = createPlayerCommon({ bookmarkMode: 'vr', volumeStep: 0.1 });
 *   pc.init({ label1, progressPanel, ... });
 */

function createPlayerCommon(opts) {
    const config = Object.assign({
        bookmarkMode: null,       // null | 'vr'
        volumeStep: 0.01,
        initialVolume: 0.2,
        defaultSpeed: 1.0,
        showProgressAfterSeek: false,
    }, opts);

    // ---- State ----
    let FFMPEG_SERVER_URL = '';
    let video_saturate = 1.0, video_contrast = 1.0, video_brightness = 1.0;
    let bookmarks = [];
    let currentVideoPath = '';
    let bookmarkPanelVisible = true;
    let player_paused_state = false;
    let skip_pause = false;
    let muteState = false, mutevolumestore = 0.00;
    let delayedoffTimer = undefined;
    let progressHideTimer = null;
    let progressPanelDragging = false;
    let progressPanelDragStartX = 0, progressPanelDragStartY = 0;
    let progressPanelTranslateX = 0, progressPanelTranslateY = 0;

    // ---- DOM refs (set via init) ----
    let label1, progressPanel, progressBar, progressCurrent, progressTotal;
    let progressBarContainer, progressLink, bookmarkPanel;

    // ---- Config ----
    function getFfmpegUrl() { return FFMPEG_SERVER_URL || 'http://192.168.0.101:3002'; }

    fetch('ffmpeg_config.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(c => { const v = c && c.ffmpeg_server_url; if (typeof v === 'string' && v.trim()) FFMPEG_SERVER_URL = v.trim(); })
        .catch(() => {});

    // ---- Cookies ----
    function setCookie(cname, cvalue, exhours) {
        const d = new Date();
        d.setTime(d.getTime() + (exhours * 60 * 60 * 1000));
        document.cookie = cname + "=" + cvalue + ";expires=" + d.toUTCString() + ";path=/";
    }

    function getCookie(cname) {
        const name = cname + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) == ' ') c = c.substring(1);
            if (c.indexOf(name) == 0) return c.substring(name.length, c.length);
        }
        return "";
    }

    // ---- URL Params ----
    function parseUrlParams() {
        const urlParams = new URL(window.location.href).searchParams;

        let parampath = getCookie('parampath');
        if (parampath == '') { parampath = urlParams.get('p'); }
        else { setCookie('parampath', '', 0); }
        if (parampath && parampath.endsWith('/')) parampath = parampath.slice(0, -1);

        let paramfind = urlParams.get('f');

        let paramtime = urlParams.get('t');
        if (paramtime != null) paramtime = parseFloat(paramtime);
        if (paramtime != null && !Number.isFinite(paramtime)) paramtime = null;

        return { parampath, paramfind, paramtime };
    }

    // ---- Video Filter ----
    function video_filter_set() {
        if (typeof player !== 'undefined' && player) {
            player.style.filter = `saturate(${video_saturate}) contrast(${video_contrast}) brightness(${video_brightness})`;
        }
    }

    // ---- dirseek ----
    async function dirseek(param) {
        try {
            const encoded = encodeURIComponent(param);
            const res = await fetch(`dirseek.php?x=${encoded}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error('dirseek failed', e);
            return { ret: false, data: [] };
        }
    }

    // ---- Label ----
    function setLabelText(msg) {
        if (!label1) return;
        if (delayedoffTimer != undefined) clearTimeout(delayedoffTimer);
        label1.innerText = msg;
        label1.style.visibility = "visible";
        delayedoffTimer = setTimeout(() => {
            label1.style.visibility = "hidden";
            delayedoffTimer = undefined;
        }, 1000);
    }

    // ---- Playback ----
    function pauseplay(playFn) {
        if (player_paused_state) {
            player_paused_state = false;
            if (playFn) playFn(); else player.play();
            setLabelText("play");
        } else {
            player_paused_state = true;
            player.pause();
            setLabelText("pause");
        }
        showProgressPanel();
    }

    function volumncontrol(updown) {
        const unit = config.volumeStep;
        let v = player.volume;
        v = updown ? Math.min(1.0, v + unit) : Math.max(0, v - unit);
        player.volume = v;
        setLabelText(`volumn: ${parseInt(player.volume * 100)}%`);
    }

    function numberpadseeking(num) {
        if (num >= 0 && num <= 9 && player.duration) {
            player.currentTime = (player.duration / 10) * num;
            setLabelText(`(${(player.currentTime / player.duration * 100).toFixed(2)}%)`);
        }
    }

    // ---- Time Formatting ----
    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // ---- Progress Panel ----
    function updateProgressPanel() {
        if (!player || !player.duration) return;
        progressBar.style.width = ((player.currentTime / player.duration) * 100) + '%';
        progressCurrent.textContent = formatTime(player.currentTime);
        progressTotal.textContent = formatTime(player.duration);
    }

    function showProgressPanel(keepVisible) {
        if (progressHideTimer) clearTimeout(progressHideTimer);
        progressPanel.style.opacity = '1';
        progressPanel.style.visibility = 'visible';
        const hovering = progressPanel.matches(':hover');
        if (!keepVisible && !hovering) {
            progressHideTimer = setTimeout(() => {
                progressPanel.style.opacity = '0';
                progressPanel.style.visibility = 'hidden';
                progressHideTimer = null;
            }, 500);
        } else {
            progressHideTimer = null;
        }
    }

    function hideProgressPanel() {
        if (progressHideTimer) clearTimeout(progressHideTimer);
        progressPanel.style.opacity = '0';
        progressPanel.style.visibility = 'hidden';
        progressHideTimer = null;
    }

    // ---- Bookmarks ----
    function bookmarkModeParam() { return config.bookmarkMode ? `mode=${config.bookmarkMode}&` : ''; }
    function bookmarkModeBody(extra) {
        const body = Object.assign({}, extra);
        if (config.bookmarkMode) body.mode = config.bookmarkMode;
        return body;
    }

    async function bookmarkFetch(path) {
        try {
            const res = await fetch(`bookmark.php?${bookmarkModeParam()}path=${encodeURIComponent(path)}`, { cache: 'no-store' });
            const json = await res.json();
            return json.ret ? json.bookmarks : [];
        } catch (e) {
            console.error('bookmarkFetch error', e);
            return [];
        }
    }

    function cacheBookmarkThumb(videoPath, seekTime) {
        fetch(`${getFfmpegUrl()}/decode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoPath, seekTime })
        })
        .then(r => r.json())
        .then(result => {
            if (result.success && result.base64 && result.base64.length > 100) {
                fetch('bookmark_thumb.php?cache=1', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: videoPath, time: seekTime, base64: result.base64 })
                }).catch(() => {});
            }
        }).catch(() => {});
    }

    async function bookmarkAdd(path, time, name) {
        try {
            const res = await fetch('bookmark.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookmarkModeBody({ action: 'add', path, time, name }))
            });
            const json = await res.json();
            if (json.ret && currentVideoPath === path) {
                bookmarks = json.bookmarks;
                renderBookmarkPanel();
            }
            cacheBookmarkThumb(path, time);
            return json.ret;
        } catch (e) {
            console.error('bookmarkAdd error', e);
            return false;
        }
    }

    async function bookmarkRemove(path, id) {
        try {
            const res = await fetch('bookmark.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookmarkModeBody({ action: 'remove', path, id }))
            });
            const json = await res.json();
            if (json.ret && currentVideoPath === path) {
                bookmarks = json.bookmarks;
                renderBookmarkPanel();
            }
            return json.ret;
        } catch (e) {
            console.error('bookmarkRemove error', e);
            return false;
        }
    }

    async function loadBookmarksFor(path) {
        currentVideoPath = path;
        const loadedBookmarks = await bookmarkFetch(path);
        if (currentVideoPath !== path) return;
        bookmarks = loadedBookmarks;
        renderBookmarkPanel();
    }

    function seekToBookmark(bm) {
        if (!player || !player.duration) return;
        player.currentTime = Math.min(bm.time, player.duration - 0.5);
        setLabelText(`bookmark - ${bm.name} (${(player.currentTime / player.duration * 100).toFixed(2)}%)`);
        updateProgressPanel();
        if (config.showProgressAfterSeek) showProgressPanel();
    }

    function renderBookmarkMarkers() {
        progressBarContainer.querySelectorAll('.bookmark-marker').forEach(el => el.remove());
        if (!player.duration || bookmarks.length == 0) return;
        bookmarks.forEach(bm => {
            const marker = document.createElement('div');
            marker.className = 'bookmark-marker';
            marker.style.left = ((bm.time / player.duration) * 100) + '%';
            marker.title = `${bm.name} (${formatTime(bm.time)})`;
            marker.addEventListener('click', (e) => { e.stopPropagation(); seekToBookmark(bm); });
            progressBarContainer.appendChild(marker);
        });
    }

    function renderBookmarkPanel() {
        bookmarkPanel.innerHTML = '';
        renderBookmarkMarkers();
        if (bookmarks.length == 0) {
            bookmarkPanel.innerHTML = '<div class="bookmark-empty">no bookmarks</div>';
            return;
        }
        bookmarks.forEach(bm => {
            const row = document.createElement('div');
            row.className = 'bookmark-row';
            row.title = `${bm.name} @ ${bm.time}s`;
            row.dataset.id = bm.id;

            const timeEl = document.createElement('span');
            timeEl.className = 'bookmark-time';
            timeEl.textContent = bm.name;

            const nameEl = document.createElement('span');
            nameEl.className = 'bookmark-name';
            nameEl.textContent = `${bm.time.toFixed(1)}s`;

            const delEl = document.createElement('span');
            delEl.className = 'bookmark-del';
            delEl.textContent = '\u00d7';
            delEl.addEventListener('click', (e) => { e.stopPropagation(); bookmarkRemove(currentVideoPath, bm.id); });

            row.appendChild(timeEl);
            row.appendChild(nameEl);
            row.appendChild(delEl);
            row.addEventListener('click', () => { seekToBookmark(bm); });
            bookmarkPanel.appendChild(row);
        });
        updateActiveBookmark();
    }

    function toggleBookmarkPanel(force) {
        bookmarkPanelVisible = (force !== undefined) ? force : !bookmarkPanelVisible;
        bookmarkPanel.classList.toggle('hidden', !bookmarkPanelVisible);
    }

    function updateActiveBookmark() {
        if (!bookmarks.length || !player || !player.duration) return;
        const ct = player.currentTime;
        let nearest = bookmarks[0], nearestDist = Math.abs(bookmarks[0].time - ct);
        for (let i = 1; i < bookmarks.length; i++) {
            const dist = Math.abs(bookmarks[i].time - ct);
            if (dist < nearestDist) { nearestDist = dist; nearest = bookmarks[i]; }
        }
        bookmarkPanel.querySelectorAll('.bookmark-row').forEach(row => {
            row.classList.toggle('active', row.dataset.id === String(nearest.id));
        });
    }

    // ---- Progress Panel Events ----
    function setupProgressEvents() {
        progressLink.addEventListener('contextmenu', e => e.stopPropagation());
        progressLink.href = window.location.href;

        progressBarContainer.addEventListener('click', (e) => {
            const rect = progressBarContainer.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            if (player.duration) { player.currentTime = player.duration * percent; updateProgressPanel(); showProgressPanel(); }
        });

        progressBarContainer.addEventListener('mousedown', e => e.stopPropagation());

        document.getElementById('btn-bookmark-prev').addEventListener('click', (e) => {
            e.stopPropagation();
            if (bookmarks.length == 0) { setLabelText('no bookmarks'); return; }
            const ct = player.currentTime;
            let prev;
            for (let i = bookmarks.length - 1; i >= 0; i--) { if (bookmarks[i].time < ct - 0.5) { prev = bookmarks[i]; break; } }
            if (prev == undefined) prev = bookmarks[bookmarks.length - 1];
            seekToBookmark(prev);
            showProgressPanel(true);
        });

        document.getElementById('btn-bookmark-add').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!player.duration || !currentVideoPath) return;
            const t = player.currentTime;
            bookmarkAdd(currentVideoPath, t, formatTime(t));
            setLabelText(`bookmark saved - ${formatTime(t)}`);
            showProgressPanel(true);
        });

        document.getElementById('btn-bookmark-next').addEventListener('click', (e) => {
            e.stopPropagation();
            if (bookmarks.length == 0) { setLabelText('no bookmarks'); return; }
            const ct = player.currentTime;
            let next = bookmarks.find(b => b.time > ct + 0.5);
            if (next == undefined) next = bookmarks[0];
            seekToBookmark(next);
            showProgressPanel(true);
        });

        progressPanel.addEventListener('mousedown', (e) => {
            if (e.target.id === 'progress-bar-container' || e.target.id === 'progress-bar' ||
                e.target.classList.contains('progress-bookmark-btn') || e.target.closest('#progress-bookmark-btns')) return;
            e.preventDefault(); e.stopPropagation();
            progressPanelDragging = true;
            progressPanelDragStartX = e.clientX - progressPanelTranslateX;
            progressPanelDragStartY = e.clientY - progressPanelTranslateY;
            progressPanel.style.cursor = 'move';
            showProgressPanel(true);
        });

        document.addEventListener('mousemove', (e) => {
            if (progressPanelDragging) {
                progressPanelTranslateX = e.clientX - progressPanelDragStartX;
                progressPanelTranslateY = e.clientY - progressPanelDragStartY;
                progressPanel.style.transform = `translate(${progressPanelTranslateX}px, ${progressPanelTranslateY}px)`;
                showProgressPanel(true);
            }
        });

        document.addEventListener('mouseup', () => {
            if (progressPanelDragging) { progressPanelDragging = false; progressPanel.style.cursor = ''; }
        });

        progressPanel.addEventListener('mouseenter', () => showProgressPanel(true));
        progressPanel.addEventListener('mouseleave', () => { if (!progressPanelDragging) showProgressPanel(); });
    }

    // ---- Init ----
    function init(domRefs) {
        label1 = domRefs.label1;
        progressPanel = domRefs.progressPanel;
        progressBar = domRefs.progressBar;
        progressCurrent = domRefs.progressCurrent;
        progressTotal = domRefs.progressTotal;
        progressBarContainer = domRefs.progressBarContainer;
        progressLink = domRefs.progressLink;
        bookmarkPanel = domRefs.bookmarkPanel;
        setupProgressEvents();
    }

    // ---- Export ----
    return {
        config,
        getFfmpegUrl, setCookie, getCookie,
        parseUrlParams, video_filter_set, dirseek,
        setLabelText, pauseplay, volumncontrol, numberpadseeking,
        formatTime, updateProgressPanel, showProgressPanel, hideProgressPanel,
        bookmarkFetch, bookmarkAdd, bookmarkRemove, loadBookmarksFor, seekToBookmark,
        renderBookmarkMarkers, renderBookmarkPanel, toggleBookmarkPanel, updateActiveBookmark,
        cacheBookmarkThumb,
        init,
        get bookmarks() { return bookmarks; },
        set bookmarks(v) { bookmarks = v; },
        get currentVideoPath() { return currentVideoPath; },
        set currentVideoPath(v) { currentVideoPath = v; },
        get player_paused_state() { return player_paused_state; },
        set player_paused_state(v) { player_paused_state = v; },
        get skip_pause() { return skip_pause; },
        set skip_pause(v) { skip_pause = v; },
        get muteState() { return muteState; },
        set muteState(v) { muteState = v; },
        get mutevolumestore() { return mutevolumestore; },
        set mutevolumestore(v) { mutevolumestore = v; },
        get bookmarkPanelVisible() { return bookmarkPanelVisible; },
    };
}
