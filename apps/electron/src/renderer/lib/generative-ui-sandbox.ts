export const GENERATIVE_UI_CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'esm.sh',
] as const

export const GENERATIVE_UI_IFRAME_SANDBOX = 'allow-scripts'

const DANGEROUS_CONTAINER_TAGS = [
  'iframe',
  'object',
  'embed',
  'meta',
  'link',
  'base',
  'form',
  'frame',
  'frameset',
  'portal',
]

const DANGEROUS_CONTAINER_RE = new RegExp(`<(${DANGEROUS_CONTAINER_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi')
const DANGEROUS_VOID_RE = new RegExp(`<(${DANGEROUS_CONTAINER_TAGS.join('|')})\\b[^>]*\\/?>`, 'gi')

function stripDangerousContainers(html: string): string {
  return html.replace(DANGEROUS_CONTAINER_RE, '').replace(DANGEROUS_VOID_RE, '')
}

function stripEventHandlers(html: string): string {
  return html.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*)/gi, '')
}

function stripDangerousUrls(html: string): string {
  return html.replace(
    /\s+(href|src|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']*))/gi,
    (match, _attr: string, dq?: string, sq?: string, uq?: string) => {
      const value = (dq ?? sq ?? uq ?? '').trim()
      if (/^(javascript|data|vbscript|file)\s*:/i.test(value)) return ''
      return match
    },
  )
}

function stripStyleJavascriptUrls(html: string): string {
  return html.replace(/url\(\s*(['"]?)\s*(javascript|data|vbscript|file)\s*:[^)]+\)/gi, 'url()')
}

function stripScripts(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
}

function stripUnclosedScript(html: string): string {
  const lower = html.toLowerCase()
  const start = lower.lastIndexOf('<script')
  if (start === -1) return html
  const end = lower.indexOf('</script>', start)
  return end === -1 ? html.slice(0, start) : html
}

function isAllowedCdnScript(src: string): boolean {
  try {
    const url = new URL(src)
    return url.protocol === 'https:' && GENERATIVE_UI_CDN_HOSTS.includes(url.hostname as typeof GENERATIVE_UI_CDN_HOSTS[number])
  } catch {
    return false
  }
}

function stripDisallowedScriptSources(html: string): string {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs: string) => {
    const srcMatch = attrs.match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']*))/i)
    if (!srcMatch) return match
    const src = (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '').trim()
    return isAllowedCdnScript(src) ? match : ''
  })
}

export function sanitizeGenerativeWidgetForStreaming(html: string): string {
  return stripStyleJavascriptUrls(
    stripDangerousUrls(
      stripScripts(
        stripEventHandlers(
          stripDangerousContainers(stripUnclosedScript(html)),
        ),
      ),
    ),
  )
}

export function sanitizeGenerativeWidgetForIframe(html: string): string {
  return stripStyleJavascriptUrls(
    stripDangerousUrls(
      stripEventHandlers(
        stripDisallowedScriptSources(
          stripDangerousContainers(html),
        ),
      ),
    ),
  )
}

export function buildGenerativeWidgetSrcdoc(styleBlock = '', isDark = false): string {
  const scriptHosts = GENERATIVE_UI_CDN_HOSTS.map((host) => `https://${host}`).join(' ')
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${scriptHosts}`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')

  const receiverScript = `(function(){
var root=document.getElementById('__root');
var lastHeight=0;
var first=true;
var timer=null;
function reportRuntimeError(reason){
var message='Widget runtime error';
if(typeof reason==='string')message=reason;
else if(reason&&typeof reason.message==='string')message=reason.message;
try{parent.postMessage({type:'widget:error',message:String(message).slice(0,500)},'*');}catch(_err){}
}
function postHeight(){
if(timer)clearTimeout(timer);
timer=setTimeout(function(){
var rect=root.getBoundingClientRect();
var height=Math.ceil(Math.max(rect.height, document.body.scrollHeight, document.documentElement.scrollHeight));
if(height>0&&height!==lastHeight){lastHeight=height;parent.postMessage({type:'widget:resize',height:height,first:first},'*');}
first=false;
},60);
}
function applyHtml(html){
root.innerHTML=html||'';
postHeight();
}
function finalizeHtml(html){
var tmp=document.createElement('div');
tmp.innerHTML=html||'';
var nodes=tmp.querySelectorAll('script');
var scripts=[];
for(var i=0;i<nodes.length;i++){
var node=nodes[i];
scripts.push({src:node.getAttribute('src')||'',text:node.textContent||'',attrs:Array.prototype.slice.call(node.attributes).map(function(a){return{name:a.name,value:a.value};})});
node.remove();
}
var visual=tmp.innerHTML;
if(root.innerHTML!==visual)root.innerHTML=visual;
var cdn=scripts.filter(function(s){return !!s.src});
var inline=scripts.filter(function(s){return !s.src&&s.text});
function runInline(){
for(var k=0;k<inline.length;k++){
var el=document.createElement('script');
for(var j=0;j<inline[k].attrs.length;j++){if(inline[k].attrs[j].name!=='src')el.setAttribute(inline[k].attrs[j].name,inline[k].attrs[j].value);}
el.textContent=inline[k].text;
root.appendChild(el);
}
postHeight();
setTimeout(function(){parent.postMessage({type:'widget:scriptsReady'},'*');postHeight();},50);
}
if(cdn.length===0){runInline();return;}
var pending=cdn.length;
function done(){pending-=1;if(pending<=0)runInline();}
for(var c=0;c<cdn.length;c++){
var s=document.createElement('script');
s.src=cdn[c].src;
s.onload=done;
s.onerror=done;
for(var a=0;a<cdn[c].attrs.length;a++){var attr=cdn[c].attrs[a];if(attr.name!=='src'&&attr.name!=='onload'&&attr.name!=='onerror')s.setAttribute(attr.name,attr.value);}
root.appendChild(s);
}
}
window.addEventListener('message',function(event){
if(!event.data||typeof event.data.type!=='string')return;
if(event.data.type==='widget:update')applyHtml(event.data.html);
if(event.data.type==='widget:finalize')finalizeHtml(event.data.html);
if(event.data.type==='widget:theme'&&event.data.vars){
var r=document.documentElement;
Object.keys(event.data.vars).forEach(function(k){r.style.setProperty(k,event.data.vars[k]);});
if(typeof event.data.isDark==='boolean')r.className=event.data.isDark?'dark':'';
postHeight();
}
});
window.addEventListener('error',function(event){reportRuntimeError(event.error||event.message);});
window.addEventListener('unhandledrejection',function(event){reportRuntimeError(event.reason);});
document.addEventListener('click',function(event){
var target=event.target;
var link=target&&target.closest?target.closest('a[href]'):null;
if(!link)return;
var href=link.getAttribute('href')||'';
if(!href||href.charAt(0)==='#')return;
event.preventDefault();
parent.postMessage({type:'widget:link',href:href},'*');
});
window.__widgetSendMessage=function(text){
if(typeof text==='string'&&text.length<=500)parent.postMessage({type:'widget:sendMessage',text:text},'*');
};
new ResizeObserver(postHeight).observe(root);
parent.postMessage({type:'widget:ready'},'*');
})();`

  return `<!DOCTYPE html>
<html class="${isDark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
html,body{margin:0;padding:0;background:transparent;color:CanvasText;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
*,*::before,*::after{box-sizing:border-box;}
:root{
color-scheme:light dark;
--widget-bg:transparent;
--widget-fg:CanvasText;
--widget-muted:#737373;
--widget-border:rgba(127,127,127,.25);
--widget-accent:#2563eb;
--color-background-primary:var(--card,#fff);
--color-background-secondary:var(--muted,#f5f4ef);
--color-background-tertiary:var(--background,#faf9f5);
--color-text-primary:var(--foreground,#1f2937);
--color-text-secondary:var(--muted-foreground,#6b7280);
--color-text-tertiary:color-mix(in srgb,var(--muted-foreground,#6b7280) 72%,transparent);
--color-border-tertiary:var(--border,rgba(31,41,55,.16));
--color-border-secondary:color-mix(in srgb,var(--border,rgba(31,41,55,.16)) 70%,var(--foreground,#1f2937));
--font-sans:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
--font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
--border-radius-md:8px;
--border-radius-lg:12px;
--border-radius-xl:16px;
}
${styleBlock}
#__root{width:100%;min-height:1px;overflow:hidden;}
a{color:var(--widget-accent);}
</style>
</head>
<body>
<div id="__root"></div>
<script>${receiverScript}</script>
</body>
</html>`
}
