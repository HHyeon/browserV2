
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


let dirlist = [];
let item_w, item_h;
let TopScrollView = document.getElementById('scroll-views');
let MainTitle = document.getElementById('MainTitle');
let typing_panel = document.getElementById('typing_panel');

let input_search = document.querySelector('.input_search');



let visual_pictures_row = 3;
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


let DBSession;

function indexedDB_init() {
    const request = window.indexedDB.open('customed-web-browser');
    
    request.onupgradeneeded = (e) => {
        console.log('onupgradeneeded');
        let result = e.target.result.createObjectStore('thumbnailstore', {keyPath: 'filename'});
        // result.createIndex('filename', 'filename', {unique: false});
        // result.createIndex('filedata', 'filedata', {unique: false});
    }

    request.onsuccess = (e) => {
        DBSession = request.result;
        
        console.log('startup proceed after indexedDB init');
        startup();
    }
    
    request.onerror = (e) => {
        console.error('indexedDB Error');
    }
}

function indexedDB_addvalue(filename, filedata, videocurrentpos, evt) {
    const transaction = DBSession.transaction(['thumbnailstore'], 'readwrite');
    const store = transaction.objectStore('thumbnailstore');
    
    const item = {
        filename: `${filename}`,
        filedata: `${filedata}`,
        position: `${videocurrentpos}`
    }
    
    const resp = store.put(item);
    
    resp.onsuccess = () => {
        evt(true);
    }

    resp.onerror = () => {
        evt(false);
        console.error("indexedDB_addvalue Failed");
    }
}

async function indexedDB_get(filename) {
    const transaction = DBSession.transaction(['thumbnailstore'], 'readwrite');
    const store = transaction.objectStore('thumbnailstore');

    return new Promise( (resolve) => {
        const resp = store.get(filename);
    
        resp.onsuccess = () => {
            resolve(resp.result);
        }
    
        resp.onerror = () => {
            console.error("indexedDB_get Failed");
            resolve(null);    
        }
    });
    
}


// 전역 변수 추가 (file 상단)
let videoLoadQueue = [];        // 로드 대기 중인 비디오 정보
let activeVideoLoads = 0;       // 현재 진행 중인 로드 개수
const MAX_CONCURRENT_LOADS = 2; // 동시 로드 최대 개수


// makeitem() 호출 후 추가할 함수
async function processVideoLoadQueue() {
    // 대기 중인 비디오가 있고, 동시 로드 제한 미만일 때만 처리
    if (videoLoadQueue.length > 0 && activeVideoLoads < MAX_CONCURRENT_LOADS) {
        const videoInfo = videoLoadQueue.shift(); // 큐에서 제거
        activeVideoLoads++;

        console.log(`[VideoLoad] Starting ${videoInfo.name} (${activeVideoLoads}/${MAX_CONCURRENT_LOADS})`);

        const videoElement = videoInfo.element;
        if (!videoElement || !videoElement.parentElement) {
            // 요소가 DOM에서 제거된 경우 스킵
            activeVideoLoads--;
            processVideoLoadQueue(); // 다음 항목 처리
            return;
        }

        // 비디오 로드 시작
        videoElement.currentTime += 30;

        // seeked 이벤트: 1회만 처리
        const handleSeeked = async (event) => {
            videoElement.removeEventListener('seeked', handleSeeked);
            
            try {
                const imagedatabase64 = video_to_image_base64(videoElement);
                const targetvidtime = videoElement.currentTime;
                const name = videoInfo.name;

                // IndexedDB 저장
                await new Promise(resolve => {
                    indexedDB_addvalue(name, imagedatabase64, targetvidtime, () => {
                        console.log(`[Cache] Saved ${name}`);
                        if (makeitem_Store[name]) {
                            makeitem_Store[name].need_video_load = false;
                            makeitem_Store[name].item_img = true;
                            makeitem_Store[name].imgpath = imagedatabase64;
                        }
                        resolve();
                    });
                });
            } catch (ex) {
                console.error(`[VideoLoad] Error processing ${videoInfo.name}`, ex);
            } finally {
                activeVideoLoads--;
                clearTimeout(timeoutId);
                clearInterval(removalCheckInterval);
                processVideoLoadQueue(); // 다음 항목 처리
            }
        };

        videoElement.addEventListener('seeked', handleSeeked, { once: true });

        // 타임아웃: seeked 미발생 시 정리
        const timeoutId = setTimeout(() => {
            try { videoElement.removeEventListener('seeked', handleSeeked); } catch(e){}
            clearInterval(removalCheckInterval);
            console.warn(`[VideoLoad] Timeout - ${videoInfo.name}`);
            activeVideoLoads--;
            processVideoLoadQueue();
        }, 10000);

        // DOM 제거 감지(요소가 문서에서 사라지면 정리)
        const removalCheckInterval = setInterval(() => {
            if (!document.contains(videoElement) || !videoElement.isConnected) {
                try { videoElement.removeEventListener('seeked', handleSeeked); } catch(e){}
                clearTimeout(timeoutId);
                clearInterval(removalCheckInterval);
                console.warn(`[VideoLoad] Video element removed from DOM - ${videoInfo.name}`);
                activeVideoLoads--;
                processVideoLoadQueue();
            }
        }, 500);

        // seek 에러 시에도 타임아웃/인터벌 정리
        const originalOnError = videoElement.onerror;
        videoElement.onerror = (ev) => {
            try { clearTimeout(timeoutId); } catch(e){}
            try { clearInterval(removalCheckInterval); } catch(e){}
            if (originalOnError) try { originalOnError(ev); } catch(e){}
        };
    }
}

