(function(){
'use strict';

var CATS=['Starter','Main','Side','Dessert','Bake','Breakfast','Other'];
var SOURCES=['Book','Online','Instagram','Friend or family','Other'];
var SRC_HINT={'Book':'Title and page, e.g. Jerusalem p. 112','Online':'Paste the link','Instagram':'Paste the link or the account name','Friend or family':'Who gave it to you','Other':'Anything that helps you find it again'};
var STAR='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.9-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.1 1.1-6.5L2.6 9.5l6.5-.9z"/></svg>';
var URL_TTL=5*3600*1000;      /* signed photo links last 6h; refresh after 5h */
var BUCKET='photos';

var S={
  sb:null,me:null,email:'',
  recipes:new Map(),cooks:new Map(),ratings:new Map(),profiles:new Map(),
  tab:'cooked',cat:'All',q:'',sort:'recent',openId:null,scrollY:0,
  ready:false,loadError:'',notMember:false,
  urls:new Map(),urlsAt:0,chan:null,loadTimer:null,loading:false,again:false
};
var F={mode:null,rid:null,cid:null,status:'cooked',rating:0,origRating:0,photos:[],removed:[],busy:false,armed:false,opener:null,timer:null};
var L={paths:[],i:0,opener:null,token:0};

function $(s,el){return (el||document).querySelector(s)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function hash(s){var n=0,t=String(s);for(var i=0;i<t.length;i++){n=(n*31+t.charCodeAt(i))>>>0}return n}
function today(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function parseD(s){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s||'');return m?new Date(+m[1],+m[2]-1,+m[3]):null}
function fmtLong(s){var d=parseD(s);return d?d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'}):'No date'}
function fmtShort(s){var d=parseD(s);return d?d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):''}
function fmtAvg(a){return String(Math.round(a*10)/10)}
function uuid(){
  if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16)});
}
function thumbOf(p){return String(p).replace(/\.jpg$/,'_t.jpg')}
function must(r){if(r&&r.error)throw r.error;return r}

function errMsg(e){
  var m=String((e&&e.message)||e||'').toLowerCase(),code=e&&(e.code||e.statusCode);
  if(code==='42501'||m.indexOf('row-level security')>=0||m.indexOf('permission denied')>=0) return "This account can't change the book.";
  if(code==='413'||m.indexOf('too large')>=0||m.indexOf('payload')>=0) return 'That photo is too big.';
  if(m.indexOf('decode')>=0||m.indexOf('format')>=0) return "That photo format isn't supported. Try a JPEG or PNG.";
  if(m.indexOf('jwt')>=0||m.indexOf('expired')>=0) return 'Your sign-in has expired. Reload the page and sign in again.';
  if(m.indexOf('fetch')>=0||m.indexOf('network')>=0||m.indexOf('failed')>=0) return "Couldn't reach the book. Check your connection and try again.";
  var detail=[e&&(e.code||e.statusCode),e&&e.message?e.message:(typeof e==='string'?e:'')].filter(Boolean).join(': ').slice(0,220);
  try{console.error('Table for Two error:',e)}catch(x){}
  return "Couldn't save that. Try again in a moment."+(detail?' ('+detail+')':'');
}
var toastTimer=null;
function toast(msg){var t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.hidden=true},3200)}
function syncLock(){document.documentElement.style.overflow=(!$('#sheet').hidden||!$('#account').hidden||!$('#lb').hidden)?'hidden':''}
function screen(name){
  ['setup','auth','app'].forEach(function(n){$('#screen-'+n).hidden=n!==name});
}

/* ---------- photo links ---------- */
function thumbUrl(p){return S.urls.get(thumbOf(p))||''}
async function signPaths(paths,secs){
  var out=[];
  for(var i=0;i<paths.length;i+=100){
    var r=must(await S.sb.storage.from(BUCKET).createSignedUrls(paths.slice(i,i+100),secs));
    (r.data||[]).forEach(function(x){if(x&&x.signedUrl&&!x.error)out.push([x.path,x.signedUrl])});
  }
  return out;
}
async function signThumbs(){
  if(Date.now()-S.urlsAt>URL_TTL){S.urls=new Map();S.urlsAt=Date.now()}
  var need=[];
  S.cooks.forEach(function(c){(c.photos||[]).forEach(function(p){var t=thumbOf(p);if(!S.urls.has(t))need.push(t)})});
  if(!need.length)return;
  try{(await signPaths(need,21600)).forEach(function(x){S.urls.set(x[0],x[1])})}catch(e){}
}

