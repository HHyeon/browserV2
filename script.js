
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
let visual_pictures_col = 4;


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

async function refreshinginfinitylist()
{
    TopScrollView.innerHTML = '';

    for(let i=0;i<visual_pictures_row*visual_pictures_col;i++)
    {
        const pos_x = (item_w+1) * (i%visual_pictures_row);
        const pos_y = (item_h+1) * (Math.floor(i/visual_pictures_row)+scrolleditemidx);

        let pos = i+(scrolleditemidx*visual_pictures_row);

        if(dirlist.length <= pos) break;
        let dirlist_item = dirlist[pos];
        
		if(dirlist_item != undefined)
		{
			TopScrollView.innerHTML += await makeitem(item_w, item_h, pos_x, pos_y, dirlist_item.fname, dirlist_item.text);
		}
		else
		{
			console.log("dirlist is undefined !!!!");
		}
		
    }

    document.querySelectorAll('video').forEach(seekvideo => {
        let name0 = seekvideo.currentSrc;
        name0 = name0.substring(name0.lastIndexOf('/')+1);
        console.log(`seeking video ${name0}`);

        seekvideo.currentTime = 30;
        seekvideo.addEventListener('seeked', (seekedvideo) => {
            let name = seekedvideo.target.src;
            name = name.substring(name.lastIndexOf('/')+1);
            name = decodeURI(name);

            const imagedatabase64 = video_to_image_base64(seekedvideo.target);
            const targetvidtime = seekedvideo.target.currentTime;

            indexedDB_addvalue(name, imagedatabase64, targetvidtime, async () => {
                console.log(`cached - ${name} (${targetvidtime})`);
                let applytoItemInfo = makeitem_Store.filter(x=>x.fname == name)[0];
                if(applytoItemInfo != undefined)
                {
                    applytoItemInfo.need_video_load = false;
                    applytoItemInfo.item_img = true;
                    applytoItemInfo.imgpath = imagedatabase64;
                }


            });
        });
    });
}

function video_to_image_base64(video) {
    const canvas = document.querySelector('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const scale = 0.5;
    const canvasValue = canvas.toDataURL('image/jpeg', scale); // Base64 저장 - 0 ~ 1 퀄리티 범위
    return canvasValue;
}

let scrolleditemidx = 0;
let scrolleditemidx_store = 0;
window.addEventListener("scroll", function(e) {
	
	if(dirlist.length == 0)
	{
		console.log("scroll skipp");
		return;
	}

    scrolleditemidx = Math.floor(window.scrollY / item_h);
    if(scrolleditemidx != scrolleditemidx_store)
    {
        // console.log(`scrolleditemidx - ${scrolleditemidx}`);
	
		refreshinginfinitylist();

        // if(scrolleditemidx > scrolleditemidx_store)
        // {
        //     console.log(`up!`);
        // }
        // else
        // {
        //     console.log(`down`);
        // }

    }
    scrolleditemidx_store = scrolleditemidx;

});

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

let makeitem_Store = [];

async function makeitem(w,h,x,y,fname,text) {
    let ret;
    
    let item_enterable = false;
    let item_img = false;
    let imgpath = '';
    let item_vid = false;
    let need_video_load = false;
    let vidpath = '';

    let makeitem_stored = undefined;

    if(makeitem_Store.length > 0)
        makeitem_stored = makeitem_Store.filter(x => x.fname == fname);

    if(makeitem_stored == undefined || makeitem_stored == '') {

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
                    vidpath = parampath + "/" + encodeURI(fname);
                    let name = vidpath.substring(vidpath.lastIndexOf('/')+1);



                    const get_result = await indexedDB_get(name);
                    if(get_result != undefined) // valid
                    {
                        console.log(`prepared - ${name}`);
                        item_img = true;
                        imgpath = get_result['filedata'];
                    }
                    else // need to extract frame
                    {
                        need_video_load = true;

                        console.log(`video loading - ${name}`);
                    }
					
					
					
					
					// let vidpath__;
					
					// for (let i = 0; i <= 4; i++)
					// {
						// const from = `drive_${i}`;
						// const to = `drv${i}`;
						// if (vidpath.includes(from))
						// {
							// vidpath__ = vidpath.replace(from, to);
							// break; // 매칭된 경우 더 이상 검사할 필요 없음
						// }
					// }
					
					// console.log(`vidpath__ - ${vidpath__}`);
					
					// item_img = true;
					// imgpath = `http://192.168.0.101:3000/api/thumbnail?path=${vidpath__}&time=60`
					
					

                }
            }
        }
        catch(ex) {
            console.log(ex);
        }
        
        makeitem_Store.push({
            fname: fname,
            item_enterable: item_enterable,
            item_img: item_img,
            imgpath: imgpath,
            item_vid: item_vid,
            need_video_load: need_video_load,
            vidpath: vidpath
        });
    }
    else {
        item_enterable = makeitem_stored[0].item_enterable;
        item_img = makeitem_stored[0].item_img;
        imgpath = makeitem_stored[0].imgpath;
        item_vid = makeitem_stored[0].item_vid;
        vidpath = makeitem_stored[0].vidpath;
        need_video_load = makeitem_stored[0].need_video_load;
    }

    let linkelemnts;
    let imgelements;

    if(item_vid)
    {
        item_enterable = true;
        linkelemnts = `<a href=${document.location.origin}${document.location.pathname}/videoview.html?p=${vidpath}${paramfind != null ? `&f=${paramfind}` : ""} target="_blank"></a>`
        // console.log(linkelemnts);
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
    let videlements = `<video buffered src=${vidpath} style="position: absolute; width: 100%; height: 100%; object-fit: cover;" ></video>`;
    
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

async function startup() {

    let ordertype = localStorage.getItem('listordertype');

    if(ordertype == null)
    {
        ordertype = 1;
    }

    console.log(`ordertype - ${ordertype}`);

    visual_pictures_row = Math.floor(window.innerWidth / 400);

    dirlist = [];

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
            item_h = item_w/3*4;

            visual_pictures_col = Math.floor(window.innerHeight / item_h)+2;

            // console.log(`visual_pictures_row ${visual_pictures_row}`);
            // console.log(`visual_pictures_col ${visual_pictures_col}`);
            
            if(dirlist.length > 0) {
                let viewhei = (Math.floor(dirlist.length/visual_pictures_row)) * item_h;
                TopScrollView.style.height = viewhei;
            }

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

window.addEventListener("resize", () => {
    startup();
});