let lastVisibleStart = 0;  // 이전 렌더링의 시작 인덱스
let lastVisibleEnd = 0;    // 이전 렌더링의 끝 인덱스

// setInterval(() => {
//     const visibleStart = scrolleditemidx;
//     const visibleEnd = Math.min(scrolleditemidx + visual_pictures_col, Math.ceil(dirlist.length / visual_pictures_row));
//     const visibleItemStart = visibleStart * visual_pictures_row;
//     const visibleItemEnd = visibleEnd * visual_pictures_row;

//     // 제거: 현재 화면 범위(visibleItemStart..visibleItemEnd) 밖의 모든 항목 제거
//     document.querySelectorAll('[data-item-index]').forEach(el => {
//         const idxStr = el.getAttribute('data-item-index');
//         const idx = Number(idxStr);
//         if (isNaN(idx)) return;
//         if (idx < visibleItemStart || idx >= visibleItemEnd) {
//             el.remove();
//             console.log(`[Remove] Item ${idx} (out of range)`);
//         }
//     });

// }, 1000);


function eliminate_out_of_range_items(visibleItemStart, visibleItemEnd) {
    // 제거: 현재 화면 범위(visibleItemStart..visibleItemEnd) 밖의 모든 항목 제거
    document.querySelectorAll('[data-item-index]').forEach(el => {
        const idxStr = el.getAttribute('data-item-index');
        const idx = Number(idxStr);
        if (isNaN(idx)) return;
        if (idx < visibleItemStart || idx >= visibleItemEnd) {
            el.remove();
            console.log(`[Remove] Item ${idx} (out of range)`);
        }
    });
}