/* ---------- derived data ---------- */
function cmpCook(a,b){return String(b.cooked_on||'').localeCompare(String(a.cooked_on||''))||String(b.created_at||'').localeCompare(String(a.created_at||''))}
function models(){
  var by=new Map();
  S.cooks.forEach(function(c){if(!by.has(c.recipe_id))by.set(c.recipe_id,[]);by.get(c.recipe_id).push(c)});
  var out=new Map();
  S.recipes.forEach(function(r){
    var cooks=(by.get(r.id)||[]).sort(cmpCook),sum=0,n=0;
    cooks.forEach(function(c){var rs=S.ratings.get(c.id)||{};Object.keys(rs).forEach(function(u){sum+=rs[u];n++})});
    var wp=cooks.find(function(c){return (c.photos||[]).length&&thumbUrl(c.photos[0])});
    out.set(r.id,{r:r,cooks:cooks,avg:n?sum/n:null,rn:n,last:cooks[0]?cooks[0].cooked_on:null,cover:wp?thumbUrl(wp.photos[0]):null});
  });
  return out;
}
function sorter(k,tab){
  var added=function(a,b){return String(b.r.created_at||'').localeCompare(String(a.r.created_at||''))};
  if(k==='az') return function(a,b){return String(a.r.title).localeCompare(String(b.r.title))};
  if(k==='top') return function(a,b){var x=b.avg==null?-1:b.avg,y=a.avg==null?-1:a.avg;return (x-y)||added(a,b)};
  if(k==='added'||tab==='try') return added;
  return function(a,b){return String(b.last||'').localeCompare(String(a.last||''))||added(a,b)};
}
function srcHtml(r){
  var type=r.source_type?esc(r.source_type):'';
  var s=String(r.source||'').trim(),body='';
  if(/^https?:\/\//i.test(s)){
    var host=s;try{host=new URL(s).hostname.replace(/^www\./,'')}catch(e){}
    body='<a href="'+esc(s)+'" target="_blank" rel="noopener noreferrer">'+esc(host)+'</a>';
  } else if(s){ body=esc(s) }
  if(type&&body) return type+' · '+body;
  return type||body;
}
function nameOf(id){var p=S.profiles.get(id);return (p&&p.name)||'Them'}

