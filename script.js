
const urlParams = (new URL(window.location.href)).searchParams;
let parampath = urlParams.get('p');
if(parampath != null || parampath == '')
    document.title = parampath.substring(parampath.lastIndexOf('/')+1, parampath.length);
let parampathgiven = true;

if(parampath == '.' || parampath == null)
    parampathgiven = false;
else
    if(parampath[parampath.length-1] == '/') parampath = parampath.substring(0, parampath.length-1);

if(parampath == null) parampath = '.';
// console.log(`parampath - ${parampath}`);

let dirlist = [];
let item_w, item_h;
let TopScrollView = document.getElementById('scroll-views');
let MainTitle = document.getElementById('MainTitle');
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

function refreshinginfinitylist()
{
    TopScrollView.innerHTML = '';

    for(let i=0;i<visual_pictures_row*visual_pictures_col;i++)
    {
        const pos_x = item_w * (i%visual_pictures_row);
        const pos_y = item_h * (Math.floor(i/visual_pictures_row)+scrolleditemidx);

        let pos = i+(scrolleditemidx*visual_pictures_row);

        if(dirlist.length <= pos) break;
        let dirlist_item = dirlist[pos];
        
        TopScrollView.innerHTML += makeitem(item_w, item_h, pos_x, pos_y, dirlist_item.fname, dirlist_item.text);
    }

    // document.querySelectorAll('video').forEach(v => {
    //     v.currentTime = 30;
    // });
    
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

function makeitem(w,h,x,y,fname,text) {
    let ret;
    
    let item_enterable = false;
    let item_img = false;
    let imgpath = '';
    let item_vid = false;
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
                    if(fnameext == 'jpeg' || fnameext == 'jpg' || fnameext == 'png') dirbelowimgs.push(name);
                })
        
                if(dirbelowimgs.length > 0) {
                    item_img = true;
                    imgpath = belowdirseekpath + "/" + randChoice(dirbelowimgs);
                }
                
            }
            else // just A File
            {
                console.log(`path ${belowdirseekpath} is not Enterable`);

                let fnameext = fname.substring(fname.lastIndexOf('.')+1);
    
                if(fnameext == 'jpeg' || fnameext == 'jpg' || fnameext == 'png') {
                    item_img = true;
                    imgpath = parampath + "/" + fname;
                }
                else if(fnameext == 'mp4') {
                    item_vid = true; 
                    vidpath = parampath + "/" + fname;
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
            vidpath: vidpath
        });
    }
    else {
        item_enterable = makeitem_stored[0].item_enterable;
        item_img = makeitem_stored[0].item_img;
        imgpath = makeitem_stored[0].imgpath;
        item_vid = makeitem_stored[0].item_vid;
        vidpath = makeitem_stored[0].vidpath;
    }

    let linkelemnts;

    if(item_vid)
    {
        item_enterable = true;
        linkelemnts = `<a href=${document.location.origin}${document.location.pathname}/videoview.html?p=${vidpath} target="_blank"></a>`
    }
    else
    {
        linkelemnts = parampathgiven ? `<a href="${document.location.href}/${fname}"></a>` : `<a href="${document.location.href}?p=${fname}"></a>`;
    }
    
    let imgelements = `<img src="${imgpath}" loading=lazyloading alt="Cover" style="position: absolute; width: 100%; height: 100%; object-fit:cover; "}}>`;
    
    let videlements = `<video buffered src=${vidpath} style="position: absolute; width: 100%; height: 100%; object-fit: cover;" ></video>`;
    
    ret = `<div class="item" style="border: solid lightgray; width: ${w}px; height: ${h}px; transform: translate(${x}px, ${y}px); position: absolute;">
    <div style="box-sizing: border-box; overflow: hidden; position: absolute; width: 100%; height: 100%; ">` +
        `<div class="layer-text" style="box-sizing:border-box">
            <h3>${text}</h3>
        </div>` +
        (item_enterable ? linkelemnts : '') +
        (item_img ? imgelements : '') +
        // (item_vid ? videlements : '') +
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
            
            let imgtext;
            try
            {
                imgtext = name;
                let p1 = imgtext.indexOf('/');
                if(p1 >= 0)
                {
                    imgtext = imgtext.substring(p1+1, imgtext.length);
                    p1 = imgtext.indexOf('/');
                    imgtext = imgtext = imgtext.substring(0, p1);
                }
            }
            catch(ex) {
                imgtext = '';
                console.log(ex);
            }

            dirlist.push(
                {
                    fname: name,
                    text: imgtext,
                    time: time
                }
            );
        });

        if(dirlist.length > 0) {
            dirlist.sort((a,b) => { return b.time - a.time; });

            let imgfiles = dirlist.filter(x => x.fname.endsWith('jpeg') || x.fname.endsWith('jpg') || x.fname.endsWith('png'));
    
            if(imgfiles.length / dirlist.length  > 0.9) { // At Over 90% JPG/JPEG in list.
                // Eliminate none-jpg/jpeg file
                dirlist = imgfiles;
                // Single Row mode
                visual_pictures_row = 1;
                // sort by name
                dirlist.sort((a,b) => {
                    return extractlastnumberfromfilename(a.fname) - extractlastnumberfromfilename(b.fname);
                });
            }

            item_w = TopScrollView.clientWidth/visual_pictures_row;
            item_h = item_w/3*4;

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
    if(dirlist.length > 0) {
        let viewhei = Math.floor(dirlist.length/visual_pictures_row) * item_h;
        TopScrollView.style.height = viewhei;
    }
}, false)

document.addEventListener('keydown', (e) => {
    console.log(e.key);

    if(e.key == 'Backspace') {
        let link = window.location.href;
        window.location = link.substring(0, link.lastIndexOf('/'))
    }

});

startup();

window.addEventListener("resize", () => {
    startup();
});