async function refreshinginfinitylist()
{
    // 계산: 현재 화면에 보여야 할 항목 범위
    const visibleStart = scrolleditemidx;
    const visibleEnd = Math.min(scrolleditemidx + visual_pictures_col, Math.ceil(dirlist.length / visual_pictures_row));
    const visibleItemStart = visibleStart * visual_pictures_row;
    const visibleItemEnd = visibleEnd * visual_pictures_row;

    console.log(`[Refresh] Current: ${visibleItemStart}-${visibleItemEnd}, Last: ${lastVisibleStart}-${lastVisibleEnd}`);

    // 첫 렌더링인 경우: 전체 DOM 초기화
    if(lastVisibleStart === 0 && lastVisibleEnd === 0) {
        TopScrollView.innerHTML = '';
        
        for(let i=0; i<visual_pictures_row*visual_pictures_col; i++) {
            const idx = i + (scrolleditemidx * visual_pictures_row);
            if(idx >= dirlist.length) break;
            
            const dirlist_item = dirlist[idx];
            const pos_x = (item_w + 1) * (i % visual_pictures_row);
            const pos_y = (item_h + 1) * (Math.floor(i / visual_pictures_row) + scrolleditemidx);
            
            const html = await makeitem(item_w, item_h, pos_x, pos_y, dirlist_item.fname, dirlist_item.text);
            // skip if already present (prevents duplicate overlap)
            if (!TopScrollView.querySelector(`[data-item-index="${idx}"]`)) {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html;
                const itemElem = wrapper.firstElementChild;
                if (itemElem) {
                    itemElem.setAttribute('data-item-index', idx);
                    TopScrollView.appendChild(itemElem);
                }
            } else {
                console.log(`[Skip] Item ${idx} already exists (initial render)`);
            }
        }
        
        lastVisibleStart = visibleItemStart;
        lastVisibleEnd = Math.min(visibleItemEnd, dirlist.length);
        return;
    }

    // 범위 변경이 없으면 스킵
    if(visibleItemStart === lastVisibleStart && visibleItemEnd === lastVisibleEnd) {
        return;
    }

    // 제거: 이전 범위에는 있었지만 새 범위 밖인 항목
    if(visibleItemStart > lastVisibleStart) {
        // 아래로 스크롤: 위 항목 제거
        console.log(`remove idx - ${lastVisibleStart} to ${visibleItemStart}`);
        for(let idx = lastVisibleStart; idx < visibleItemStart; idx++) {
            const element = document.querySelector(`[data-item-index="${idx}"]`);
            if(element) {
                element.remove();
                console.log(`[Remove] Item ${idx}`);
            }
            else
            {
                console.log(`[Remove] Item ${idx} not found in DOM`);
            }
        }
    } else if(visibleItemStart < lastVisibleStart) {
        // 위로 스크롤: 아래 항목 제거

        console.log(`remove idx - ${visibleItemEnd} to ${lastVisibleEnd}`);
        for(let idx = visibleItemEnd; idx < lastVisibleEnd; idx++) {
            const element = document.querySelector(`[data-item-index="${idx}"]`);
            if(element) {
                element.remove();
                console.log(`[Remove] Item ${idx}`);
            }
            else
            {
                console.log(`[Remove] Item ${idx} not found in DOM`);
            }
        }
    }

    // 추가: 새 범위에는 있지만 이전 범위에는 없는 항목
    const itemsToAdd = [];
    
    if(visibleItemStart < lastVisibleStart) {
        // 위로 스크롤: 위에 추가할 항목들
        for(let idx = visibleItemStart; idx < lastVisibleStart; idx++) {
            itemsToAdd.push(idx);
        }
    }
    
    if(visibleItemEnd > lastVisibleEnd) {
        // 아래로 스크롤: 아래에 추가할 항목들
        for(let idx = lastVisibleEnd; idx < visibleItemEnd; idx++) {
            itemsToAdd.push(idx);
        }
    }

    // 새로운 항목들을 DOM에 추가
    for(let idx of itemsToAdd) {
        if(idx >= 0 && idx < dirlist.length) {
            const dirlist_item = dirlist[idx];
            const row = Math.floor(idx / visual_pictures_row);
            const col = idx % visual_pictures_row;
            const pos_x = (item_w + 1) * col;
            const pos_y = (item_h + 1) * row;
            
            // skip if already present (prevents duplicate overlap)
            if (!TopScrollView.querySelector(`[data-item-index="${idx}"]`)) {
                const html = await makeitem(item_w, item_h, pos_x, pos_y, dirlist_item.fname, dirlist_item.text);
                const wrapper = document.createElement('div');
                wrapper.innerHTML = html;
                const itemElem = wrapper.firstElementChild;
                if (itemElem) {
                    itemElem.setAttribute('data-item-index', idx);
                    TopScrollView.appendChild(itemElem);
                }
                console.log(`[Add] Item ${idx}`);
            } else {
                console.log(`[Skip] Item ${idx} already exists`);
            }
        }
    }

    // 렌더링 범위 업데이트
    lastVisibleStart = visibleItemStart;
    lastVisibleEnd = Math.min(visibleItemEnd, dirlist.length);

    eliminate_out_of_range_items(visibleItemStart, visibleItemEnd);

}

