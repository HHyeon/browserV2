
// 🔑 FFmpeg 디코딩 서버 URL — ffmpeg_config.json 에서 로드 (비어 있으면 현재 호스트 자동 감지)
let FFMPEG_SERVER_URL = '';

function getFfmpegUrl() {
    return FFMPEG_SERVER_URL || `http://${location.hostname}:3002`;
}

fetch('ffmpeg_config.json', { cache: 'no-store' })
    .then(res => res.ok ? res.json() : Promise.reject(new Error('not found')))
    .then(cfg => {
        const v = cfg && cfg.ffmpeg_server_url;
        if (typeof v === 'string' && v.trim()) FFMPEG_SERVER_URL = v.trim();
    })
    .catch(() => {});

// 🔑 WebXR 지원 여부 캐시 (네이티브 VR 런처 활성화용)
let webxrSupported = false;
if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then(s => { webxrSupported = s; }).catch(() => {});
}

function getVRViewerPath() {
    return webxrSupported ? 'videoview180-vr.html' : 'videoview180.html';
}



const urlParams = (new URL(window.location.href)).searchParams;


let paramfind = urlParams.get('f');


let parampath = urlParams.get('p');
if(parampath != null)
    document.title = parampath.substring(parampath.lastIndexOf('/')+1, parampath.length);


let parampathgiven = true;
if(parampath == '.' || parampath == null)
    parampathgiven = false;
else
{
    if(parampath[parampath.length-1] == '/') parampath = parampath.substring(0, parampath.length-1);

    parampath = encodeURI(parampath);
}

if(parampath == null) parampath = '.';
// console.log(`parampath - ${parampath}`);

// 🔑 경로별 설정 (listordertype, ratingordertoggle): localStorage 단일 JSON 맵
function getPathPrefs() {
    try { return JSON.parse(localStorage.getItem('listordertype_paths') || '{}'); }
    catch(e) { return {}; }
}

function getPathPref() {
    return getPathPrefs()[parampath] || {};
}

function setPathPref(patch) {
    const prefs = getPathPrefs();
    prefs[parampath] = { ...(prefs[parampath] || {}), ...patch };
    localStorage.setItem('listordertype_paths', JSON.stringify(prefs));
}


// 🔑 XSS 방지: 파일명은 외부(파일시스템) 입력이므로 HTML/URL 컨텍스트마다 이스케이프
function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function encodeUriSafe(s) {
    return encodeURI(String(s ?? ''));
}

// 별점 버튼 클릭 위임 (inline onclick의 JS 컨텍스트 주입 제거)
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.rating-btn[data-rating-action]');
    if (!btn) return;
    const fname = btn.getAttribute('data-rating-fname');
    if (!fname) return;
    if (btn.dataset.ratingAction === 'up') onRatingUp(fname);
    else onRatingDown(fname);
});

let dirlist = [];
let dirFlagMap = {}; // fname -> is_dir (dirseek.php 제공, 항목별 프로브 요청 생략용)
let item_w, item_h;
let TopScrollView = document.getElementById('scroll-views');
let MainTitle = document.getElementById('MainTitle');
let typing_panel = document.getElementById('typing_panel');

let input_search = document.querySelector('.input_search');


const visual_pictures_row_item_px = 600;
const visual_pictures_row_max = 4;
let visual_pictures_row = 0;
let visual_pictures_col = 0;


