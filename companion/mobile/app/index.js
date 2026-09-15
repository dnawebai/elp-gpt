import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Button, Platform, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import { AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as Constants from 'expo-constants';
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

const SERVER = Constants.default?.expoConfig?.extra?.elpServer || 'https://elpgpt.com';
const APP_VERSION = Constants.default?.expoConfig?.version || '0.2.0';
const TOKEN_KEY = 'elp-companion-token';
const DEVICE_KEY = 'elp-companion-device-id';
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });

function makeDeviceId() { return `mobile-${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`; }
async function authenticated(reason) {
  const supported = await LocalAuthentication.hasHardwareAsync();
  if (!supported) return false;
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: 'Cancel', disableDeviceFallback: false });
  return result.success;
}
function recordingMime(uri) {
  const lower = String(uri || '').toLowerCase();
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  return 'audio/mp4';
}
function base64Bytes(value) {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function currentDeviceContext(appState) {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  return {
    capturedAt: new Date().toISOString(),
    timezone: resolved.timeZone || undefined,
    locale: resolved.locale || undefined,
    online: true,
    platform: Platform.OS,
    osVersion: String(Device.osVersion || Platform.Version || ''),
    modelName: Device.modelName || undefined,
    deviceName: Device.deviceName || undefined,
    appVersion: APP_VERSION,
    appState: ['active','background','inactive'].includes(appState) ? appState : 'unknown',
  };
}

export default function MobileCompanion() {
  const [token,setToken]=useState('');
  const [deviceId,setDeviceId]=useState('');
  const [enrollment,setEnrollment]=useState('');
  const [status,setStatus]=useState('Not enrolled');
  const [shared,setShared]=useState('');
  const [appState,setAppState]=useState(AppState.currentState || 'unknown');
  const [voiceBusy,setVoiceBusy]=useState(false);
  const [transcript,setTranscript]=useState('');
  const [reply,setReply]=useState('');
  const recorder=useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState=useAudioRecorderState(recorder,200);
  const playerRef=useRef(null);
  const audioFileRef=useRef(null);
  const enrolled=useMemo(()=>Boolean(token&&deviceId),[token,deviceId]);

  function releaseReplyAudio() {
    try { playerRef.current?.release?.(); } catch {}
    playerRef.current=null;
    try { if(audioFileRef.current?.exists) audioFileRef.current.delete(); } catch {}
    audioFileRef.current=null;
  }

  useEffect(()=>{(async()=>{const [t,d]=await Promise.all([SecureStore.getItemAsync(TOKEN_KEY),SecureStore.getItemAsync(DEVICE_KEY)]);if(t&&d){setToken(t);setDeviceId(d);setStatus(`Enrolled as ${d}`);}})();const linkSub=Linking.addEventListener('url',({url})=>{setShared(url);});const stateSub=AppState.addEventListener('change',(next)=>setAppState(next));return()=>{linkSub.remove();stateSub.remove();releaseReplyAudio();};},[]);
  useEffect(()=>{const responseSub=Notifications.addNotificationResponseReceivedListener(async(response)=>{const data=response.notification.request.content.data||{};const url=typeof data.url==='string'?data.url:'';if(!url)return;const ok=await authenticated('Approve opening ELP action');if(ok)await Linking.openURL(url);});return()=>responseSub.remove();},[]);

  async function enroll(){try{const id=deviceId||makeDeviceId();const response=await fetch(`${SERVER}/api/companion/enroll`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enrollmentToken:enrollment.trim(),deviceId:id,label:Device.deviceName||'ELP Mobile',platform:Platform.OS,agentVersion:'mobile-0.2.0'})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Enrollment failed.');await SecureStore.setItemAsync(TOKEN_KEY,payload.companionToken);await SecureStore.setItemAsync(DEVICE_KEY,id);setToken(payload.companionToken);setDeviceId(id);setEnrollment('');setStatus(`Enrolled as ${id}`);}catch(e){Alert.alert('Enrollment failed',e.message||String(e));}}
  async function enablePush(){try{if(!enrolled)throw new Error('Enroll this device first.');const permission=await Notifications.requestPermissionsAsync();if(permission.status!=='granted')throw new Error('Notification permission was not granted.');const projectId=Constants.default?.expoConfig?.extra?.eas?.projectId||Constants.default?.easConfig?.projectId;const push=await Notifications.getExpoPushTokenAsync(projectId?{projectId}:undefined);const response=await fetch(`${SERVER}/api/mobile-companion`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'register-push',expoPushToken:push.data,platform:Platform.OS})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Push registration failed.');setStatus('Push approvals enabled');}catch(e){Alert.alert('Push setup',e.message||String(e));}}

  async function startVoice(){
    try{
      if(!enrolled)throw new Error('Enroll this device first.');
      if(voiceBusy||recorderState.isRecording)return;
      if(!(await authenticated('Start ELP voice session')))return;
      releaseReplyAudio();
      const permission=await AudioModule.requestRecordingPermissionsAsync();
      if(!permission.granted)throw new Error('Microphone permission was not granted.');
      await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true,interruptionMode:'doNotMix'});
      await recorder.prepareToRecordAsync();
      recorder.record();
      setTranscript('');setReply('');setStatus('Listening…');
    }catch(e){Alert.alert('Voice',e.message||String(e));setStatus('Voice unavailable');}
  }

  async function playReplySpeech(speech){
    if(!speech?.audioBase64)return;
    releaseReplyAudio();
    const file=new File(Paths.cache,`elp-reply-${Date.now()}.mp3`);
    file.create({overwrite:true,intermediates:true});
    file.write(base64Bytes(speech.audioBase64));
    const player=createAudioPlayer(file.uri,{updateInterval:250});
    audioFileRef.current=file;playerRef.current=player;
    const subscription=player.addListener('playbackStatusUpdate',(playback)=>{if(playback.didJustFinish){subscription.remove();releaseReplyAudio();}});
    player.play();
  }

  async function stopVoice(){
    if(!recorderState.isRecording||voiceBusy)return;
    setVoiceBusy(true);setStatus('Thinking…');
    try{
      await recorder.stop();
      await setAudioModeAsync({allowsRecording:false,playsInSilentMode:true,interruptionMode:'doNotMix'});
      const uri=recorder.uri;
      if(!uri)throw new Error('Recording was not saved.');
      const form=new FormData();
      form.append('audio',{uri,name:'elp-voice.m4a',type:recordingMime(uri)});
      form.append('deviceContext',JSON.stringify(currentDeviceContext(appState)));
      const response=await fetch(`${SERVER}/api/mobile-voice`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||'ELP voice request failed.');
      setTranscript(payload.transcript||'');setReply(payload.message||'');setStatus('Ready');
      if(payload.speech)await playReplySpeech(payload.speech);
    }catch(e){setStatus('Voice request failed');Alert.alert('ELP voice',e.message||String(e));}
    finally{setVoiceBusy(false);}
  }

  async function signOut(){if(recorderState.isRecording){try{await recorder.stop();}catch{}}releaseReplyAudio();await SecureStore.deleteItemAsync(TOKEN_KEY);await SecureStore.deleteItemAsync(DEVICE_KEY);setToken('');setDeviceId('');setStatus('Not enrolled');setTranscript('');setReply('');}

  return <SafeAreaView style={{flex:1,backgroundColor:'#06111f'}}><ScrollView contentContainerStyle={{padding:22,gap:14}}>
    <Text style={{color:'#edf7ff',fontSize:32,fontWeight:'800'}}>ELP Companion</Text><Text style={{color:'#90aabd'}}>Secure mobile approvals, native push-to-talk voice, notifications, device context and companion enrollment.</Text>
    <View style={{padding:16,borderRadius:14,backgroundColor:'#091725',gap:10}}><Text style={{color:'#75a9d6'}}>STATUS</Text><Text style={{color:'#edf7ff',fontSize:18}}>{status}</Text>{!enrolled&&<><TextInput value={enrollment} onChangeText={setEnrollment} placeholder="Enrollment token" placeholderTextColor="#60798f" autoCapitalize="none" style={{backgroundColor:'#06111f',color:'#fff',padding:12,borderRadius:8}}/><Button title="Enroll securely" onPress={enroll}/></>}{enrolled&&<><Button title="Enable push approvals" onPress={enablePush}/>{recorderState.isRecording?<Button title={`Stop & send (${Math.max(1,Math.round((recorderState.durationMillis||0)/1000))}s)`} onPress={stopVoice} disabled={voiceBusy}/>:<Button title={voiceBusy?'ELP is thinking…':'Talk to ELP'} onPress={startVoice} disabled={voiceBusy}/>}<Button title="Sign out this device" onPress={signOut}/></>}</View>
    {(transcript||reply)?<View style={{padding:16,borderRadius:14,backgroundColor:'#091725',gap:10}}>{transcript?<><Text style={{color:'#75a9d6'}}>YOU</Text><Text selectable style={{color:'#dbe9f4'}}>{transcript}</Text></>:null}{reply?<><Text style={{color:'#75a9d6',marginTop:4}}>ELP</Text><Text selectable style={{color:'#edf7ff',fontSize:16,lineHeight:23}}>{reply}</Text></>:null}</View>:null}
    {shared?<View style={{padding:16,borderRadius:14,backgroundColor:'#091725'}}><Text style={{color:'#75a9d6'}}>OPENED WITH ELP</Text><Text selectable style={{color:'#edf7ff',marginTop:8}}>{shared}</Text><Text style={{color:'#90aabd',marginTop:8}}>Deep-link handoff is active. A full OS share extension still requires the signed native store build target.</Text></View>:null}
    <Text style={{color:'#60798f',fontSize:12}}>Voice recording starts only after biometric confirmation and an explicit tap. ELP sends the recording to the authenticated server for transcription and reasoning, then returns the ELP signature voice. Continuous background wake-word listening is not enabled on mobile.</Text>
  </ScrollView></SafeAreaView>;
}