function video_to_image_base64(video) {
    const canvas = document.querySelector('canvas');
    canvas.width = video.videoWidth/2;
    canvas.height = video.videoHeight/2;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const scale = 0.5;
    const canvasValue = canvas.toDataURL('image/jpeg', scale); // Base64 저장 - 0 ~ 1 퀄리티 범위
    return canvasValue;
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
    
    // 이전 debounce 타이머 취소
    if (scrollDebounceTimer) {
        clearTimeout(scrollDebounceTimer);
    }

    // 새로운 debounce 타이머 설정: 스크롤이 안정되면 refresh 호출
    scrollDebounceTimer = setTimeout(() => {
        if(scrolleditemidx != scrolleditemidx_store)
        {
            console.log(`scrolleditemidx - ${scrolleditemidx} (debounced)`);
        
            refreshinginfinitylist();
            scrolleditemidx_store = scrolleditemidx;
        }
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

let makeitem_Store = {};

async function makeitem(w,h,x,y,fname,text) {
    let ret;
    
    let item_enterable = false;
    let item_img = false;
    let imgpath = '';
    let item_vid = false;
    let need_video_load = false;
    let vidpath = '';

    let makeitem_stored = makeitem_Store[fname];

    if(!makeitem_stored)
    {
        let belowdirseekpath = `${parampath}/${fname}`;
        try {
            const jsondata = await dirseek(belowdirseekpath);
            if(jsondata["ret"]) // openable directory
            {
                item_enterable = true;
    
                let dirbelowimgs = [];
        
                jsondata["data"].forEach(each => {
                    const name = each["d"];
                    const time = each["t"];
                    
                    let fnameext = name.substring(name.lastIndexOf('.')+1);
                    
                    fnameext = fnameext.toLowerCase();
                    
                    if(isImageExt(fnameext)) dirbelowimgs.push(name);

                })
        
                if(dirbelowimgs.length > 0) {
                    item_img = true;
                    imgpath = belowdirseekpath + "/" + randChoice(dirbelowimgs);
                }
                
            }
            else // just A File
            {
                let fnameext = fname.substring(fname.lastIndexOf('.')+1);
    
                if(isImageExt(fnameext)) {
                    item_img = true;
                    imgpath = parampath + "/" + fname;
                }
                else if(fnameext == 'mp4' || fnameext == 'mov' || fnameext == 'mkv') {
                    item_vid = true;

                    // vidpath = parampath + "/" + encodeURI(fname);
                    // let name = vidpath.substring(vidpath.lastIndexOf('/')+1);
                    // const get_result = await indexedDB_get(name);
                    // if(get_result != undefined) // valid
                    // {
                    //     console.log(`prepared - ${name}`);
                    //     item_img = true;
                    //     imgpath = get_result['filedata'];
                    // }
                    // else // need to extract frame
                    // {
                    //     need_video_load = true;

                    //     console.log(`video loading - ${name}`);
                    // }
					
                    vidpath = parampath + "/" + encodeURI(fname);
                    need_video_load = true;

                }
            }
        }
        catch(ex) {
            console.log(ex);
        }
        
        makeitem_Store[fname] = {  // ✅ push 제거, 객체 할당
            fname: fname,
            item_enterable: item_enterable,
            item_img: item_img,
            imgpath: imgpath,
            item_vid: item_vid,
            need_video_load: need_video_load,
            vidpath: vidpath
        };
    }
    else {
        item_enterable = makeitem_Store[fname].item_enterable;
        item_img = makeitem_Store[fname].item_img;
        imgpath = makeitem_Store[fname].imgpath;
        item_vid = makeitem_Store[fname].item_vid;
        vidpath = makeitem_Store[fname].vidpath;
        need_video_load = makeitem_Store[fname].need_video_load;
    }

    let linkelemnts;
    let imgelements;

    if(item_vid)
    {
        item_enterable = true;

        linkelemnts = ``;

        // if(fname.substr(0, 3).toLowerCase() == 'tmw')
        // // if(false)
        // {
        //     linkelemnts = `
        //     <div class="badge-container">
        //         <div class="badge">
        //             VR180PLAY
        //             <a href="${document.location.origin}${document.location.pathname}/videoview180.html?p=${vidpath}${paramfind != null ? `&f=${paramfind}` : ""}" target="_blank" class="item-badge-link"></a>
        //         </div>
        //     </div>
        //     `;
        // }
        // else
        // {
        //     linkelemnts = ``;
        // }

        if(fname.substr(0, 3).toLowerCase() == 'tmw')
        {
            linkelemnts += `<a href=${document.location.origin}${document.location.pathname}/videoview180.html?p=${vidpath}${paramfind != null ? `&f=${paramfind}` : ""} target="_blank"></a>`
        }
        else
        {
            linkelemnts += `<a href=${document.location.origin}${document.location.pathname}/videoview.html?p=${vidpath}${paramfind != null ? `&f=${paramfind}` : ""} target="_blank"></a>`
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

        linkelemnts = ``;

        linkelemnts = `
        <div class="badge-container">
            <div class="badge">
                maxview
                <a href="maxview://open?path=${belowpathlink}" return false;" class="item-badge-link"></a>
            </div>
            <div class="badge">
                wexpl
                <a href="winexplr://open?path=${belowpathlink}" return false;" class="item-badge-link"></a>
            </div>
        </div>
        `;
    
        linkelemnts += parampathgiven ? `<a href="${enter_element}/${fname}"></a>` : `<a href="${enter_element}?p=${fname}"></a>`;
    }

    imgelements = `<img src="${imgpath}" loading=lazyloading alt="Cover" style="position: absolute; width: 100%; height: 100%; object-fit:cover; "}}>`;
    let videlements = `<video loop src=${vidpath} style="position: absolute; width: 100%; height: 100%; object-fit: cover;" ></video>`;
    
    ret = `<div class="item" style="width: ${w-4}px; height: ${h-4}px; transform: translate(${x}px, ${y}px); position: absolute; ">
    <div style="box-sizing: border-box; overflow: hidden; position: absolute; width: 100%; height: 100%; ">
        <div class="layer-text" style="box-sizing:border-box">
            <h3>${text}</h3>
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


const explorer_open_btn = document.getElementById('btn-open-explorer');

explorer_open_btn.addEventListener('click', () => {

    const belowpath = parampath;
    let belowpathlink = "";

    if(belowpath.substr(0, 5) == 'drvs/')
    {
        belowpathlink = document.location.origin + "\\" + belowpath.substring(5, belowpath.length);
        belowpathlink = belowpathlink.substring(5, belowpathlink.length);
        belowpathlink = belowpathlink.replaceAll("/", "\\");

        //example - `maxview://open?path=\\192.168.100.101\drive_5\contents`
        //          `winexplr://open?path=\\192.168.100.101\drive_5\contents`
        
        belowpathlink = `winexplr://open?path=${belowpathlink}`;

        console.log(`winexplr link - ${belowpathlink}`);
        
        window.location.href = belowpathlink;
    }
    else
    {
        console.log(`expect "drvs/" (${belowpath})`);
    }
});

let startupprocessing = false;

async function startup() {
    if(startupprocessing)
    {
        console.log('startup already processing, skip');
        return;
    }

    startupprocessing = true;

    let ordertype = localStorage.getItem('listordertype');

    if(ordertype == null)
    {
        ordertype = 1;
    }

    console.log(`ordertype - ${ordertype}`);

    dirlist = [];
    makeitem_Store = {};

    const jsondata = await dirseek(parampath);
    if(jsondata["ret"])
    {
        let queryedlist = jsondata["data"];

        queryedlist.forEach(each => {

            const name = each["d"];
            const time = Date.parse(each["t"]);
            
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
            
            dirlist = dirlist.filter(item => {
                const text = item.text.toLowerCase();
                // const hasExt = /\.[^/.]+$/.test(text);

                return (
                    !(
                        text.endsWith(".jpg") ||
                        text.endsWith(".jpeg") ||
                        text.endsWith(".sh")
                    ) || text.endsWith(".mp4")
                    // || !hasExt
                );
            });
            
            dirlist.sort((a, b) => Number(b.text.endsWith(".mp4")) - Number(a.text.endsWith(".mp4")));

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

            item_w = TopScrollView.clientWidth/visual_pictures_row;
            // item_w = 400;
            item_h = item_w;

            visual_pictures_col = Math.floor(window.innerHeight / item_h)+1;

            // console.log(`visual_pictures_row ${visual_pictures_row}`);
            // console.log(`visual_pictures_col ${visual_pictures_col}`);
            
            if(dirlist.length > 0) {
                let viewhei = (Math.floor(dirlist.length/visual_pictures_row)) * item_h;
                TopScrollView.style.height = viewhei;
            }

            // console.log(`dirlist - ${JSON.stringify(dirlist)}`);

			refreshinginfinitylist();
			
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
    indexedDB_init();
}, false)

function setordertype(type)
{
    if(type >= 1 && type <= 4)
    {
        localStorage.setItem('listordertype', type); // time

        console.log(`startup with setordertype - ${type}`);
        startup();
    }
}


function commandtyped(cmd)
{
    console.log(`cmd - ${cmd}`);
}

let typingmodecmd = false;
let typingmode = false;
let typinginputstr = '';
let typinginputsubmit = '';

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
                        window.open(`${window.location.href}&f=${typinginputsubmit}`, '_blank');
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
        makeitem_Store = [];
        refreshinginfinitylist();
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

// only rerun startup when width changes, n ot height
let lastWindowWidth = window.innerWidth;
window.addEventListener("resize", () => {
    const w = window.innerWidth;
    if (w !== lastWindowWidth) {
        lastWindowWidth = w;
        startup();
    }
});