async function dirseek(param) {
    try {
        // const encoded = encodeURIComponent(param);
        const encoded = param;
        const res = await fetch(`dirseek.php?x=${encoded}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json(); // { ret: bool, data: [...] }
    } catch (e) {
        console.error('dirseek failed', e);
        return { ret: false, data: [] };
    }
}

// 🔑 별점: rate.php 서버 저장
async function getRating(folderName) {
    try {
        const res = await fetch(`rate.php?name=${encodeURIComponent(folderName)}`);
        const json = await res.json();
        return json.ret ? json.value : 0;
    } catch (e) {
        console.error('getRating error', e);
        return 0;
    }
}

async function setRating(folderName, value) {
    try {
        const res = await fetch('rate.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: folderName, value: value })
        });
        const json = await res.json();
        return json.ret;
    } catch (e) {
        console.error('setRating error', e);
        return false;
    }
}


let lastVisibleStart = 0;  // 이전 렌더링의 시작 인덱스
let lastVisibleEnd = 0;    // 이전 렌더링의 끝 인덱스


function eliminate_out_of_range_items(visibleItemStart, visibleItemEnd) {
    // 제거: 현재 화면 범위(visibleItemStart..visibleItemEnd) 밖의 모든 항목 제거
    document.querySelectorAll('[data-item-index]').forEach(el => {
        const idxStr = el.getAttribute('data-item-index');
        const idx = Number(idxStr);
        if (isNaN(idx)) return;
        if (idx < visibleItemStart || idx >= visibleItemEnd) {
            // 비디오 요소 gracefully 정지
            const videos = el.querySelectorAll('video');
            videos.forEach(video => {
                video.pause();
                video.removeAttribute('src');
                video.load(); // 네트워크 해제
            });
            el.remove();
            console.log(`[Remove] Item ${idx} (out of range)`);
        }
    });
}


async function refreshinginfinitylist(force=false)
{
    // 계산: 현재 화면에 보여야 할 항목 범위
    const visibleStart = scrolleditemidx;
    const visibleEnd = Math.min(scrolleditemidx + visual_pictures_col, Math.ceil(dirlist.length / visual_pictures_row));
    const visibleItemStart = visibleStart * visual_pictures_row;
    const visibleItemEnd = visibleEnd * visual_pictures_row;

    console.log(`[Refresh] Current: ${visibleItemStart}-${visibleItemEnd}, Last: ${lastVisibleStart}-${lastVisibleEnd}, Force: ${force}`);

    // 🔑 force=true: 완전 초기화 모드 (캐시 삭제 후 전체 새로고침)
    if(force) {
        console.log('[Refresh] Force mode: Complete reload');
        TopScrollView.innerHTML = '';
        lastVisibleStart = 0;
        lastVisibleEnd = 0;
    }

    // 첫 렌더링인 경우: 전체 DOM 초기화
    if(lastVisibleStart === 0 && lastVisibleEnd === 0) {
        console.log('[Refresh] Initial render: Loading visible area');
        TopScrollView.innerHTML = '';
        
        for(let i=0; i<visual_pictures_row*visual_pictures_col; i++) {
            const idx = i + (scrolleditemidx * visual_pictures_row);
            if(idx >= dirlist.length) break;
            
            const dirlist_item = dirlist[idx];
            const pos_x = (item_w) * (i % visual_pictures_row);
            const pos_y = (item_h) * (Math.floor(i / visual_pictures_row) + scrolleditemidx);
            
            const html = await makeitem(item_w, item_h, pos_x, pos_y, dirlist_item.fname, dirlist_item.text, force);
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html;
            const itemElem = wrapper.firstElementChild;
            if (itemElem) {
                itemElem.setAttribute('data-item-index', idx);
                TopScrollView.appendChild(itemElem);
                
                const imgWithFname = itemElem.querySelector('img[data-fname]');
                if (imgWithFname) {
                    thumbnailObserver.observe(imgWithFname);
                    ThumbnailIntervalManager.setupProgressBar(itemElem, imgWithFname.dataset.fname);
                }
            }
        }
        
        lastVisibleStart = visibleItemStart;
        lastVisibleEnd = Math.min(visibleItemEnd, dirlist.length);
        console.log(`[Refresh] Initial render complete: ${lastVisibleStart}-${lastVisibleEnd}`);
    }
    // 범위 변경이 없고 force 아니면 스킵
    else if(visibleItemStart === lastVisibleStart && visibleItemEnd === lastVisibleEnd && !force) {
        console.log('[Refresh] No range change, skip');
        return;
    }
    // 범위 변경 또는 force=true: 추가 항목 로드
    else {
        console.log(`[Refresh] Range changed or forced: ${visibleItemStart}-${visibleItemEnd}`);
        console.log(`[Refresh] Previous range: ${lastVisibleStart}-${lastVisibleEnd}`);

        const itemsToAdd = [];
        
        // 위로 스크롤: 새 범위가 이전 범위보다 위에 있는 경우
        if(visibleItemStart < lastVisibleStart) {
            console.log('[Refresh] Scrolled up: adding items above');
            
            if(lastVisibleStart - visibleItemStart > visual_pictures_row * visual_pictures_col) {
                // 너무 많은 항목을 추가하는 경우, 화면에 보이는 만큼만 로드
                const maxItems = visual_pictures_row * visual_pictures_col;
                for(let idx = visibleItemStart; idx < visibleItemStart + maxItems; idx++) {
                    itemsToAdd.push(idx);
                }
            } else {
                for(let idx = visibleItemStart; idx < lastVisibleStart; idx++) {
                    itemsToAdd.push(idx);
                }
            }
        }
        
        // 아래로 스크롤 또는 force: 새 범위가 이전 범위보다 아래에 있는 경우
        if(visibleItemEnd > lastVisibleEnd) {
            console.log('[Refresh] Scrolled down: adding items below');
            
            if(visibleItemEnd - lastVisibleEnd > visual_pictures_row * visual_pictures_col) {
                // 너무 많은 항목을 추가하는 경우, 화면에 보이는 만큼만 로드
                const maxItems = visual_pictures_row * visual_pictures_col;
                for(let idx = visibleItemStart; idx < visibleItemStart + maxItems; idx++) {
                    if(!itemsToAdd.includes(idx)) {
                        itemsToAdd.push(idx);
                    }
                }
            } else {
                for(let idx = lastVisibleEnd; idx < visibleItemEnd; idx++) {
                    if(!itemsToAdd.includes(idx)) {
                        itemsToAdd.push(idx);
                    }
                }
            }
        }

        console.log(`[Refresh] Items to add: ${itemsToAdd.length} items`);

        // 새로운 항목들을 DOM에 추가
        for(let idx of itemsToAdd) {
            if(idx >= 0 && idx < dirlist.length) {
                const dirlist_item = dirlist[idx];
                const row = Math.floor(idx / visual_pictures_row);
                const col = idx % visual_pictures_row;
                const pos_x = (item_w) * col;
                const pos_y = (item_h) * row;
                
                // skip if already present (prevents duplicate overlap)
                // force=true 시에는 무시하고 다시 만들기
                if (!TopScrollView.querySelector(`[data-item-index="${idx}"]`) || force) {
                    const html = await makeitem(item_w, item_h, pos_x, pos_y, dirlist_item.fname, dirlist_item.text, force);
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = html;
                    const itemElem = wrapper.firstElementChild;
                    if (itemElem) {
                        itemElem.setAttribute('data-item-index', idx);
                        TopScrollView.appendChild(itemElem);
                        
                        const imgWithFname = itemElem.querySelector('img[data-fname]');
                        if (imgWithFname) {
                            thumbnailObserver.observe(imgWithFname);
                            ThumbnailIntervalManager.setupProgressBar(itemElem, imgWithFname.dataset.fname);
                        }
                    }
                    console.log(`[Refresh] Added item ${idx}`);
                } else {
                    console.log(`[Refresh] Item ${idx} already exists, skipped`);
                }
            }
        }

        // 렌더링 범위 업데이트
        lastVisibleStart = visibleItemStart;
        lastVisibleEnd = Math.min(visibleItemEnd, dirlist.length);
        console.log(`[Refresh] Range updated: ${lastVisibleStart}-${lastVisibleEnd}`);
    }

    // console.log(`videos : ${document.querySelectorAll('video')}`);

    // if(true)
    // {
    //     document.querySelectorAll('video').forEach(video => {

    //         function setTime() {
    //             if (!Number.isFinite(video.duration)) {
    //                 console.log('duration not ready:', video.duration);
    //                 return;
    //             }

    //             if ('fastSeek' in video) {
    //                 video.fastSeek(video.duration / 3);
    //             } else {
    //                 video.currentTime = video.duration / 3;
    //             }

    //             video.addEventListener('seeked', () => {
    //                 const name = video.getAttribute('src');
    //                 // console.log(`video seeked - ${name} at ${video.currentTime}s`);
    //                 // video.speed
    //                 // video.playbackRate = 0.1;
    //                 // video.play();
    //             }, { once: true });
    //         }

    //         if(video.readyState >= 1 && Number.isFinite(video.duration)) {
    //             setTime();
    //         }
    //         else {
    //             console.log(`video metadata not ready, waiting - ${video.getAttribute('src')}`);
    //             video.addEventListener('loadedmetadata', setTime, { once: true });
    //         }
    //     });
    // }

    // 🔑 force=true일 때 비디오 큐 초기화
    if(force) {
        console.log('[Queue] Force mode: Resetting video queue flags');
        // 기존 비디오 요소의 큐 처리 플래그 제거 (새로 만들어진 요소들은 플래그가 없음)
        document.querySelectorAll('video[data-video-queued]').forEach(video => {
            video.removeAttribute('data-video-queued');
        });
    }

    // 🔑 새 코드: 아직 처리되지 않은 비디오를 큐에 추가하고 순차 처리 시작
    document.querySelectorAll('video:not([data-video-queued])').forEach(videoElement => {
        const videoName = videoElement.src.substring(videoElement.src.lastIndexOf('/') + 1);
        
        // 이미 처리됨 표시
        videoElement.dataset.videoQueued = 'true';

        // 🔑 데이터 속성에서 메타데이터 추출
        const fname = videoElement.getAttribute('data-fname') || '';
        const cacheKey = videoElement.getAttribute('data-cache-key') || '';

        // 큐에 추가
        videoLoadQueue.push({
            name: decodeURI(videoName),
            element: videoElement,
            fname: fname,              // ✅ makeitem_Store 키
            cacheKey: cacheKey         // ✅ IndexedDB 캐시 키
        });

        console.log(`[Queue] Added ${videoName}${fname ? ` (${fname})` : ''} ${force ? '(force mode)' : ''}`);
    });

    console.log(`[Queue] Total queued: ${videoLoadQueue.length}`);

    // 큐 처리 시작
    processVideoLoadQueue();



}

function startprocessvideoloadqueue()
{
    // 🔑 새 코드: 비디오를 큐에 추가하고 순차 처리 시작
    document.querySelectorAll('video').forEach(videoElement => {
        const videoName = videoElement.src.substring(videoElement.src.lastIndexOf('/') + 1);
        
        // 이미 처리됨 표시
        videoElement.dataset.videoQueued = 'true';

        // 큐에 추가
        videoLoadQueue.push({
            name: decodeURI(videoName),
            element: videoElement
        });

        console.log(`[Queue] Added ${videoName}`);
    });

    console.log(`[Queue] Total videos queued: ${videoLoadQueue.length}`);

    // 큐 처리 시작
    processVideoLoadQueue();
}



// 전역 변수 추가 (file 상단)
let videoLoadQueue = [];        // 로드 대기 중인 비디오 정보
let activeVideoLoads = 0;       // 현재 진행 중인 로드 개수
const MAX_CONCURRENT_LOADS = 8; // 동시 로드 최대 개수
let isPageFocused = !document.hidden; // 페이지 포커스 상태

// 🔑 북마크 기반 썸네일: 전체 북마크 캐시 (vidpath → bookmarks array)
let allBookmarks = {};
let allVrBookmarks = {};
let bookmarksLoaded = false;

async function loadAllBookmarks() {
    if (bookmarksLoaded) return;
    try {
        const [normalRes, vrRes] = await Promise.all([
            fetch('bookmark.php?all=1', { cache: 'no-store' }),
            fetch('bookmark.php?all=1&mode=vr', { cache: 'no-store' })
        ]);
        if (normalRes.ok) {
            const normalJson = await normalRes.json();
            allBookmarks = normalJson.data || {};
        }
        if (vrRes.ok) {
            const vrJson = await vrRes.json();
            allVrBookmarks = vrJson.data || {};
        }
        bookmarksLoaded = true;
        console.log(`[BookmarkThumb] Loaded ${Object.keys(allBookmarks).length} normal + ${Object.keys(allVrBookmarks).length} VR bookmark entries`);
    } catch (e) {
        console.error('[BookmarkThumb] Failed to load bookmarks:', e);
    }
}

function getBookmarksForVideo(vidpath) {
    const normal = allBookmarks[vidpath];
    const vr = allVrBookmarks[vidpath];
    const all = [...(normal || []), ...(vr || [])];
    return all.length > 0 ? all : null;
}

function pickBookmarkTime(vidpath, duration) {
    const bms = getBookmarksForVideo(vidpath);
    if (bms && bms.length > 0) {
        const picked = bms[Math.floor(Math.random() * bms.length)];
        return Math.min(picked.time, duration || picked.time);
    }
    return null;
}

// 🔑 싱글 프레임 모드: 비디오당 1회만 썸네일 로드 후 중지
let singleFrameMode = localStorage.getItem('singleFrameMode') === 'true';

function toggleSingleFrameMode() {
    singleFrameMode = !singleFrameMode;
    localStorage.setItem('singleFrameMode', singleFrameMode);
    console.log(`[SingleFrame] Mode: ${singleFrameMode ? 'ON (1 frame only)' : 'OFF (continuous)'}`);
}

// 페이지 가시성/포커스 상태 감지
function pauseAllIntervals() {
    if (!isPageFocused) return;
    isPageFocused = false;
    ThumbnailIntervalManager.stopAll();
}

function resumeVisibleIntervals() {
    if (isPageFocused) return;
    isPageFocused = true;
    ThumbnailIntervalManager.resumeAll();
}

window.addEventListener('focus', resumeVisibleIntervals);
window.addEventListener('blur', pauseAllIntervals);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        pauseAllIntervals();
    } else {
        resumeVisibleIntervals();
    }
});

// 비디오 썸네일 주기적 업데이트용 Manager (fetch 완료 후 다음 fetch 방식)
const ThumbnailIntervalManager = {
    activeItems: new Map(),
    errorIcons: new Map(),

    setupProgressBar(itemElem, fname) {
        const progressBar = itemElem.querySelector('.video-progress-bar');
        if (progressBar && makeitem_Store[fname]) {
            makeitem_Store[fname].progressBar = progressBar;
        }
    },

    showError(fname, imgElement) {
        if (this.errorIcons.has(fname)) return;
        if (!imgElement || !imgElement.parentElement) return;

        const errorEl = document.createElement('div');
        errorEl.className = 'thumbnail-error-icon';
        errorEl.innerHTML = '⚠';
        errorEl.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            width: 24px;
            height: 24px;
            background: rgba(255, 0, 0, 0.8);
            border-radius: 50%;
            color: white;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
            pointer-events: none;
        `;
        imgElement.parentElement.appendChild(errorEl);
        this.errorIcons.set(fname, errorEl);
    },

    hideError(fname) {
        if (this.errorIcons.has(fname)) {
            this.errorIcons.get(fname).remove();
            this.errorIcons.delete(fname);
        }
    },

    clearErrors() {
        this.errorIcons.forEach(el => el.remove());
        this.errorIcons.clear();
    },

    updateProgress(fname, currentTime, duration, progressBar) {
        if (!progressBar) return;
        const percent = (currentTime / duration) * 100;
        progressBar.style.width = `${percent}%`;
    },

    start(fname, imgElement) {
        if (this.activeItems.has(fname)) return;
        if (!isPageFocused || document.hidden) return;
        if (!imgElement.isConnected) return;

        // 🔑 싱글 프레임 모드: 이미 로드된 썸네일은 재로드하지 않음 (첫 decode만 사용)
        const itemData = makeitem_Store[fname];
        if (singleFrameMode && itemData && itemData.item_img && !itemData.need_video_load) {
            return;
        }

        this.activeItems.set(fname, true);
        this.tick(fname, imgElement);
    },

    stop(fname) {
        this.activeItems.delete(fname);
        this.hideError(fname);
    },

    tick(fname, imgElement) {
        if (!isPageFocused || document.hidden) return;
        if (!this.activeItems.has(fname)) return;

        if (!imgElement.isConnected) {
            this.stop(fname);
            return;
        }

        const itemData = makeitem_Store[fname];
        if (!itemData || !itemData.videoPath) {
            this.stop(fname);
            return;
        }

        const videoDuration = itemData.videoDuration || 30;
        if(itemData.videoDuration === undefined) {
            console.warn(`[ThumbnailUpdate] Missing videoDuration for ${fname}, using default 30s`);
        }

        // 🔑 북마크 타임스탬프 우선, 없으면 +10s 순회
        const bookmarkTime = pickBookmarkTime(itemData.videoPath, videoDuration);
        if (bookmarkTime) {
            itemData.currentSeekTime = bookmarkTime;
        } else {
            itemData.currentSeekTime = ((itemData.currentSeekTime || 0) + 10) % videoDuration;
            if(itemData.currentSeekTime < 30) itemData.currentSeekTime = 30;
        }

        console.log(`[ThumbnailUpdate] Updating ${fname} at ${itemData.currentSeekTime.toFixed(1)}s / ${videoDuration}s`);

        const seekTime = itemData.currentSeekTime;
        const currentFname = fname;
        const currentImgElement = imgElement;
        const progressBar = itemData.progressBar;

        this.updateProgress(fname, seekTime, videoDuration, progressBar);

        // 🔑 캐시 우선: 북마크 썸네일 캐시 확인
        const cacheUrl = `bookmark_thumb.php?path=${encodeURIComponent(itemData.videoPath)}&time=${seekTime}`;
        fetch(cacheUrl, { method: 'GET', cache: 'no-store' })
            .then(response => {
                if (response.ok) return response.blob();
                throw new Error('cache miss');
            })
            .then(blob => {
                if (!currentImgElement.isConnected) return;
                currentImgElement.src = URL.createObjectURL(blob);
                this.hideError(currentFname);
                if (!isPageFocused || document.hidden) return;
                if (!this.activeItems.has(currentFname)) return;
                if (!singleFrameMode) {
                    this.tick(currentFname, currentImgElement);
                }
            })
            .catch(() => {
                // 캐시 미스: FFmpeg 디코딩
                fetch(`${getFfmpegUrl()}/decode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ videoPath: itemData.videoPath, seekTime: seekTime })
                })
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return response.json();
                })
                .then(result => {
                    if (!result.success || !result.base64 || result.base64.length <= 100) return;
                    if (!currentImgElement.isConnected) return;
                    currentImgElement.src = result.base64;
                    itemData.imgpath = result.base64;
                    this.hideError(currentFname);

                    // 🔑 북마크 영상일 경우 캐시 저장
                    const bms = getBookmarksForVideo(itemData.videoPath);
                    if (bms) {
                        fetch('bookmark_thumb.php?cache=1', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: itemData.videoPath, time: seekTime, base64: result.base64 })
                        }).then(r => r.json()).then(j => {
                            console.log(`[BmThumbCache] saved: ${itemData.videoPath} @ ${seekTime}s`, j);
                        }).catch(e => {
                            console.error(`[BmThumbCache] save failed`, e);
                        });
                    }

                    if (!isPageFocused || document.hidden) return;
                    if (!this.activeItems.has(currentFname)) return;
                    if (!singleFrameMode) {
                        this.tick(currentFname, currentImgElement);
                    } else {
                        console.log(`[SingleFrame] Stopped continuous update for ${currentFname}`);
                    }
                })
                .catch(ex => {
                    console.error(`[ThumbnailUpdate] Error updating ${currentFname}:`, ex);
                    this.showError(currentFname, currentImgElement);
                });
            });
    },

    stopAll() {
        console.log('ALL STOP');
        this.activeItems.clear();
        this.clearErrors();
    },

    resumeAll() {
        console.log('ALL RESUME');
        document.querySelectorAll('img[data-fname]').forEach(img => {
            const fname = img.dataset.fname;
            if (!this.activeItems.has(fname)) {
                // 🔑 싱글 프레임 모드에서만 이미 로드된 썸네일은 건너뜀
                // (연속 모드에서는 focus 시 바로 연속 로딩 재개)
                const itemData = makeitem_Store[fname];
                if (singleFrameMode && itemData && itemData.item_img && !itemData.need_video_load) {
                    return;
                }
                this.start(fname, img);
            }
        });
    }
};

// 비디오 썸네일 주기적 업데이트용 IntersectionObserver
const thumbnailObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const fname = entry.target.dataset.fname;
        const itemData = makeitem_Store[fname];
        if (!itemData) return;

        if (entry.isIntersecting) {
            ThumbnailIntervalManager.start(fname, entry.target);
        } else {
            ThumbnailIntervalManager.stop(fname);
        }
    });
}, { threshold: 0.1 });

// DOM 제거 감지용 MutationObserver
const domRemovalObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
        mutation.removedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const removedImgs = node.matches?.('img[data-fname]') ? [node] : Array.from(node.querySelectorAll?.('img[data-fname]') || []);
                removedImgs.forEach(img => {
                    const fname = img.dataset.fname;
                    ThumbnailIntervalManager.stop(fname);
                });
            }
        });
    });
});

domRemovalObserver.observe(document.body, { childList: true, subtree: true });

function clearAllThumbnailIntervals() {
    ThumbnailIntervalManager.stopAll();
    thumbnailObserver.disconnect();
}

// makeitem() 호출 후 추가할 함수
async function processVideoLoadQueue() {
    while (videoLoadQueue.length > 0 && activeVideoLoads < MAX_CONCURRENT_LOADS) {
        const videoInfo = videoLoadQueue.shift();
        activeVideoLoads++;

        console.log(`[VideoLoad] Starting ${videoInfo.name} (${activeVideoLoads}/${MAX_CONCURRENT_LOADS})`);

        const videoElement = videoInfo.element;
        if (!videoElement || !videoElement.parentElement) {
            activeVideoLoads--;
            continue;
        }

        // FFmpeg 응답 전에도 파일명 먼저 표시
        let nameLabel = videoElement.parentElement.querySelector(`.video-name-label[data-vidname="${CSS.escape(videoInfo.name)}"]`);
        if (!nameLabel) {
            nameLabel = document.createElement('div');
            nameLabel.className = 'video-name-label';
            nameLabel.dataset.vidname = videoInfo.name;
            nameLabel.textContent = videoInfo.name;
            nameLabel.style.cssText = `
                position: absolute;
                top: 2px;
                left: 0;
                right: 0;
                padding: 2px 4px;
                font-size: 10px;
                color: white;
                background: rgba(0,0,0,0.5);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                z-index: 5;
                pointer-events: none;
            `;
            videoElement.parentElement.insertBefore(nameLabel, videoElement);
        }

        // FFmpeg 응답 전에도 progress bar 먼저 표시
        let progressBarContainer = videoElement.parentElement.querySelector(`.video-progress-container[data-vidname="${CSS.escape(videoInfo.name)}"]`);
        if (!progressBarContainer) {
            progressBarContainer = document.createElement('div');
            progressBarContainer.className = 'video-progress-container';
            progressBarContainer.dataset.vidname = videoInfo.name;
            progressBarContainer.style.cssText = `
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: rgba(0,0,0,0.5);
                z-index: 5;
                pointer-events: none;
            `;
            const progressBar = document.createElement('div');
            progressBar.className = 'video-progress-bar';
            progressBar.dataset.vidname = videoInfo.name;
            progressBar.style.cssText = `
                height: 100%;
                width: 0%;
                background: rgba(0,200,255,0.8);
                transition: width 0.3s ease;
                pointer-events: none;
            `;
            progressBarContainer.appendChild(progressBar);
            videoElement.parentElement.insertBefore(progressBarContainer, videoElement);
        }

        const videoPath = videoInfo.cacheKey || videoElement.src;
        const videoDurationifFail = 60;
        
        let videoDuration = videoElement.duration;
        if (!videoDuration || !Number.isFinite(videoDuration)) {
            await new Promise(resolve => {
                videoElement.addEventListener('loadedmetadata', resolve, { once: true });
            });
            videoDuration = videoElement.duration || videoDurationifFail;

            if(!videoElement.duration) {
                console.warn(`[VideoLoad] Unable to get duration for ${videoInfo.name}, using fallback ${videoDurationifFail}s`);
            }
        }


        // 🔑 북마크 타임스탬프 우선, 없으면 랜덤
        let seekTime;
        const bookmarkTime = pickBookmarkTime(videoPath, videoDuration);
        if (bookmarkTime) {
            seekTime = bookmarkTime;
            console.log(`[VideoLoad] Using bookmark time ${seekTime}s for ${videoInfo.name}`);
        } else {
            seekTime = Math.random() * videoDuration;
            if(seekTime < 30) seekTime = 30;
        }

        // 🔑 캐시 우선: 북마크 썸네일 캐시 확인 → 히트 시 FFmpeg 스킵
        const cacheUrl = `bookmark_thumb.php?path=${encodeURIComponent(videoPath)}&time=${seekTime}`;
        fetch(cacheUrl, { method: 'GET', cache: 'no-store' })
            .then(response => {
                if (response.ok) return response.blob();
                throw new Error('cache miss');
            })
            .then(blob => {
                // 캐시 히트: 캐시된 이미지 사용
                const cachedUrl = URL.createObjectURL(blob);
                console.log(`[VideoLoad] Cache HIT for ${videoInfo.name} @ ${seekTime}s`);
                applyThumbnail(videoInfo, videoElement, cachedUrl, videoDuration, seekTime, videoDurationifFail);
                // 백그라운드에서 캐시 저장 불필요 (이미 캐시에 있음)
            })
            .catch(() => {
                // 캐시 미스: FFmpeg 디코딩 → 캐시 저장
                console.log(`[VideoLoad] Cache MISS for ${videoInfo.name}, decoding via FFmpeg`);
                decodeAndApply(videoInfo, videoElement, videoPath, seekTime, videoDuration, videoDurationifFail);
            });
    }
}

function applyThumbnail(videoInfo, videoElement, imageSrc, videoDuration, seekTime, videoDurationifFail) {
    if (videoInfo.fname && makeitem_Store[videoInfo.fname]) {
        makeitem_Store[videoInfo.fname].need_video_load = false;
        makeitem_Store[videoInfo.fname].item_img = true;
        makeitem_Store[videoInfo.fname].imgpath = imageSrc;
        makeitem_Store[videoInfo.fname].videoPath = videoInfo.cacheKey || videoElement.src;
        makeitem_Store[videoInfo.fname].videoDuration = videoDuration;
        makeitem_Store[videoInfo.fname].currentSeekTime = parseFloat(seekTime);
    }

    if (videoElement.parentElement) {
        videoElement.pause();
        videoElement.removeAttribute('src');
        videoElement.removeAttribute('poster');
        videoElement.load();

        while (videoElement.previousSibling && (
            videoElement.previousSibling.nodeType === Node.TEXT_NODE ||
            (videoElement.previousSibling.tagName === 'IMG' && !videoElement.previousSibling.dataset.fname)
        )) {
            videoElement.previousSibling.remove();
        }

        const imgElement = document.createElement('img');
        imgElement.src = imageSrc;
        imgElement.style.cssText = 'position: absolute; width: 100%; height: 100%; object-fit: cover; pointer-events: none;';
        imgElement.alt = 'Video thumbnail';
        imgElement.dataset.fname = videoInfo.fname;
        if(makeitem_Store[videoInfo.fname]?.item_vid180 === true) {
            imgElement.classList.add('vr-half');
        }

        const existingProgressBar = videoElement.parentElement.querySelector(`.video-progress-bar[data-vidname="${CSS.escape(videoInfo.name)}"]`);
        if (existingProgressBar) {
            existingProgressBar.style.width = `${(parseFloat(seekTime) / videoDuration) * 100}%`;
        }

        videoElement.parentElement.insertBefore(imgElement, videoElement);
        videoElement.remove();
        console.log(`[Cache] DOM updated: video → image for ${videoInfo.fname}`);

        if (videoInfo.fname && makeitem_Store[videoInfo.fname]) {
            makeitem_Store[videoInfo.fname].progressBar = existingProgressBar;
        }

        thumbnailObserver.observe(imgElement);
    }
}

function decodeAndApply(videoInfo, videoElement, videoPath, seekTime, videoDuration, videoDurationifFail) {
    console.log(`[FFmpeg] Decoding ${videoInfo.name} at ${seekTime}s via ${getFfmpegUrl()}`);

    fetch(`${getFfmpegUrl()}/decode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath, seekTime })
    })
    .then(response => {
        if (!response.ok) throw new Error(`FFmpeg decode failed: ${response.status}`);
        return response.json();
    })
    .then(decodeResult => {
        if (!decodeResult.success) throw new Error(decodeResult.error || 'FFmpeg decode failed');

        const imagedatabase64 = decodeResult.base64;

        if (!imagedatabase64 || imagedatabase64.length < 100) {
            console.error(`[Cache] Invalid image data for ${videoInfo.fname}: ${imagedatabase64?.length || 0} bytes`);
            console.log(`imagedatabase64 : ${imagedatabase64}`);
            return;
        }

        console.log(`[Cache] Frame extracted: ${videoInfo.name} (${(imagedatabase64.length / 1024).toFixed(1)}KB)`);

        // 🔑 북마크 영상일 경우 캐시 저장
        const bms = getBookmarksForVideo(videoPath);
        if (bms) {
            fetch('bookmark_thumb.php?cache=1', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: videoPath, time: parseFloat(seekTime), base64: imagedatabase64 })
            }).then(r => r.json()).then(j => {
                console.log(`[BmThumbCache] saved: ${videoPath} @ ${seekTime}s`, j);
            }).catch(e => {
                console.error(`[BmThumbCache] save failed`, e);
            });
        }

        applyThumbnail(videoInfo, videoElement, imagedatabase64, videoDuration, seekTime, videoDurationifFail);
    })
    .catch(ex => {
        console.error(`[VideoLoad] Error processing ${videoInfo.fname || 'unknown'}`, ex);
        if (videoElement && videoElement.parentElement) {
            ThumbnailIntervalManager.showError(videoInfo.fname, videoElement);
        }
    })
    .finally(() => {
        activeVideoLoads--;
        processVideoLoadQueue();
    });
}