/* ---------- list ---------- */
function cardHtml(m){
  var r=m.r,tile=(hash(r.id)%4)+1;
  var first=Array.from(String(r.title||'?').trim())[0]||'?';
  var cover=m.cover?'<img data-img src="'+esc(m.cover)+'" alt="" loading="lazy">'
    :'<span class="tile-cat">'+esc(r.category||'')+'</span><span class="tile-letter" aria-hidden="true">'+esc(first.toUpperCase())+'</span>';
  var badge=m.cooks.length>1?'<span class="badge">×'+m.cooks.length+'</span>':'';
  var meta='';
  if(m.cooks.length){
    meta=(m.avg!=null?'<span class="mini">'+STAR+fmtAvg(m.avg)+'</span>':'<span>Not rated</span>')+'<span>'+esc(fmtShort(m.last))+'</span>';
  } else { meta='<span>'+esc(r.source_type||'To try')+'</span>' }
  return '<button type="button" class="card" data-action="open" data-id="'+esc(r.id)+'"><span class="cover t'+tile+'">'+cover+badge+'</span><span class="c-title">'+esc(r.title)+'</span><span class="c-meta">'+meta+'</span></button>';
}
function renderList(){
  var ms=Array.from(models().values());
  var cooked=ms.filter(function(m){return m.cooks.length}),tryList=ms.filter(function(m){return !m.cooks.length});
  $('#n-cooked').textContent=cooked.length;$('#n-try').textContent=tryList.length;
  var times=cooked.reduce(function(a,m){return a+m.cooks.length},0);
  $('#stats').textContent=ms.length?(cooked.length+' cooked · '+times+(times===1?' time':' times')+' · '+tryList.length+' to try'):'A cookbook for the two of you';
  document.querySelectorAll('.tabs [role=tab]').forEach(function(b){b.setAttribute('aria-selected',String(b.dataset.v===S.tab))});
  var cats=CATS.filter(function(c){return ms.some(function(m){return m.r.category===c})});
  if(S.cat!=='All'&&cats.indexOf(S.cat)<0)S.cat='All';
  $('#chips').innerHTML=cats.length>1?['All'].concat(cats).map(function(c){return '<button type="button" class="chip" data-action="cat" data-v="'+esc(c)+'" aria-pressed="'+(S.cat===c)+'">'+esc(c)+'</button>'}).join(''):'';
  var out=$('#results');
  if(S.notMember){out.innerHTML='';return}
  if(S.loadError){out.innerHTML='<div class="empty"><p class="empty-title">The book won\'t open.</p><p>'+esc(S.loadError)+' <button type="button" class="link inline" data-action="retry">Try again</button></p></div>';return}
  if(!S.ready){out.innerHTML='<div class="empty"><p class="empty-title">Opening the book…</p><p>Your recipes, dates and photos load in a moment.</p></div>';return}
  if(!ms.length){
    out.innerHTML='<div class="empty"><p class="empty-title">The first page is blank.</p><p>Add a recipe you have cooked, or one you can\'t wait to try. Each one keeps its dates, ratings and photos, and you can both add to it.</p><button type="button" class="primary" data-action="add">Add the first recipe</button></div>';return;
  }
  var q=S.q.trim().toLowerCase();
  var items=(S.tab==='cooked'?cooked:tryList).filter(function(m){
    return (S.cat==='All'||m.r.category===S.cat)&&(!q||[m.r.title,m.r.source,m.r.category,m.r.source_type].join(' ').toLowerCase().indexOf(q)>=0);
  });
  items.sort(sorter(S.sort,S.tab));
  if(!items.length){
    var base=(S.tab==='cooked'?cooked:tryList).length;
    var msg=base?'<p class="empty-title">Nothing matches.</p><p>Try a different search or course.</p>'
      :(S.tab==='cooked'?'<p class="empty-title">Nothing cooked yet.</p><p>When you make something from the To try list, log it and it moves here.</p>'
      :'<p class="empty-title">Nothing waiting.</p><p>Save the recipes you want to make, with a link or a book page so you can find them again.</p><button type="button" class="primary" data-action="add">Add a recipe</button>');
    out.innerHTML='<div class="empty">'+msg+'</div>';return;
  }
  out.innerHTML='<div class="grid">'+items.map(cardHtml).join('')+'</div>';
}

