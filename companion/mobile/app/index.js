import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Platform, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import * as Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Linking from 'expo-linking';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

const SERVER = Constants.default?.expoConfig?.extra?.elpServer || 'https://elpgpt.com';
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

export default function MobileCompanion() {
  const [token,setToken]=useState(''); const [deviceId,setDeviceId]=useState(''); const [enrollment,setEnrollment]=useState(''); const [status,setStatus]=useState('Not enrolled'); const [shared,setShared]=useState('');
  const enrolled=useMemo(()=>Boolean(token&&deviceId),[token,deviceId]);
  useEffect(()=>{(async()=>{const [t,d]=await Promise.all([SecureStore.getItemAsync(TOKEN_KEY),SecureStore.getItemAsync(DEVICE_KEY)]);if(t&&d){setToken(t);setDeviceId(d);setStatus(`Enrolled as ${d}`);}})(); const sub=Linking.addEventListener('url',({url})=>{setShared(url);}); return()=>sub.remove();},[]);
  useEffect(()=>{const responseSub=Notifications.addNotificationResponseReceivedListener(async(response)=>{const data=response.notification.request.content.data||{};const url=typeof data.url==='string'?data.url:'';if(!url)return;const ok=await authenticated('Approve opening ELP action');if(ok)await Linking.openURL(url);});return()=>responseSub.remove();},[]);
  async function enroll(){try{const id=deviceId||makeDeviceId();const response=await fetch(`${SERVER}/api/companion/enroll`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enrollmentToken:enrollment.trim(),deviceId:id,label:Device.deviceName||'ELP Mobile',platform:Platform.OS,agentVersion:'mobile-0.1.0'})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Enrollment failed.');await SecureStore.setItemAsync(TOKEN_KEY,payload.companionToken);await SecureStore.setItemAsync(DEVICE_KEY,id);setToken(payload.companionToken);setDeviceId(id);setEnrollment('');setStatus(`Enrolled as ${id}`);}catch(e){Alert.alert('Enrollment failed',e.message||String(e));}}
  async function enablePush(){try{if(!enrolled)throw new Error('Enroll this device first.');const permission=await Notifications.requestPermissionsAsync();if(permission.status!=='granted')throw new Error('Notification permission was not granted.');const projectId=Constants.default?.expoConfig?.extra?.eas?.projectId||Constants.default?.easConfig?.projectId;const push=await Notifications.getExpoPushTokenAsync(projectId?{projectId}:undefined);const response=await fetch(`${SERVER}/api/mobile-companion`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'register-push',expoPushToken:push.data,platform:Platform.OS})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Push registration failed.');setStatus('Push approvals enabled');}catch(e){Alert.alert('Push setup',e.message||String(e));}}
  async function openVoice(){if(!(await authenticated('Start ELP voice session')))return;await Linking.openURL(`${SERVER}/?voice=1&source=mobile`);}
  async function signOut(){await SecureStore.deleteItemAsync(TOKEN_KEY);await SecureStore.deleteItemAsync(DEVICE_KEY);setToken('');setDeviceId('');setStatus('Not enrolled');}
  return <SafeAreaView style={{flex:1,backgroundColor:'#06111f'}}><ScrollView contentContainerStyle={{padding:22,gap:14}}>
    <Text style={{color:'#edf7ff',fontSize:32,fontWeight:'800'}}>ELP Companion</Text><Text style={{color:'#90aabd'}}>Secure mobile approvals, notifications, voice launch and companion enrollment.</Text>
    <View style={{padding:16,borderRadius:14,backgroundColor:'#091725',gap:10}}><Text style={{color:'#75a9d6'}}>STATUS</Text><Text style={{color:'#edf7ff',fontSize:18}}>{status}</Text>{!enrolled&&<><TextInput value={enrollment} onChangeText={setEnrollment} placeholder="Enrollment token" placeholderTextColor="#60798f" autoCapitalize="none" style={{backgroundColor:'#06111f',color:'#fff',padding:12,borderRadius:8}}/><Button title="Enroll securely" onPress={enroll}/></>}{enrolled&&<><Button title="Enable push approvals" onPress={enablePush}/><Button title="Start voice with biometric confirmation" onPress={openVoice}/><Button title="Sign out this device" onPress={signOut}/></>}</View>
    {shared?<View style={{padding:16,borderRadius:14,backgroundColor:'#091725'}}><Text style={{color:'#75a9d6'}}>OPENED WITH ELP</Text><Text selectable style={{color:'#edf7ff',marginTop:8}}>{shared}</Text><Text style={{color:'#90aabd',marginTop:8}}>Share-extension handoff is received through the ELP deep-link scheme. Native share extensions can be added in signed store builds.</Text></View>:null}
    <Text style={{color:'#60798f',fontSize:12}}>ELP does not keep the microphone running continuously in the background on mobile. Voice starts only after an explicit user action; platform background-audio policies remain enforced.</Text>
  </ScrollView></SafeAreaView>;
}
