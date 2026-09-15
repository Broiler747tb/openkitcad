import { create } from 'zustand'

declare global {
  interface Window { OpenKitAndroid?: { saveFile(name:string,mime:string,base64:string):void; setOrientation?(mode:string):void; getOrientation?():string } }
}
export const isAndroidApp = typeof window !== 'undefined' && !!window.OpenKitAndroid
if(isAndroidApp)document.documentElement.classList.add('android-app')

export const usePenMode=create<{fingerMode:'pan'|'orbit';setFingerMode:(mode:'pan'|'orbit')=>void}>(set=>({
  fingerMode:'pan',setFingerMode:fingerMode=>set({fingerMode}),
}))

/** Android SAF does not handle blob: download anchors. Pass the export to a system save dialog. */
export function androidDownload(blob:Blob, filename:string):boolean {
  const native=window.OpenKitAndroid
  if(!native)return false
  if(blob.size>64*1024*1024){alert('Android export limit is 64 MB. Export fewer objects.');return true}
  const reader=new FileReader()
  reader.onload=()=>{
    const data=String(reader.result).split(',')[1]
    if(data===undefined){alert('Could not prepare export.');return}
    native.saveFile(filename,blob.type||'application/octet-stream',data)
  }
  reader.onerror=()=>alert('Could not read export data.')
  reader.readAsDataURL(blob)
  return true
}