/* ---------- detail ---------- */
function starsHtml(n,cookId){
  var o='';
  for(var i=1;i<=5;i++){
    var on=i<=n?' on':'';
    o+=cookId?'<button type="button" class="star'+on+'" data-action="rate" data-cook="'+esc(cookId)+'" data-n="'+i+'" aria-label="'+i+(i>1?' stars':' star')+'" aria-pressed="'+(i<=n)+'">'+STAR+'</button>'
      :'<span class="star static'+on+'">'+STAR+'</span>';
  }
  return cookId?'<span class="stars" role="group" aria-label="Your rating">'+o+'</span>':'<span class="stars" role="img" aria-label="'+n+' out of 5">'+o+'</span>';
}
function ratesHtml(c){
  var rs=S.ratings.get(c.id)||{},rows=[];
  rows.push('<div class="rate-row"><span class="rate-label">You</span>'+starsHtml(rs[S.me]||0,c.id)+'</div>');
  Object.keys(rs).filter(function(id){return id!==S.me}).forEach(function(id){
    rows.push('<div class="rate-row"><span class="rate-label">'+esc(nameOf(id))+'</span>'+starsHtml(rs[id],null)+'</div>');
  });
  return '<div class="rates">'+rows.join('')+'</div>';
}
function cookHtml(c){
  var photos=(c.photos||[]).map(function(p,i){
    var u=thumbUrl(p);
    return '<button type="button" class="shot" data-action="photo" data-cook="'+esc(c.id)+'" data-i="'+i+'" aria-label="Open photo '+(i+1)+'">'+(u?'<img data-img src="'+esc(u)+'" alt="" loading="lazy">':'')+'</button>';
  }).join('');
  return '<article class="cook"><div class="cook-head"><time class="date">'+esc(fmtLong(c.cooked_on))+'</time><button type="button" class="link" data-action="edit-cook" data-id="'+esc(c.id)+'">Edit</button></div>'
    +ratesHtml(c)
    +(c.notes?'<p class="notes">'+esc(c.notes)+'</p>':'')
    +(photos?'<div class="shots">'+photos+'</div>':'')+'</article>';
}
function renderDetail(){
  var m=models().get(S.openId),el=$('#detailView');
  if(!m){if(S.ready)showList();return}
  var r=m.r,src=srcHtml(r);
  var summary=m.cooks.length
    ?(m.avg!=null?'<span class="mini">'+STAR+fmtAvg(m.avg)+' <span class="muted">('+m.rn+')</span></span>':'<span class="muted">Not rated</span>')+'<span>Cooked '+m.cooks.length+(m.cooks.length===1?' time':' times')+'</span><span>Last: '+esc(fmtShort(m.last))+'</span>'
    :'<span class="muted">On the to-try list</span>';
  el.innerHTML='<button type="button" class="back" data-action="back">← All recipes</button>'
    +'<div class="d-head"><p class="kicker">'+esc(r.category||'Recipe')+'</p><h2>'+esc(r.title)+'</h2>'+(src?'<p class="d-source">'+src+'</p>':'')
    +'<div class="d-summary">'+summary+'</div>'
    +'<div class="d-actions"><button type="button" class="primary" data-action="log">'+(m.cooks.length?'Log another cook':'We cooked it')+'</button><button type="button" class="ghost" data-action="edit-recipe">Edit recipe</button></div></div>'
    +(r.tweaks?'<div class="note"><span class="label">Next time</span><p>'+esc(r.tweaks)+'</p></div>':'')
    +'<h3 class="sub">Cooking log</h3>'
    +(m.cooks.length?m.cooks.map(cookHtml).join(''):'<p class="none">Not cooked yet. Log the first one and this page fills in with the date, your ratings and photos.</p>');
}
function showDetail(id){S.scrollY=window.scrollY||0;S.openId=id;$('#listView').hidden=true;$('#detailView').hidden=false;window.scrollTo(0,0);renderDetail()}
function showList(){S.openId=null;$('#detailView').hidden=true;$('#listView').hidden=false;renderList();window.scrollTo(0,S.scrollY||0)}
function render(){
  var p=S.profiles.get(S.me);
  $('#who').textContent='Signed in as '+((p&&p.name)||S.email||'you');
  $('#not-member').hidden=!S.notMember;
  $('#btn-add').hidden=S.notMember;
  renderList();
  if(S.openId)renderDetail();
}

/* ---------- loading and live sync ---------- */
async function fetchAll(table){
  var rows=[],size=1000;
  for(var from=0;;from+=size){
    var r=must(await S.sb.from(table).select('*').range(from,from+size-1));
    rows=rows.concat(r.data||[]);
    if(!r.data||r.data.length<size)break;
  }
  return rows;
}
async function load(){
  if(!S.me)return;
  if(S.loading){S.again=true;return}
  S.loading=true;
  try{
    var res=await Promise.all([fetchAll('recipes'),fetchAll('cooks'),fetchAll('ratings'),fetchAll('profiles')]);
    S.recipes=new Map(res[0].map(function(x){return [x.id,x]}));
    S.cooks=new Map(res[1].map(function(x){return [x.id,x]}));
    var rm=new Map();res[2].forEach(function(x){var o=rm.get(x.cook_id)||{};o[x.user_id]=x.stars;rm.set(x.cook_id,o)});
    S.ratings=rm;
    S.profiles=new Map(res[3].map(function(x){return [x.id,x]}));
    S.notMember=!S.profiles.has(S.me);
    S.loadError='';
    await signThumbs();
    S.ready=true;
  }catch(e){
    S.loadError=errMsg(e);
  }finally{
    S.loading=false;
  }
  render();
  if(S.again){S.again=false;scheduleLoad(0)}
}
function scheduleLoad(ms){clearTimeout(S.loadTimer);S.loadTimer=setTimeout(load,ms==null?400:ms)}
function subscribe(){
  if(S.chan)return;
  S.chan=S.sb.channel('book').on('postgres_changes',{event:'*',schema:'public'},function(){scheduleLoad(400)}).subscribe();
}
function unsubscribe(){
  if(S.chan){try{S.sb.removeChannel(S.chan)}catch(e){}S.chan=null}
}

