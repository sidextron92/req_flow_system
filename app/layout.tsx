import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Req Flow",
  description: "Capture and manage your requirements",
  manifest: "/api/manifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Req Flow",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#10B24B",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Capture beforeinstallprompt before React mounts so the prompt isn't lost */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__installPrompt=e;});
if('serviceWorker' in navigator){
  navigator.serviceWorker.ready.then(function(reg){
    reg.addEventListener('updatefound',function(){
      var newWorker=reg.installing;
      newWorker.addEventListener('statechange',function(){
        if(newWorker.state==='installed'&&navigator.serviceWorker.controller){
          // New SW installed and waiting — force activate immediately
          newWorker.postMessage({type:'SKIP_WAITING'});
        }
      });
    });
  });
  // When new SW takes control, reload to ensure fresh push handler is active
  var refreshing=false;
  navigator.serviceWorker.addEventListener('controllerchange',function(){
    if(!refreshing){refreshing=true;window.location.reload();}
  });
}
            `,
          }}
        />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
