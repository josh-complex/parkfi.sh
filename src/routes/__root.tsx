import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { ThemeProvider } from "next-themes";

import PostHogProvider from "../integrations/posthog/provider";

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";

import appCss from "../styles.css?url";

import type { QueryClient } from "@tanstack/react-query";

import type { TRPCRouter } from "#/integrations/trpc/router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { TooltipProvider } from "#/components/ui/tooltip";
import { FaviconSync } from "#/components/favicon-sync.tsx";
import { PWARegister } from "#/components/pwa-register";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { seo, websiteJsonLd } from "#/lib/seo.ts";

interface MyRouterContext {
  queryClient: QueryClient;

  trpc: TRPCOptionsProxy<TRPCRouter>;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => {
    const base = seo({
      title: "ParkFi — Live Theme Park Wait Times, Ticket Prices & Dining",
      description:
        "Track real-time wait times, Lightning Lane availability, ticket pricing, and dining reservations across Walt Disney World and Universal Orlando — all on one live park map.",
      keywords:
        "theme park wait times, Disney World wait times, Universal Orlando wait times, Lightning Lane availability, theme park ticket prices, dining reservations, live park map",
      // No `path` here: each route owns its own canonical. TanStack merges/dedupes
      // meta by name but NOT <link> tags, so a canonical set here would be emitted
      // on every page *in addition* to the route's own — telling Google every deep
      // page is a duplicate of "/". The homepage canonical comes from _dash/index.
    });
    return {
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        { name: "theme-color", content: "#1c468e" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
        { name: "apple-mobile-web-app-title", content: "ParkFi" },
        { name: "robots", content: "index, follow" },
        ...base.meta,
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/manifest.json" },
        // iOS home-screen icon: Safari doesn't reliably decode webp for
        // apple-touch-icon, so point at the brand PNG.
        { rel: "apple-touch-icon", href: "/img/brand/full_white.png" },
        // Tab favicon. The SVG carries a prefers-color-scheme media query so the
        // mark flips to white on dark tab bars (and stays brand blue on light) —
        // honored by SVG-favicon browsers (Chrome/Edge/Firefox/Safari 16+). The
        // webp/PNG are raster fallbacks for browsers without SVG-favicon support.
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", type: "image/webp", href: "/img/brand/blue.webp" },
        { rel: "icon", type: "image/png", href: "/img/brand/blue.png" },
        ...base.links,
      ],
    };
  },
  shellComponent: RootDocument,
});