/* ---------- writes ---------- */
async function setMyRating(cookId,n){
  var o=Object.assign({},S.ratings.get(cookId)||{});
  if(n>0)o[S.me]=n;else delete o[S.me];
  S.ratings.set(cookId,o);render();
  try{
    if(n>0)must(await S.sb.from('ratings').upsert({cook_id:cookId,user_id:S.me,stars:n},{onConflict:'cook_id,user_id'}));
    else must(await S.sb.from('ratings').delete().eq('cook_id',cookId).eq('user_id',S.me));
  }catch(e){toast(errMsg(e));}
  scheduleLoad(300);
}
async function removeFiles(paths){
  var all=[];(paths||[]).forEach(function(p){all.push(p,thumbOf(p))});
  if(!all.length)return;
  try{await S.sb.storage.from(BUCKET).remove(all)}catch(e){}
}
function drawImage(img,max,q){
  var sc=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*sc)),h=Math.max(1,Math.round(img.naturalHeight*sc));
  var cv=document.createElement('canvas');cv.width=w;cv.height=h;
  var ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
  return new Promise(function(res,rej){cv.toBlob(function(b){b?res(b):rej(new Error('Could not decode the photo'))},'image/jpeg',q)});
}
async function makeImages(file){
  var url=URL.createObjectURL(file);
  try{
    var img=await new Promise(function(res,rej){var i=new Image();i.onload=function(){res(i)};i.onerror=function(){rej(new Error('Could not decode the photo'))};i.src=url});
    return {full:await drawImage(img,1600,0.85),thumb:await drawImage(img,480,0.8)};
  } finally{URL.revokeObjectURL(url)}
}
async function insertCook(rid,date,notes,photos,rating){
  var c=must(await S.sb.from('cooks').insert({recipe_id:rid,cooked_on:date,notes:notes,photos:photos}).select().single()).data;
  if(rating>0)must(await S.sb.from('ratings').insert({cook_id:c.id,user_id:S.me,stars:rating}));
  return c;
}