let scrolleditemidx = 0;
let scrolleditemidx_store = 0;
let scrollDebounceTimer = null;
const SCROLL_DEBOUNCE_DELAY = 300; // 스크롤이 150ms 동안 움직이지 않으면 refresh 호출

window.addEventListener("scroll", function(e) {
	
	if(dirlist.length == 0)
	{
		console.log("scroll skipp");
		return;
	}

    scrolleditemidx = Math.floor(window.scrollY / item_h);

    if(scrolleditemidx != scrolleditemidx_store)
    {
        scrolleditemidx_store = scrolleditemidx;

        const visibleStart = scrolleditemidx;
        const visibleEnd = Math.min(scrolleditemidx + visual_pictures_col, Math.ceil(dirlist.length / visual_pictures_row));
        const visibleItemStart = visibleStart * visual_pictures_row;
        const visibleItemEnd = visibleEnd * visual_pictures_row;

        eliminate_out_of_range_items(visibleItemStart, visibleItemEnd);
    }

    // console.log(`scrolleditemidx - ${scrolleditemidx}`);

    // 이전 debounce 타이머 취소
    if (scrollDebounceTimer) {
        clearTimeout(scrollDebounceTimer);
    }
    // 새로운 debounce 타이머 설정: 스크롤이 안정되면 refresh 호출
    scrollDebounceTimer = setTimeout(() => {
            console.log(`scrolleditemidx - ${scrolleditemidx} (debounced)`);
            refreshinginfinitylist();
        scrollDebounceTimer = null;
    }, SCROLL_DEBOUNCE_DELAY);

}, { passive: true });