// TEMP hydration diagnostic v2 — remove once the prod `removeChild` crash is
// pinned down. Captures, ~6s after load: (1) SSR text nodes the client removed
// or changed; (2) the first uncaught error (message + top stack frames);
// (3) any removeChild/insertBefore call whose child.parentNode !== the parent
// it's being removed from / inserted into (the DOM-corruption that precedes the
// null-parent crash), with a stack; (4) React's console.error hydration
// warnings; (5) whether the singleton map `host` was reparented out of its
// off-screen parking div, and when — to test the map-stage reparent theory.
// Results also on window.__HYDR2__.
const HYDRATION_PROBE = `(function(){try{
  var T0=(window.performance&&performance.now)?performance.now():0;
  function ms(){return Math.round(((window.performance&&performance.now)?performance.now():0)-T0);}
  function desc(el){if(!el)return 'null';if(el.nodeType===3)return '#text:'+String(el.nodeValue).slice(0,30);if(el.nodeType!==1)return 'node('+el.nodeType+')';return el.tagName+(el.id?'#'+el.id:'')+'.'+String(el.getAttribute&&el.getAttribute('class')||'').slice(0,46);}

  // (1) snapshot SSR text nodes
  var snap=[];var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);var n;
  while(n=w.nextNode()){var t=n.nodeValue;if(t&&t.trim()){var pe=n.parentElement;snap.push([n,t,pe?desc(pe):'']);}}

  // locate the map host (child of the aria-hidden, size-0 parking div)
  var park=null,host=null;
  try{var hid=document.querySelectorAll('div[aria-hidden="true"]');for(var i=0;i<hid.length;i++){var c=getComputedStyle(hid[i]);if((hid[i].className||'').indexOf('size-0')>=0||(c.width==='0px'&&c.position==='fixed')){park=hid[i];host=hid[i].firstElementChild;break;}}}catch(e){}
  var hostMoves=[];

  // (4) console.error
  var cerrs=[];var ce=console.error;console.error=function(){try{cerrs.push({at:ms(),m:Array.from(arguments).map(function(a){return (a&&a.message)||String(a)}).join(' | ').slice(0,300)})}catch(e){}return ce.apply(console,arguments)};

  // (2) uncaught errors
  var thrown=[];window.addEventListener('error',function(ev){try{thrown.push({at:ms(),msg:String(ev.message),stack:String((ev.error&&ev.error.stack)||'').split('\\n').slice(0,5).join(' << ')})}catch(e){}},true);

  // (3) patch removeChild/insertBefore for parent/child mismatches
  var domErrs=[];
  ['removeChild','insertBefore'].forEach(function(fn){var orig=Node.prototype[fn];Node.prototype[fn]=function(child){try{if(child&&child.nodeType===1&&child.parentNode!==this){domErrs.push({at:ms(),op:fn,parent:desc(this),child:desc(child),childRealParent:desc(child&&child.parentNode),stack:String(new Error().stack||'').split('\\n').slice(2,6).join(' << ')});}}catch(e){}return orig.apply(this,arguments);};});

  // (5) watch the map host move
  if(host){try{var mo=new MutationObserver(function(muts){muts.forEach(function(m){if(m.type==='childList'){for(var k=0;k<m.removedNodes.length;k++){if(m.removedNodes[k]===host)hostMoves.push({at:ms(),ev:'removed-from',parent:desc(m.target)});}for(var j=0;j<m.addedNodes.length;j++){if(m.addedNodes[j]===host)hostMoves.push({at:ms(),ev:'added-to',parent:desc(m.target)});}}});});mo.observe(document.body,{childList:true,subtree:true});}catch(e){}}

  setTimeout(function(){
    var removed=[],changed=[];
    for(var i2=0;i2<snap.length;i2++){var node=snap[i2][0],was=snap[i2][1],where=snap[i2][2];
      if(!node.isConnected){removed.push({server:was,where:where});}
      else if(node.nodeValue!==was){changed.push({server:was,client:node.nodeValue,where:where});}}
    var out={removedCount:removed.length,changedCount:changed.length,removed:removed.slice(0,20),
      thrown:thrown.slice(0,8),domErrs:domErrs.slice(0,15),consoleErrs:cerrs.slice(0,8),
      mapHostFound:!!host,hostConnected:host?host.isConnected:null,hostParentNow:host?desc(host.parentNode):null,hostMoves:hostMoves.slice(0,10)};
    window.__HYDR2__=out;console.log('[HYDR2]'+JSON.stringify(out));
  },6000);
}catch(e){console.log('[HYDR2-ERR]'+e)}})();`;

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <JsonLd data={websiteJsonLd()} />
        <PostHogProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem={false}
            disableTransitionOnChange
          >
            <FaviconSync />
            <TooltipProvider>
              {children}
              <TanStackDevtools
                config={{
                  position: "bottom-right",
                }}
                plugins={[
                  {
                    name: "Tanstack Router",
                    render: <TanStackRouterDevtoolsPanel />,
                  },
                  TanStackQueryDevtools,
                ]}
              />
            </TooltipProvider>
          </ThemeProvider>
        </PostHogProvider>
        <PWARegister />
        <Scripts />
        {/* TEMP hydration diagnostic v2 — remove once the prod crash is found. */}
        <script dangerouslySetInnerHTML={{ __html: HYDRATION_PROBE }} />
      </body>
    </html>
  );
}
