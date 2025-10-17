
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

function runquery() {
    let xmlhttp = new XMLHttpRequest();
    let url=`query.php`;
    xmlhttp.open("GET", url, false);
    xmlhttp.send(null);
    return xmlhttp.responseText;
};

function dirseek(param) {
    let xmlhttp = new XMLHttpRequest();
    let url=`dirseek.php?x=${param}`;
    xmlhttp.open("GET", url, false);
    xmlhttp.send(null);
    return xmlhttp.responseText;
};


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
        const pos_x = item_w * (i%visual_pictures_row);
        const pos_y = item_h * (Math.floor(i/visual_pictures_row)+scrolleditemidx);

        let pos = i+(scrolleditemidx*visual_pictures_row);

        if(dirlist.length <= pos) break;
        let dirlist_item = dirlist[pos];
        
        TopScrollView.innerHTML += await makeitem(item_w, item_h, pos_x, pos_y, dirlist_item.fname, dirlist_item.text);
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
    // console.log(window.scrollY);

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
            const jsondata = JSON.parse(dirseek(belowdirseekpath));
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
        console.log(linkelemnts);
    }
    else
    {
        enter_element = document.location.href;
        if(enter_element.lastIndexOf('&f=') != -1)
            enter_element = enter_element.substring(0, enter_element.lastIndexOf('&f='));
        linkelemnts = parampathgiven ? `<a href="${enter_element}/${fname}"></a>` : `<a href="${enter_element}?p=${fname}"></a>`;
    }

    imgelements = `<img src="${imgpath}" loading=lazyloading alt="Cover" style="position: absolute; width: 100%; height: 100%; object-fit:cover; "}}>`;
    let videlements = `<video buffered src=${vidpath} style="position: absolute; width: 100%; height: 100%; object-fit: cover;" ></video>`;
    
    ret = `<div class="item" style="border: solid lightgray; width: ${w}px; height: ${h}px; transform: translate(${x}px, ${y}px); position: absolute;">
    <div style="box-sizing: border-box; overflow: hidden; position: absolute; width: 100%; height: 100%; ">` +
        `<div class="layer-text" style="box-sizing:border-box">
            <h3>${text}</h3>
        </div>` +
        (item_enterable ? linkelemnts : '') +
        (item_img ? imgelements : '') +
        (need_video_load ? videlements : '') +
        `</div>
    </div>`;

    return ret;
}

function startup() {

    visual_pictures_row = Math.floor(window.innerWidth / 400);

    dirlist = [];

    const jsondata=JSON.parse(dirseek(parampath)); // runquery()
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
            dirlist.sort((a,b) => { return b.time - a.time; });

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

            console.log(`visual_pictures_row ${visual_pictures_row}`);
            console.log(`visual_pictures_col ${visual_pictures_col}`);
            
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
    indexedDB_init();
}, false)

let typingmode = 0;
let typinginputstr = '';
let typinginputsubmit = '';

document.addEventListener('keydown', (e) => {
    
    // console.log(e.key);

    if(e.key.length == 1)
    {
        if(!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)
        {
            if(e.key.charCodeAt(0) >= ' '.charCodeAt(0) && e.key.charCodeAt(0) <= '~'.charCodeAt(0))
            {
                typingmode = 1;
                document.getElementById('search_panel').style.visibility = '';
                // console.log(e.key);
                typinginputstr += e.key;
                typing_panel.innerText = typinginputstr;
            }
        }
    }
    
    if(e.key == 'Escape')
    {
        typingmode = 0;
        typinginputstr = '';
        typing_panel.innerText = typinginputstr;
        document.getElementById('search_panel').style.visibility = 'hidden';
    }
    else if(e.key == 'Enter')
    {
        typingmode = 0;
        typinginputsubmit = typinginputstr;
        typinginputstr = '';
        typing_panel.innerText = typinginputstr;
        document.getElementById('search_panel').style.visibility = 'hidden';

        if(typinginputsubmit != '')
        {
            window.open(`${window.location.href}&f=${typinginputsubmit}`, '_blank');
        }
    }

    if(e.key == 'Backspace') {

        if(typingmode == 1)
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
                console.log(`link - ${link.substring(0, link.lastIndexOf('/'))}`);
                window.location = link.substring(0, link.lastIndexOf('/'));
            }
            
        }
    }

});

window.addEventListener("resize", () => {
    startup();
});