function isImageExt(filename) {
    let arg = filename.toLowerCase();
    if(arg.endsWith('jpeg') || arg.endsWith('jpg') || arg.endsWith('png')) return true;
    else return false;
}

function extractlastnumberfromfilename(str) {
    let dotpos = str.lastIndexOf('.');
    if(dotpos == -1) return -1;
    let src1 = str.substring(0, dotpos);

    if(isNaN(src1))
    {
        let cut=-1;
        for(let i=src1.length-1;i>=0;i--)
        {
            if(isNaN(src1[i]))
            {
                cut = i+1;
                break;
            } 
        }
    
        if(cut == -1) return -1;
        let res = src1.substring(cut);
        return Number(res);
    }
    else 
    {
        return Number(src1);
    }
}

function randChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)]
}

// 🔑 VR 파일 감지: 2:1 비율(equirectangular)이 우선, 프로브 실패 시 파일명 휴리스틱 폴백
let vid180Cache = {};

function isVRByFilename(fname) {
    const name = fname.toLowerCase();
    if (name.includes('vr')) return true;
    if (name.includes('180')) return true; // VR180
    if (name.includes('panorama') || name.includes('pano')) return true;
    if (name.endsWith('.360') || name.endsWith('.insv') || name.endsWith('.insp') || name.endsWith('.thumb')) return true;
    if (/(^|[^a-z0-9])360([^a-z0-9]|$)/.test(name)) return true; // "360p" 같은 해상도 표기 제외
    return false;
}