/* ---------- sheet ---------- */
function formErr(msg){var e=$('#form-err');e.textContent=msg||'';e.hidden=!msg}
function setBusy(b){$('#f-save').disabled=b;$('#f-delete').disabled=b;$('#f-save').textContent=b?'Saving…':'Save'}
function drawStarsForm(){
  var o='';for(var i=1;i<=5;i++)o+='<button type="button" class="star'+(i<=F.rating?' on':'')+'" data-action="form-star" data-n="'+i+'" aria-label="'+i+(i>1?' stars':' star')+'" aria-pressed="'+(i<=F.rating)+'">'+STAR+'</button>';
  $('#f-stars').innerHTML='<span class="stars" role="group" aria-label="Your rating">'+o+'</span>';
}
function drawThumbs(){
  $('#f-thumbs').innerHTML=F.photos.map(function(p,i){
    var u=p.file?p.url:thumbUrl(p.path);
    return '<div class="thumb">'+(u?'<img data-img src="'+esc(u)+'" alt="">':'')+'<button type="button" data-action="rm-photo" data-i="'+i+'" aria-label="Remove photo">×</button></div>';
  }).join('');
}
function layoutSheet(){
  var m=F.mode,isRecipe=m==='recipe-new'||m==='recipe-edit',hasCook=m==='cook-new'||m==='cook-edit'||(m==='recipe-new'&&F.status==='cooked');
  $('#status-row').hidden=m!=='recipe-new';
  $('#recipe-fields').hidden=!(isRecipe||m==='cook-edit');
  $('#cook-fields').hidden=!hasCook;
  $('#f-delete').hidden=!(m==='recipe-edit'||m==='cook-edit');
  $('#f-delete').textContent=m==='recipe-edit'?'Delete recipe':'Delete cook';
  document.querySelectorAll('#status-row button').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.v===F.status))});
}
function fillSource(){var t=$('#f-stype').value;$('#f-source').placeholder=SRC_HINT[t]||''}
function openSheet(mode,ids){
  ids=ids||{};
  F.mode=mode;F.rid=ids.rid||null;F.cid=ids.cid||null;F.rating=0;F.origRating=0;F.photos=[];F.removed=[];F.busy=false;F.armed=false;
  F.opener=document.activeElement;formErr('');setBusy(false);
  var m=F.rid?models().get(F.rid):null,r=m?m.r:null,c=F.cid?S.cooks.get(F.cid):null;
  F.status=S.tab==='try'?'try':'cooked';
  $('#f-title').value=r?r.title||'':'';
  $('#f-cat').value=r&&r.category||'Main';
  $('#f-stype').value=r&&r.source_type||'Online';
  $('#f-source').value=r?r.source||'':'';
  $('#f-tweaks').value=r?r.tweaks||'':'';
  $('#f-date').value=c&&c.cooked_on||today();
  $('#f-notes').value=c?c.notes||'':'';
  if(c){F.photos=(c.photos||[]).map(function(p){return {path:p}});F.rating=((S.ratings.get(c.id)||{})[S.me])||0;F.origRating=F.rating}
  var titles={'recipe-new':'Add a recipe','recipe-edit':'Edit recipe','cook-new':'Log a cook','cook-edit':'Edit cook'};
  $('#sheet-title').textContent=titles[mode];
  var sub=$('#sheet-sub');sub.hidden=!(mode==='cook-new'&&r);sub.textContent=r?r.title:'';
  fillSource();drawStarsForm();drawThumbs();layoutSheet();
  $('#sheet').hidden=false;syncLock();
  (mode.indexOf('recipe')===0?$('#f-title'):$('#f-date')).focus();
}
function closeSheet(){
  F.photos.forEach(function(p){if(p.url)URL.revokeObjectURL(p.url)});
  $('#sheet').hidden=true;syncLock();clearTimeout(F.timer);
  if(F.opener&&F.opener.focus&&document.contains(F.opener))try{F.opener.focus()}catch(e){}
}
async function saveForm(e){
  e.preventDefault();if(F.busy)return;
  var mode=F.mode,isRecipe=mode.indexOf('recipe')===0;
  var hasCook=mode==='cook-new'||mode==='cook-edit'||(mode==='recipe-new'&&F.status==='cooked');
  var title=$('#f-title').value.trim(),date=$('#f-date').value;
  if((isRecipe||mode==='cook-edit')&&!title){formErr('Give the recipe a name.');$('#f-title').focus();return}
  if(hasCook&&!date){formErr('Pick the date you cooked it.');$('#f-date').focus();return}
  F.busy=true;setBusy(true);formErr('');
  var uploaded=[];
  try{
    var paths=[];
    if(hasCook){
      for(var i=0;i<F.photos.length;i++){
        var p=F.photos[i];
        if(!p.path){
          var imgs=await makeImages(p.file);
          var base=S.me+'/'+uuid();
          must(await S.sb.storage.from(BUCKET).upload(base+'.jpg',imgs.full,{contentType:'image/jpeg',upsert:false}));
          uploaded.push(base+'.jpg');
          must(await S.sb.storage.from(BUCKET).upload(base+'_t.jpg',imgs.thumb,{contentType:'image/jpeg',upsert:false}));
          uploaded.push(base+'_t.jpg');
          p.path=base+'.jpg';
        }
        paths.push(p.path);
      }
    }
    var notes=$('#f-notes').value.trim();
    var rdata={title:title,category:$('#f-cat').value,source_type:$('#f-stype').value,source:$('#f-source').value.trim(),tweaks:$('#f-tweaks').value.trim()};
    if(mode==='recipe-new'){
      if(!F.rid){F.rid=must(await S.sb.from('recipes').insert(rdata).select().single()).data.id}
      if(hasCook)await insertCook(F.rid,date,notes,paths,F.rating);
      S.tab=hasCook?'cooked':'try';
    } else if(mode==='recipe-edit'){
      must(await S.sb.from('recipes').update(rdata).eq('id',F.rid));
    } else if(mode==='cook-new'){
      await insertCook(F.rid,date,notes,paths,F.rating);
    } else if(mode==='cook-edit'){
      must(await S.sb.from('recipes').update(rdata).eq('id',F.rid));
      must(await S.sb.from('cooks').update({cooked_on:date,notes:notes,photos:paths}).eq('id',F.cid));
      if(F.rating!==F.origRating){
        if(F.rating>0)must(await S.sb.from('ratings').upsert({cook_id:F.cid,user_id:S.me,stars:F.rating},{onConflict:'cook_id,user_id'}));
        else must(await S.sb.from('ratings').delete().eq('cook_id',F.cid).eq('user_id',S.me));
      }
      await removeFiles(F.removed);
    }
    closeSheet();toast('Saved');
    await load();
  }catch(err){
    if(uploaded.length){try{await S.sb.storage.from(BUCKET).remove(uploaded)}catch(x){}F.photos.forEach(function(p){if(p.file)delete p.path})}
    formErr(errMsg(err));
  }
  finally{F.busy=false;setBusy(false)}
}
async function doDelete(){
  F.busy=true;setBusy(true);formErr('');
  try{
    if(F.mode==='cook-edit'){
      var c=S.cooks.get(F.cid);
      must(await S.sb.from('cooks').delete().eq('id',F.cid));
      await removeFiles(c&&c.photos);
    } else if(F.mode==='recipe-edit'){
      var m=models().get(F.rid),files=[];
      (m?m.cooks:[]).forEach(function(c){files=files.concat(c.photos||[])});
      must(await S.sb.from('recipes').delete().eq('id',F.rid));
      await removeFiles(files);
      if(S.openId===F.rid)showList();
    }
    closeSheet();toast('Deleted');
    await load();
  }catch(err){formErr(errMsg(err))}
  finally{F.busy=false;setBusy(false)}
}

