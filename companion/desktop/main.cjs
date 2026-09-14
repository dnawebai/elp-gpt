const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, Notification, clipboard } = require('electron');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { createAgent } = require('./agent.cjs');
const { createWakeWord } = require('./wake-word.cjs');

let win; let tray; let agent; let wakeWord;
function createWindow(){
  win=new BrowserWindow({width:560,height:650,minWidth:480,minHeight:520,show:false,title:'ELP Companion',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.removeMenu(); win.loadFile('renderer.html');
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//i.test(url))void shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file:')){event.preventDefault();if(/^https:\/\//i.test(url))void shell.openExternal(url);}});
  win.on('close',(event)=>{if(!app.isQuitting){event.preventDefault();win.hide();}});
}
function setupAgent(){agent=createAgent({baseUrl:process.env.ELP_DEVICE_SERVER_URL||'https://elpgpt.com',statePath:path.join(app.getPath('userData'),'companion.json'),adapters:{notify:(title,body)=>new Notification({title,body}).show(),clipboardRead:()=>clipboard.readText(),clipboardWrite:(value)=>clipboard.writeText(value),openExternal:(url)=>shell.openExternal(url)}});agent.start(Number(process.env.ELP_DEVICE_POLL_MS||15000));}
function setupWakeWord(){wakeWord=createWakeWord({onWake:async()=>{win?.show();win?.focus();await shell.openExternal(`${process.env.ELP_DEVICE_SERVER_URL||'https://elpgpt.com'}/?voice=1&source=wake-word`);}});void wakeWord.start().then((state)=>{if(!state.active&&state.reason)console.log(`ELP wake word inactive: ${state.reason}`);});}
function setupUpdater(){if(!app.isPackaged)return;autoUpdater.autoDownload=true;autoUpdater.autoInstallOnAppQuit=true;autoUpdater.on('error',(error)=>console.error('ELP updater failed',error));void autoUpdater.checkForUpdatesAndNotify().catch((error)=>console.error('ELP update check failed',error));}
function setupTray(){tray=new Tray(nativeImage.createEmpty());tray.setToolTip('ELP Companion');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open ELP Companion',click:()=>win.show()},{label:'Open ELP',click:()=>void shell.openExternal('https://elpgpt.com')},{label:'Check for updates',click:()=>void autoUpdater.checkForUpdatesAndNotify().catch(()=>undefined)},{type:'separator'},{label:'Quit',click:()=>{app.isQuitting=true;app.quit();}}]));tray.on('click',()=>win.show());}
app.whenReady().then(()=>{setupAgent();createWindow();setupTray();setupWakeWord();setupUpdater();win.show();});
app.on('before-quit',()=>{app.isQuitting=true;agent?.stop();void wakeWord?.stop();}); app.on('window-all-closed',()=>{});
ipcMain.handle('companion:status',()=>({...agent.status(),wakeWord:wakeWord?.status()}));
ipcMain.handle('companion:enroll',async(_event,input)=>agent.enroll(String(input?.token||''),String(input?.label||'')));
ipcMain.handle('companion:signout',()=>{agent.signOut();agent.start(Number(process.env.ELP_DEVICE_POLL_MS||15000));return agent.status();});
ipcMain.handle('companion:open',(_event,url)=>{if(!/^https:\/\//i.test(String(url||'')))throw new Error('Only HTTPS links are allowed.');return shell.openExternal(String(url));});