async function isVRVideo(vidpath, fname) {
    if (vid180Cache[vidpath] !== undefined) return vid180Cache[vidpath];

    try {
        // 🔑 vidpath는 이미 인코딩된 경로 (dirseek.php와 동일 패턴)
        const res = await fetch(`vrprobe.php?x[]=${vidpath}`, { cache: 'no-store' });
        if (res.ok) {
            const arr = await res.json();
            const r = Array.isArray(arr) ? arr[0] : null;
            if (r && typeof r.isVR === 'boolean') {
                vid180Cache[vidpath] = r.isVR;
                return r.isVR;
            }
        }
    }
    catch (e) {
        console.error('vrprobe failed', e);
    }

    vid180Cache[vidpath] = isVRByFilename(fname);
    return vid180Cache[vidpath];
}

let makeitem_Store = {};

async function makeitem(w,h,x,y,fname,text,force=false) {
    let ret;
    
    let item_enterable = false;
    let item_img = false;
    let imgpath = '';
    let item_vid = false;
    let need_video_load = false;
    let vidpath = '';
    let hasMp4 = false;
    let hasVR = false;
    let hasHighImageRatio = false;

    let makeitem_stored = makeitem_Store[fname];

    if(!makeitem_stored)
    {
        let belowdirseekpath = `${parampath}/${fname}`;
        let cacheKey = '';  // 🔑 비디오 파일의 IndexedDB 캐시 키
        
        try {
            // 🔑 dirseek의 is_dir 플래그로 파일임이 확인된 항목은 프로브 요청 생략
            let jsondata = null;
            if (dirFlagMap[fname] !== false) {
                jsondata = await dirseek(belowdirseekpath);
            }
            if(jsondata && jsondata["ret"]) // openable directory
            {
                item_enterable = true;
    
                let dirbelowimgs = [];
                let imageCount = 0;
        
                jsondata["data"].forEach(each => {
                    const name = each["d"];
                    const time = each["t"];
                    
                    let fnameext = name.substring(name.lastIndexOf('.')+1);
                    
                    fnameext = fnameext.toLowerCase();
                    
                    if(isImageExt(fnameext)) {
                        dirbelowimgs.push(name);
                        imageCount++;
                    }
                    if(fnameext == 'mp4' || fnameext == 'mov' || fnameext == 'mkv') hasMp4 = true;
                    // 🔑 VR 배지: 파일명으로만 판정 (vr, VR, 180, 360 등)
                    if(isVRByFilename(name)) hasVR = true;
                })
        
                let totalFiles = jsondata["data"].length;
                let imageRatio = totalFiles > 0 ? imageCount / totalFiles : 0;
                hasHighImageRatio = imageRatio >= 0.9;
        
                if(dirbelowimgs.length > 0) {
                    item_img = true;
                    const selectedImg = randChoice(dirbelowimgs);
                    imgpath = belowdirseekpath + "/" + encodeURIComponent(selectedImg);
                }
                
            }
            else // just A File
            {
                let fnameext = fname.substring(fname.lastIndexOf('.')+1);
    
                if(isImageExt(fnameext)) {
                    item_img = true;
                    imgpath = parampath + "/" + encodeURIComponent(fname);
                }
                else if(fnameext == 'mp4' || fnameext == 'mov' || fnameext == 'mkv') {
                    item_vid = true;
                    vidpath = parampath + "/" + encodeURIComponent(fname);
                    
                    // // 🔑 IndexedDB 캐시 키: 원본 경로 (인코딩 X) → 일관성 유지
                    // // encodeURI()는 HTML 속성에만 사용, IndexedDB 키는 원본 사용
                    // cacheKey = parampath + "/" + fname;

                    // if(force)
                    // {
                    //     need_video_load = true;
                    //     console.log(`[Cache] video loading (force) - ${fname}`);
                    // }
                    // else
                    // {
                    //     // 🔑 원본 경로로 캐시 조회 (일관성)
												
                    //     // console.log(`vidpath - ${vidpath}`);

                    //     const result = await checkThumbnail(vidpath.replace(' ', '_')); // 공백이 있는 경우 '_'로 대체하여 체크

                    //     if(result.exists) {
                    //         // let fnamethumbnailed = fname + '.jpg';
                    //         item_img = true;
                    //         imgpath = result.thumbnailPath;
                    //         console.log(`[Cache] getting thumbnail at: ${imgpath}`);
                    //     }
                    //     else {
                    //         need_video_load = true;
                    //     }
                    // }


                    need_video_load = true;

                }
            }
        }
        catch(ex) {
            console.log(ex);
        }
        
        // 🔑 makeitem_Store에 cacheKey도 저장 (processVideoLoadQueue에서 사용)
        const ratingValue = await getRating(fname);
        makeitem_Store[fname] = {
            fname: fname,
            item_enterable: item_enterable,
            item_img: item_img,
            imgpath: imgpath,
            item_vid: item_vid,
            need_video_load: need_video_load,
            vidpath: vidpath,
            cacheKey: cacheKey,  // ✅ 추가: IndexedDB 캐시 키
            hasMp4: hasMp4 || false,  // 추가: MP4 파일 존재 여부
            hasHighImageRatio: hasHighImageRatio || false,  // 추가: 이미지 파일 80% 이상 여부
            hasVR: hasVR || false,  // 추가: VR 파일 존재 여부
            rating: ratingValue  // 추가: rating 값
        };
    }
    else {
        item_enterable = makeitem_Store[fname].item_enterable;
        item_img = makeitem_Store[fname].item_img;
        imgpath = makeitem_Store[fname].imgpath;
        item_vid = makeitem_Store[fname].item_vid;
        vidpath = makeitem_Store[fname].vidpath;
        need_video_load = makeitem_Store[fname].need_video_load;
        cacheKey = makeitem_Store[fname].cacheKey || '';
        hasMp4 = makeitem_Store[fname].hasMp4 || false;
        hasHighImageRatio = makeitem_Store[fname].hasHighImageRatio || false;
        hasVR = makeitem_Store[fname].hasVR || false;
        let rating = makeitem_Store[fname].rating ?? 0;

        console.log(`[Store] Cache for ${fname} - enterable: ${item_enterable}, img: ${item_img}, vid: ${item_vid}, need_video_load: ${need_video_load}, hasMp4: ${hasMp4}, hasHighImageRatio: ${hasHighImageRatio}, rating: ${rating}`);
    }

    let linkelemnts;
    let imgelements;

    if(item_vid)
    {
        item_enterable = true;

        // 🔑 VR 여부: makeitem_Store 캐시 → 프로브(2:1 비율) → 파일명 폴백
        let isVR = makeitem_Store[fname]?.item_vid180;
        if(typeof isVR !== 'boolean')
        {
            isVR = await isVRVideo(vidpath, fname);
            if(makeitem_Store[fname]) makeitem_Store[fname].item_vid180 = isVR;
        }

        linkelemnts = ``;

        if(isVR)
        {
            linkelemnts += `<a href="${document.location.origin}${document.location.pathname}/${getVRViewerPath()}?p=${encodeUriSafe(vidpath)}${paramfind != null ? `&f=${encodeURIComponent(paramfind)}` : ""}" target="_blank"></a>`
        }
        else
        {
            linkelemnts += `<a href="${document.location.origin}${document.location.pathname}/videoview.html?p=${encodeUriSafe(vidpath)}${paramfind != null ? `&f=${encodeURIComponent(paramfind)}` : ""}" target="_blank"></a>`
        }
    }
    else
    {
        enter_element = document.location.href;
        if(enter_element.lastIndexOf('&f=') != -1)
            enter_element = enter_element.substring(0, enter_element.lastIndexOf('&f='));

        const belowpath = `${parampath}/${fname}`;
        let belowpathlink = "";

        if(belowpath.substr(0, 5) == 'drvs/')
        {
            belowpathlink = document.location.origin + "\\" + belowpath.substring(5, belowpath.length);
            belowpathlink = belowpathlink.substring(5, belowpathlink.length);
            belowpathlink = belowpathlink.replaceAll("/", "\\");

            //example - `maxview://open?path=\\192.168.100.101\drive_5\contents`
            //          `winexplr://open?path=\\192.168.100.101\drive_5\contents`
        }
        else
        {
            console.log(`expect "drvs/" (${belowpath})`);
        }

        // build badge container with both maxview and direct-play links
        let playvidBadge = '';
        if(hasMp4) {
            playvidBadge = `<div class="badge">
                playvid
                <a href="${document.location.origin}${document.location.pathname}/videoview.html?p=${encodeUriSafe(belowpath)}${paramfind != null ? `&f=${encodeURIComponent(paramfind)}` : ""}" target="_blank" class="item-badge-link"></a>
            </div>`;
        }
        if (hasVR) {
            playvidBadge += `<div class="badge">
                playvid180
                <a href="${document.location.origin}${document.location.pathname}/${getVRViewerPath()}?p=${encodeUriSafe(belowpath)}${paramfind != null ? `&f=${encodeURIComponent(paramfind)}` : ""}" target="_blank" class="item-badge-link"></a>
            </div>`;
        }
        let imageviewBadge = '';
        let maxviewBadge = '';
        if(hasHighImageRatio) {
            // imageviewBadge = `<div class="badge">
            //     imageview
            //     <a href="${document.location.origin}${document.location.pathname}/imageview.html?p=${belowpath}" target="_blank" class="item-badge-link"></a>
            // </div>`;
            // maxviewBadge = `<div class="badge">
            //     maxview
            //     <a href="maxview://open?path=${belowpathlink}" return false;" class="item-badge-link"></a>
            // </div>`;
        }

        const currentRating = makeitem_stored?.rating ?? (await getRating(fname));
        const ratingBadge = `
        <div class="rating-container" data-rating-fname="${escapeHtml(fname)}">
            <div class="rating-btn" data-rating-action="up" data-rating-fname="${escapeHtml(fname)}">▲</div>
            <div class="rating-value">${currentRating}</div>
            <div class="rating-btn" data-rating-action="down" data-rating-fname="${escapeHtml(fname)}">▼</div>
        </div>
        `;
        
        linkelemnts = `
        ${ratingBadge}
        <div class="badge-container">
            ${playvidBadge}
            ${imageviewBadge}
            ${maxviewBadge}
        </div>
        `;
        
        if(hasHighImageRatio) {
            linkelemnts += `<a href="${document.location.origin}${document.location.pathname}/imageview.html?p=${encodeUriSafe(belowpath)}" target="_blank"></a>`;
        }
        else {
            const encodedFname = encodeURIComponent(fname);
            linkelemnts += parampathgiven ? `<a href="${enter_element}/${encodedFname}"></a>` : `<a href="${enter_element}?p=${encodedFname}"></a>`;
        }
    }

    // 🔑 비디오 요소에 메타데이터 속성 추가 (processVideoLoadQueue에서 사용)
    // 주의: IndexedDB에서는 원본 경로(인코딩 X)를 사용
    const cacheKeyForAttr = parampath + "/" + fname;
    const imgAttrs = item_vid ? ` data-fname="${escapeHtml(fname)}" data-cache-key="${escapeHtml(cacheKeyForAttr)}"` : '';
    const imgDragAttrs = 'draggable="false" style="pointer-events: none; -webkit-user-select: none; -moz-user-select: none; user-select: none; -webkit-user-drag: none;"';

    imgelements = `<img src="${escapeHtml(imgpath)}" loading=lazyloading alt="Cover" style="position: absolute; width: 100%; height: 100%; object-fit:cover;" ${imgAttrs}>`;
    const isVRItem = item_vid && makeitem_Store[fname]?.item_vid180 === true;
    const vrHalfClass = isVRItem ? 'vr-half' : '';
    if (item_vid) {
        imgelements = `<img src="${escapeHtml(imgpath)}" loading=lazyloading alt="Cover" class="${vrHalfClass}" style="position: absolute; width: 100%; height: 100%; object-fit:cover; pointer-events: none; -webkit-user-select: none; -moz-user-select: none; user-select: none; -webkit-user-drag: none;" draggable="false" ${imgAttrs}>`;
    } else {
        imgelements = `<img src="${escapeHtml(imgpath)}" loading=lazyloading alt="Cover" style="position: absolute; width: 100%; height: 100%; object-fit:cover; pointer-events: none; -webkit-user-select: none; -moz-user-select: none; user-select: none; -webkit-user-drag: none;" draggable="false" ${imgAttrs}>`;
    }
    let cachedAttrs = '';
    if(item_vid) {
        cachedAttrs = ` data-fname="${escapeHtml(fname)}" data-cache-key="${escapeHtml(cacheKeyForAttr)}"`;
    }
    let videlements = `<video muted src="${escapeHtml(vidpath)}" preload="metadata" style="position: absolute; width: 100%; height: 100%; object-fit: cover;"${cachedAttrs} ></video>`;

    // let videlements = `<div style="position: absolute; width: 100%; height: 100%; object-fit: cover;"${cachedAttrs} ></div>`;
    
    let layerTextStyle = 'box-sizing:border-box';
    if(item_vid) {
        layerTextStyle += '; display: none';
    }
    
    // autoplay
    ret = `<div class="item" style="width: ${w-4}px; height: ${h-4}px; transform: translate(${x}px, ${y}px); position: absolute; user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; pointer-events: auto; ">
    <div style="box-sizing: border-box; overflow: hidden; position: absolute; width: 100%; height: 100%; ">
        <div class="layer-text" style="${layerTextStyle}">
            <h3>${escapeHtml(text)}</h3>
        </div>
        ` +
        (item_enterable ? linkelemnts : '') +
        (item_img ? imgelements : '') +
        (need_video_load ? videlements : '') +
        `</div>
    </div>`;

    return ret;
}