/* ---------- account ---------- */
function openAccount(){
  var p=S.profiles.get(S.me);
  $('#acc-name').value=(p&&p.name)||'';
  $('#account-email').textContent=S.email||'';
  $('#account-err').hidden=true;
  $('#account').hidden=false;syncLock();$('#acc-name').focus();
}
function closeAccount(){$('#account').hidden=true;syncLock()}
async function saveName(e){
  e.preventDefault();
  var name=$('#acc-name').value.trim();
  if(!name){var er=$('#account-err');er.textContent='Enter a name.';er.hidden=false;return}
  try{
    must(await S.sb.from('profiles').update({name:name}).eq('id',S.me));
    var p=Object.assign({},S.profiles.get(S.me)||{id:S.me},{name:name});S.profiles.set(S.me,p);
    closeAccount();toast('Name saved');render();
  }catch(err){var e2=$('#account-err');e2.textContent=errMsg(err);e2.hidden=false}
}

/* ---------- lightbox ---------- */
function drawLb(){
  var p=L.paths[L.i],tok=++L.token,img=$('#lb-img');
  var first=thumbUrl(p);
  if(first)img.src=first;else img.removeAttribute('src');
  $('#lb-count').textContent=(L.i+1)+' / '+L.paths.length;
  $('#lb-prev').hidden=$('#lb-next').hidden=L.paths.length<2;
  if(S.urls.has(p)){img.src=S.urls.get(p);return}
  signPaths([p],3600).then(function(r){
    if(r[0])S.urls.set(r[0][0],r[0][1]);
    if(tok===L.token&&S.urls.has(p))img.src=S.urls.get(p);
  }).catch(function(){});
}
function openLb(paths,i){L.paths=paths;L.i=i;L.opener=document.activeElement;$('#lb').hidden=false;syncLock();drawLb();$('#lb-close').focus()}
function closeLb(){$('#lb').hidden=true;$('#lb-img').removeAttribute('src');L.token++;syncLock();if(L.opener&&L.opener.focus)try{L.opener.focus()}catch(e){}}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-action]');if(!el)return;
  var a=el.dataset.action,d=el.dataset;
  if(a==='tab'){S.tab=d.v;renderList()}
  else if(a==='cat'){S.cat=d.v;renderList()}
  else if(a==='open')showDetail(d.id);
  else if(a==='back')showList();
  else if(a==='retry'){S.loadError='';renderList();load()}
  else if(a==='add')openSheet('recipe-new');
  else if(a==='log')openSheet('cook-new',{rid:S.openId});
  else if(a==='edit-recipe')openSheet('recipe-edit',{rid:S.openId});
  else if(a==='edit-cook')openSheet('cook-edit',{rid:S.openId,cid:d.id});
  else if(a==='rate'){
    var cur=((S.ratings.get(d.cook)||{})[S.me])||0,n=+d.n;
    setMyRating(d.cook,cur===n?0:n);
  }
  else if(a==='photo'){var ck=S.cooks.get(d.cook);if(ck)openLb(ck.photos||[],+d.i)}
  else if(a==='close-sheet')closeSheet();
  else if(a==='status'){F.status=d.v;layoutSheet()}
  else if(a==='form-star'){var n2=+d.n;F.rating=F.rating===n2?0:n2;drawStarsForm()}
  else if(a==='pick-photos')$('#f-photos').click();
  else if(a==='rm-photo'){var p=F.photos.splice(+d.i,1)[0];if(p){if(p.path)F.removed.push(p.path);if(p.url)URL.revokeObjectURL(p.url)}drawThumbs()}
  else if(a==='delete'){
    if(!F.armed){F.armed=true;el.textContent='Tap again to delete';clearTimeout(F.timer);F.timer=setTimeout(function(){F.armed=false;el.textContent=F.mode==='recipe-edit'?'Delete recipe':'Delete cook'},4000)}
    else doDelete();
  }
  else if(a==='account')openAccount();
  else if(a==='close-account')closeAccount();
  else if(a==='signout'){closeAccount();S.sb.auth.signOut()}
  else if(a==='lb-close')closeLb();
  else if(a==='lb-prev'){L.i=(L.i+L.paths.length-1)%L.paths.length;drawLb()}
  else if(a==='lb-next'){L.i=(L.i+1)%L.paths.length;drawLb()}
});
document.addEventListener('error',function(e){var t=e.target;if(t&&t.tagName==='IMG'&&t.hasAttribute('data-img'))t.classList.add('broken')},true);
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){if(!$('#lb').hidden)closeLb();else if(!$('#sheet').hidden)closeSheet();else if(!$('#account').hidden)closeAccount()}
  else if(!$('#lb').hidden&&L.paths.length>1){
    if(e.key==='ArrowLeft'){L.i=(L.i+L.paths.length-1)%L.paths.length;drawLb()}
    else if(e.key==='ArrowRight'){L.i=(L.i+1)%L.paths.length;drawLb()}
  }
});
document.addEventListener('visibilitychange',function(){if(!document.hidden&&S.me&&S.ready)scheduleLoad(0)});
window.addEventListener('online',function(){if(S.me)scheduleLoad(0)});
$('#sheet').addEventListener('click',function(e){if(e.target===e.currentTarget)closeSheet()});
$('#account').addEventListener('click',function(e){if(e.target===e.currentTarget)closeAccount()});
$('#form').addEventListener('submit',saveForm);
$('#account-form').addEventListener('submit',saveName);
$('#f-stype').addEventListener('change',fillSource);
$('#f-photos').addEventListener('change',function(e){
  Array.from(e.target.files||[]).forEach(function(f){F.photos.push({file:f,url:URL.createObjectURL(f)})});
  e.target.value='';drawThumbs();
});
$('#q').addEventListener('input',function(e){S.q=e.target.value;renderList()});
$('#sort').addEventListener('change',function(e){S.sort=e.target.value;renderList()});
$('#f-cat').innerHTML=CATS.map(function(c){return '<option>'+esc(c)+'</option>'}).join('');
$('#f-stype').innerHTML=SOURCES.map(function(c){return '<option>'+esc(c)+'</option>'}).join('');

