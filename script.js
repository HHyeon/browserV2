

let queryedlist;
let item_w, item_h;
let TopScrollView = document.getElementById('scroll-views');
let visual_pictures_row = 4;
let visual_pictures_col = 4;

function runquery() {
    let xmlhttp = new XMLHttpRequest();
    let url=`query.php`;
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

        if(queryedlist.length <= i+(scrolleditemidx*visual_pictures_row)) break;

        let imgpath = queryedlist[i+(scrolleditemidx*visual_pictures_row)];
        let imgtext = imgpath;

        try
        {
            let p1 = imgtext.indexOf('/');
            if(p1 >= 0)
            {
                imgtext = imgtext.substring(p1+1, imgtext.length);
                p1 = imgtext.indexOf('/');
                imgtext = imgtext = imgtext.substring(0, p1);
            }
        }
        catch(ex) {
            console.log(ex);
        }
        
        TopScrollView.innerHTML += makeitem(item_w, item_h, pos_x, pos_y, imgpath, imgtext);
    }
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

function makeitem(w,h,x,y,imgpath,text) {
    return `<div class="item" style="width: ${w}px; height: ${h}px; transform: translate(${x}px, ${y}px); position: absolute;">
                <div style="box-sizing: border-box; overflow: hidden; position: absolute; width: 100%; height: 100%;" >
                    <div class="layer-text" style="box-sizing:border-box">
                        <h3>${text}</h3>
                    </div>
                    <img src="${imgpath}" alt="Cover" style="position: absolute; width: 100%; height: 100%;">
                </div>
            </div>`
}

function startup() {
    let MainTitle = document.getElementById('MainTitle');

    TopScrollView.innerHTML = '';

    const jsondata=JSON.parse(runquery());
    
    item_w = TopScrollView.clientWidth/visual_pictures_row;
    item_h = item_w/3*4; // height/width be 4:3 ratio
    
    if(jsondata["ret"])
    {
        queryedlist = jsondata["data"];
        
        refreshinginfinitylist();
    }
    else
    {
        MainTitle.style.display = 'block';
        MainTitle.innerText = 'Querying Error !';
    }
}

document.addEventListener("DOMContentLoaded", () => {
    let viewhei = Math.floor(queryedlist.length/visual_pictures_row) * item_h;
    TopScrollView.style.height = viewhei;
}, false)

startup();

window.addEventListener("resize", () => {
    // startup();
});