function mulberry32(seed) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed(array, seed) {
  const random = mulberry32(seed);
  const result = [...array]; // 원본 보호

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function stringToSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i);
  }
  return hash >>> 0;
}

function formatYYYYMMDD(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return `${yyyy}${mm}${dd}`;
}


function openBookmarks() {
    window.open(`${document.location.origin}${document.location.pathname}/bookmarks.html?p=${parampath || ''}`, '_blank');
}

let actionToastTimer = null;

function showActionToast(message) {
    const toast = document.getElementById('action-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.opacity = '1';
    if (actionToastTimer) clearTimeout(actionToastTimer);
    actionToastTimer = setTimeout(() => {
        toast.style.opacity = '0';
    }, 1000);
}

let startupprocessing = false;

async function startup() {
    if(startupprocessing)
    {
        console.log('startup already processing, skip');
        return;
    }

    startupprocessing = true;
		
    const pathPref = getPathPref();

    let ordertype = pathPref.order;
    if(ordertype == null)
    {
        ordertype = localStorage.getItem('listordertype');
    }
    if(ordertype == null)
    {
        ordertype = 1;
    }
		
    console.log(`ordertype - ${ordertype}`);
		
    ratingordertoggleState = pathPref.ratingToggle;
    if(ratingordertoggleState == null)
    {
        ratingordertoggleState = localStorage.getItem('ratingordertoggle');
    }
    if(ratingordertoggleState == null) ratingordertoggleState = false;
    
    if(ratingordertoggleState == 'true') ratingordertoggleState = true;
    else if(ratingordertoggleState == 'false') ratingordertoggleState = false;
    
    console.log(`ratingordertoggleState: ${ratingordertoggleState}`);
    

    // 🔑 첫 로드 시 현재 정렬 방식 표시
    if(!initialToastShown)
    {
        initialToastShown = true;
        showActionToast(sortModeMessages[ordertype] || `Sort: ${ordertype}`);
    }

    dirlist = [];
    clearAllThumbnailIntervals();
    makeitem_Store = {};
    vid180Cache = {};

    // 🔑 북마크 데이터 프리로드 (썸네일 타임스탬프 결정용)
    loadAllBookmarks();

    const jsondata = await dirseek(parampath);
    if(jsondata["ret"])
    {
        let queryedlist = jsondata["data"];

        dirFlagMap = {};
        queryedlist.forEach(each => {

            const name = each["d"];
            const time = Date.parse(each["t"]);
            dirFlagMap[name] = (each["dir"] === true); // 🔑 서버 제공 is_dir 플래그
            
            let ftext;
            try
            {
                ftext = name;
                let p1 = ftext.indexOf('/');
                if(p1 >= 0)
                {
                    ftext = ftext.substring(p1+1, ftext.length);
                    p1 = ftext.indexOf('/');
                    ftext = ftext = ftext.substring(0, p1);
                }
            }
            catch(ex) {
                ftext = '';
                console.log(ex);
            }

            dirlist.push(
                {
                    fname: name,
                    text: ftext,
                    time: time
                }
            );
        });

        if(paramfind != null)
        {
            console.log(`searching - ${paramfind}`);
            dirlist = dirlist.filter(x=> x.fname.toUpperCase().includes(paramfind.toUpperCase()));
        }

        if(dirlist.length > 0) {

            if(ordertype == 1)
            {
                dirlist.sort((a,b) => { return b.time - a.time; });
            }
            else if(ordertype == 2)
            {
                dirlist.sort((a, b) => {
                    return a.fname.localeCompare(b.fname);
                });
            }
            else if(ordertype == 3)
            {
                dirlist = shuffleWithSeed(dirlist, stringToSeed(formatYYYYMMDD(new Date())));
            }
            else if(ordertype == 4)
            {
                dirlist = shuffleWithSeed(dirlist, Math.random()*0xFFFFFFFF);
            }
            else
            {
                console.log(`ordertype unknown !!! ${ordertype}`);
            }

            if(ratingordertoggleState === true)
            {
                const ratingPromises = dirlist.map(async (item) => {
                    item.rating = await getRating(item.fname);
                });
                await Promise.all(ratingPromises);
                const randomSeed = Math.random() * 0xFFFFFFFF;
                dirlist = shuffleWithSeed(dirlist, randomSeed);
                dirlist.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
            }
            
            dirlist = dirlist.filter(item => {
                const text = item.text.toLowerCase();
                // const hasExt = /\.[^/.]+$/.test(text);

                return (
                    !(
                        // ignore from list 
                        text.endsWith(".jpg") ||
                        text.endsWith(".jpeg") ||
                        text.endsWith(".png") ||
                        text.endsWith(".sh")
                    ) || text.endsWith(".mp4") || text.endsWith(".mov") || text.endsWith(".mkv")
                    // || !hasExt
                );
            });
            
            dirlist.sort((a, b) => Number(b.text.endsWith(".mp4") || b.text.endsWith(".mov") || b.text.endsWith(".mkv")) - Number(a.text.endsWith(".mp4") || a.text.endsWith(".mov") || a.text.endsWith(".mkv")));

            let imgfiles = dirlist.filter(x => isImageExt(x.fname));
    
            if(imgfiles.length / dirlist.length  > 0.9) { // At Over 90% JPG/JPEG in list.
                // Eliminate none-jpg/jpeg file
                // dirlist = imgfiles;
                // Single Row mode
                visual_pictures_row = 1;
                // sort by name
                dirlist.sort((a,b) => {
                    return extractlastnumberfromfilename(a.fname) - extractlastnumberfromfilename(b.fname);
                });
            }

            visual_pictures_row = Math.round(window.innerWidth / visual_pictures_row_item_px);
            if(visual_pictures_row == 0) visual_pictures_row = 1;
            if(visual_pictures_row > visual_pictures_row_max) visual_pictures_row = visual_pictures_row_max;

            item_w = ((window.innerWidth-(25/window.devicePixelRatio))/visual_pictures_row);
            // item_w = 400;
            item_h = item_w/4*3;
            visual_pictures_col = Math.floor(window.innerHeight / item_h)+2;

            console.log(`visual_pictures_row ${visual_pictures_row}`);
            // console.log(`visual_pictures_col ${visual_pictures_col}`);
            
            if(dirlist.length > 0) {
                let viewhei = (Math.floor(dirlist.length/visual_pictures_row)) * item_h;
                TopScrollView.style.height = viewhei;
            }

            // console.log(`dirlist - ${JSON.stringify(dirlist)}`);

            Reload_View();
			
        }
        else {
            MainTitle.style.display = 'block';
            MainTitle.innerText = `no files in ${parampath}`;
        }


    }
    else {
        MainTitle.style.display = 'block';
        MainTitle.innerText = `${parampath} dirseek Error`;
    }

    startupprocessing = false;
}

document.addEventListener("DOMContentLoaded", () => {
    // console.log("DOMContentLoaded");
    // indexedDB_init();
    startup();
}, false)

function setordertype(type)
{
    if(type >= 1 && type <= 4)
    {
        setPathPref({ order: type });

        console.log(`startup with setordertype - ${type}`);
        startup();
    }
}


let ratingordertoggleState = false;

const sortModeMessages = ['', 'Sort: Recent', 'Sort: Name', 'Sort: Daily Shuffle', 'Sort: Random'];

let initialToastShown = false;

function setRatingOrderToggle()
{
	ratingordertoggleState = !ratingordertoggleState;
	
	setPathPref({ ratingToggle: ratingordertoggleState });
	console.log(`ratingordertoggleState - ${ratingordertoggleState}`);

	startup();
}


function commandtyped(cmd)
{
    console.log(`cmd - ${cmd}`);
}

async function onRatingUp(fname) {
    const currentRating = makeitem_Store[fname]?.rating ?? 0;
    const newRating = currentRating + 1;
    const success = await setRating(fname, newRating);
    if (success) {
        makeitem_Store[fname].rating = newRating;
        document.querySelectorAll(`[data-rating-fname="${fname}"] .rating-value`).forEach(el => {
            el.textContent = newRating;
        });
    }
    console.log(`Rating UP: ${fname} -> ${newRating} (saved: ${success})`);
}

async function onRatingDown(fname) {
    const currentRating = makeitem_Store[fname]?.rating ?? 0;
    const newRating = currentRating - 1;
    const success = await setRating(fname, newRating);
    if (success) {
        makeitem_Store[fname].rating = newRating;
        document.querySelectorAll(`[data-rating-fname="${fname}"] .rating-value`).forEach(el => {
            el.textContent = newRating;
        });
    }
    console.log(`Rating DOWN: ${fname} -> ${newRating} (saved: ${success})`);
}

let typingmodecmd = false;
let typingmode = false;
let typinginputstr = '';
let typinginputsubmit = '';


function Reload_View() {
	// 캐시 초기화: makeitem_Store를 비워서 모든 항목이 다시 로드되도록 함
	clearAllThumbnailIntervals();
	makeitem_Store = {};
	vid180Cache = {};
	// 비디오 로드 큐도 초기화 (진행 중인 작업은 계속 진행되지만, 큐는 새로 시작)
	videoLoadQueue = [];
	// 강제 새로고침: 모든 아이템을 다시 렌더링하고 비디오 프레임을 새로 추출
	refreshinginfinitylist(true);
}


document.addEventListener('keydown', (e) => {
    
    // console.log(e.key);

    if(typingmode || typingmodecmd)
    {
        if(e.key.length == 1 && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)
        {
            if(e.key.charCodeAt(0) >= ' '.charCodeAt(0) && e.key.charCodeAt(0) <= '~'.charCodeAt(0))
            {
                // console.log(e.key);
                typinginputstr += e.key;
                typing_panel.innerText = typinginputstr;
            }
        }
    }
    
    if(e.key == 'Escape')
    {
        if(typingmode || typingmodecmd)
        {
            typingmode = false;
            typingmodecmd = false;
            typinginputstr = '';
            typing_panel.innerText = typinginputstr;
            document.getElementById('search_panel').style.visibility = 'hidden';
        }
    }
    else if(e.key == 'Enter')
    {
        e.preventDefault();
        if(typingmodecmd)
        {
            typinginputsubmit = typinginputstr;
            document.getElementById('search_panel').style.visibility = 'hidden';
            typinginputstr = '';
            typing_panel.innerText = typinginputstr;

            // console.log(`typingmodecmd - ${typinginputsubmit}`);
            commandtyped(typinginputsubmit);

            typingmodecmd = false;
        }
        else
        {
            if(typingmode)
            {
                if(typinginputstr.length == 0)
                {
                    document.getElementById('search_panel').style.visibility = 'hidden';
                }
                else
                {
                    typinginputsubmit = typinginputstr;
                    typinginputstr = '';
                    typing_panel.innerText = typinginputstr;
                    document.getElementById('search_panel').style.visibility = 'hidden';

                    if(typinginputsubmit != '')
                    {
                        let hrefpath = window.location.href;

                        while(hrefpath.lastIndexOf('&f=') != -1)
                        {
                            hrefpath = hrefpath.substring(0, hrefpath.lastIndexOf('&f='));
                        }

                        window.open(`${hrefpath}&f=${typinginputsubmit}`, '_blank');
                    }
                }
            }
            else
            {
                document.getElementById('search_panel').style.visibility = '';
                typing_panel.innerText = typinginputstr;
            }

            typingmode = !typingmode;
        }
    }
    else if(e.key == '`')
    {
        if(!typingmode)
        {
            if(typingmodecmd)
            {

            }
            else
            {
                document.getElementById('search_panel').style.visibility = '';
                typing_panel.innerText = typinginputstr;
            }

            typingmodecmd = !typingmodecmd;
        }
    }
    else if(e.key == '\\')
    {
        console.log('[Cache] Force refresh: Clearing cache and reloading');
				showActionToast('Force Refresh');
				Reload_View();
    }
    else if(!typingmode && !typingmodecmd && e.key == 'b')
    {
        showActionToast('Open Bookmarks');
        openBookmarks();
    }
    else if(!typingmode && !typingmodecmd && e.key >= '1' && e.key <= '4')
    {
        showActionToast(sortModeMessages[Number(e.key)]);
        setordertype(Number(e.key));
    }
    else if(!typingmode && !typingmodecmd && e.key == '0')
    {
        setRatingOrderToggle();
        showActionToast(`Rating Order: ${ratingordertoggleState ? 'ON' : 'OFF'}`);
    }
    else if(e.key == 's' && !typingmode && !typingmodecmd)
    {
        toggleSingleFrameMode();
        showActionToast(`Single Frame: ${singleFrameMode ? 'ON' : 'OFF'}`);
    }
    else if(e.key == 'Backspace')
    {

        if(typingmode || typingmodecmd)
        {
            if(typinginputstr.length > 0)
            {
                typinginputstr = typinginputstr.substr(0, typinginputstr.length-1)
                typing_panel.innerText = typinginputstr;
            }
        }
        else
        {
            let link = window.location.href;
            
            if(link.lastIndexOf('&f=') != -1)
            {
                link = link.substring(0, link.lastIndexOf('&f='));
                // console.log(`link - ${link}`);
                window.location = link;
            }
            else
            {
                // console.log(`link - ${link.substring(0, link.lastIndexOf('/'))}`);

                let linkbrowse = link.substring(0, link.lastIndexOf('/'));
                if(linkbrowse.endsWith('drvs'))
                {
                    console.log('top reached');
                }
                else
                {
                    window.location = link.substring(0, link.lastIndexOf('/'));
                }
            }
            
        }
    }

});