$('#auth-form').addEventListener('submit',async function(e){
  e.preventDefault();
  var email=$('#a-email').value.trim(),pass=$('#a-pass').value,err=$('#auth-err'),btn=$('#auth-btn');
  err.hidden=true;
  if(!email||!pass){err.textContent='Enter your email and password.';err.hidden=false;return}
  btn.disabled=true;btn.textContent='Signing in…';
  try{
    var r=await S.sb.auth.signInWithPassword({email:email,password:pass});
    if(r.error)throw r.error;
  }catch(x){
    var m=String(x&&x.message||'').toLowerCase();
    err.textContent=m.indexOf('invalid')>=0?'That email and password don\'t match.':(m.indexOf('fetch')>=0||m.indexOf('network')>=0?"Couldn't reach the book. Check your connection and try again.":'Sign in failed. Try again in a moment.');
    err.hidden=false;
  }finally{btn.disabled=false;btn.textContent='Sign in'}
});

/* ---------- session ---------- */
function handleSession(session){
  if(session&&session.user){
    if(S.me===session.user.id)return;
    S.me=session.user.id;S.email=session.user.email||'';
    S.ready=false;S.loadError='';S.notMember=false;
    $('#a-pass').value='';
    screen('app');render();
    subscribe();load();
  } else {
    S.me=null;S.email='';S.ready=false;S.openId=null;
    S.recipes=new Map();S.cooks=new Map();S.ratings=new Map();S.profiles=new Map();S.urls=new Map();
    unsubscribe();
    $('#detailView').hidden=true;$('#listView').hidden=false;
    screen('auth');
  }
}
function start(){
  var cfg=window.TFT_CONFIG||{};
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_KEY||/PASTE_/.test(cfg.SUPABASE_URL+cfg.SUPABASE_KEY)||!window.supabase){screen('setup');return}
  S.sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  S.sb.auth.onAuthStateChange(function(event,session){
    /* run outside the auth callback so Supabase calls inside it can't deadlock */
    setTimeout(function(){handleSession(session)},0);
  });
}
start();
})();
