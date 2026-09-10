const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const assert=require('node:assert/strict');
const base=process.env.TEST_BASE_URL||'http://localhost:5738';
let cookie='';
async function api(path,method='GET',body){const res=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-Requested-With':'astracode',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];assert.ok(res.ok,`${method} ${path}: ${res.status} ${await (!res.ok?res.text():'')}`);return res.status===204?null:res.json();}
class LocalResources extends ResourceLoader{fetch(url,options){return url.startsWith(base)?super.fetch(url,options):null;}}
async function until(fn,label){const start=Date.now();while(Date.now()-start<20000){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout: '+label);}
async function page(width,mode=''){
 const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(e.type==='unhandled exception')errors.push(e.message);});
 const dom=await JSDOM.fromURL(base+'/'+mode,{runScripts:'dangerously',resources:new LocalResources(),pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
   Object.defineProperty(w,'innerWidth',{value:width});Object.defineProperty(w,'innerHeight',{value:844});
   w.matchMedia=q=>({matches:/min-width:\s*768px/.test(q)?width>=768:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
   w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
   w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollBy=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};
   w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};
   w.fetch=(path,opts={})=>fetch(new URL(path,base),{...opts,headers:{...opts.headers,Cookie:cookie}});
   w.localStorage.setItem('idecode.seen','true');w.confirm=()=>true;
 }});
 await until(()=>dom.window.document.querySelector('.engine-auth,.shell'), 'React render');assert.deepEqual(errors,[]);return {dom,errors,doc:dom.window.document};
}
function click(dom,node){assert.ok(node,'click target exists');node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));}
function input(dom,node,value){const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set;setter.call(node,value);node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
(async()=>{
 let fixture;
 try{
   const auth=await page(390);await until(()=>auth.doc.querySelector('#engine-email'),'login screen');await until(()=>auth.doc.querySelector('#engine-name'),'name field');assert.match(auth.doc.body.textContent,/Войти/);assert.equal(auth.doc.querySelectorAll('input[type="password"]').length,0,'passwordless login screen');assert.deepEqual(auth.errors,[]);auth.dom.window.close();console.log('PASS unauthenticated login screen');
   await api('/auth/login','POST',{email:'dom-'+Date.now()+'@example.test',name:'DOM tester'});
   fixture=await api('/projects','POST',{name:'DOM fixture',desc:'UI test',theme:'Tests',tags:[],tint:'#8fb0ff',files:[{path:'README.md',code:'# DOM persisted\n\n[unsafe](javascript:alert)\n\n[docs](https://go.dev)\n'}]});
   await api('/projects/'+fixture.id+'/snapshots','POST',{message:'DOM snapshot',paths:['README.md']});
   for(const width of [390,1280]){
     const {dom,doc,errors}=await page(width);await until(()=>doc.querySelector('.proj-card'),'projects loaded');assert.match(doc.body.textContent,/DOM fixture/);assert.equal(Boolean(doc.querySelector('.rail')),width>=768);assert.equal(Boolean(doc.querySelector('.bottom-nav')),width<768);
     click(dom,Array.from(doc.querySelectorAll('.proj-card')).find(el=>el.textContent.includes('DOM fixture')));
     await until(()=>doc.querySelector('.tab-pane.is-active').textContent.includes('DOM persisted'),'editor opened');
     assert.equal(doc.querySelectorAll('a[href^="javascript:"]').length,0,'unsafe markdown URL');
     assert.ok(doc.querySelector('a[href="https://go.dev"]'),'valid markdown link retained');
     if(width>=768){click(dom,doc.querySelector('.rail-item[title="История"]'));await until(()=>doc.querySelector('.hist-graph'),'snapshot history');assert.match(doc.body.textContent,/DOM snapshot/);}
     assert.deepEqual(errors,[]);dom.window.close();console.log(`PASS authenticated project/editor DOM at width ${width}`);
   }
   const demo=await page(390,'?mode=demo');assert.match(demo.doc.body.textContent,/ДЕМО/);assert.ok(demo.doc.querySelectorAll('.proj-card').length>=9);assert.deepEqual(demo.errors,[]);demo.dom.window.close();console.log('PASS explicit demo mode');
   console.log('DOM checks simulate responsive branches; they do not test browser layout, touch keyboard or physical Android.');
 }finally{if(fixture)await api('/projects/'+fixture.id,'DELETE');if(cookie)await api('/auth/logout','POST');}
})().catch(e=>{console.error(e);process.exitCode=1;});
