package com.broiler747tb.openkitcad;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Device-side smoke test of bundled JS + WASM, not a remote browser/server test. */
public class OfflineSmokeTest extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle result=new Bundle();
        Activity activity=null;
        try {
            if(getTargetContext().checkSelfPermission("android.permission.INTERNET") != PackageManager.PERMISSION_DENIED) throw new Exception("APK unexpectedly has INTERNET permission");
            Intent intent=new Intent(getTargetContext(),MainActivity.class).putExtra("selftest",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity=startActivitySync(intent);
            WebView web=findWeb(activity.getWindow().getDecorView());
            if(web==null)throw new Exception("WebView not found");
            String text="";
            long deadline=System.currentTimeMillis()+120000;
            while(System.currentTimeMillis()<deadline) {
                text=read(web,"document.getElementById('root')?.textContent || ''");
                if(text.contains("PASS  ")||text.contains("FAIL  "))break;
                Thread.sleep(500);
            }
            java.util.regex.Matcher suite=java.util.regex.Pattern.compile("PASS\\s+(\\d+)/(\\d+)").matcher(text);
            if(!suite.find() || !suite.group(1).equals(suite.group(2)) || Integer.parseInt(suite.group(1))<309) throw new Exception("Bundled selftest: "+text.substring(0,Math.min(text.length(),1000)));
            String suiteCount=suite.group(1)+"/"+suite.group(2);
            runOnMainSync(()->web.loadUrl("https://appassets.androidplatform.net/assets/index.html"));
            deadline=System.currentTimeMillis()+60000;
            boolean ready=false;
            while(System.currentTimeMillis()<deadline) {
                String check=read(web,"!!document.querySelector('canvas') && !!document.querySelector('.pen-bar') && !document.querySelector('.overlay-centre')");
                if(check.equals("true")){ready=true;break;}
                Thread.sleep(500);
            }
            if(!ready)throw new Exception("Android workspace / canvas did not become ready: "+read(web,"document.body.innerText"));
            for(String orientation:new String[]{"portrait","landscape"}) {
                read(web,"window.OpenKitAndroid.setOrientation('"+orientation+"')");
                long rotateDeadline=System.currentTimeMillis()+15000;
                while(System.currentTimeMillis()<rotateDeadline) {
                    if(read(web,orientation.equals("landscape")?"innerWidth>innerHeight":"innerHeight>innerWidth").equals("true"))break;
                    Thread.sleep(300);
                }
                if(!read(web,orientation.equals("landscape")?"innerWidth>innerHeight":"innerHeight>innerWidth").equals("true"))throw new Exception("Rotation failed: "+orientation);
                String layout="(()=>{const p=document.querySelector('.pen-bar').getBoundingClientRect(),v=document.querySelector('.viewport').getBoundingClientRect(),n=document.querySelector('.navigation-bar').getBoundingClientRect();return p.bottom<=v.top+1&&v.bottom<=n.top+1&&v.height>80})()";
                if(!read(web,layout).equals("true"))throw new Exception("Overlapping layout: "+orientation);
                read(web,"Array.from(document.querySelectorAll('.pen-bar button')).find(b=>b.textContent==='Components').click()");
                Thread.sleep(300);
                String catalogue="(()=>{const panel=document.querySelector('.panel-left'),r=panel.getBoundingClientRect(),v=document.querySelector('.viewport').getBoundingClientRect();return getComputedStyle(panel).display!=='none'&&r.left>=0&&r.right<=innerWidth+1&&r.top>=v.top-1&&r.bottom<=v.bottom+1&&!!panel.querySelector('input')})()";
                if(!read(web,catalogue).equals("true"))throw new Exception("Catalogue inaccessible: "+orientation);
                read(web,"Array.from(document.querySelectorAll('.pen-bar button')).find(b=>b.textContent==='Close panel').click()");
                Thread.sleep(200);
            }
            read(web,"window.OpenKitAndroid.setOrientation('auto')");
            result.putString("stream","\nPASS: "+suiteCount+" bundled tests; portrait and landscape rotation; non-overlapping controls/canvas; accessible Components drawer in both orientations; INTERNET permission absent.\n");
            finish(Activity.RESULT_OK,result);
        } catch(Throwable e) {
            result.putString("stream","\nFAIL: "+e+"\n");finish(Activity.RESULT_CANCELED,result);
        } finally {
            if(activity!=null){Activity target=activity;runOnMainSync(target::finish);}
        }
    }
    private WebView findWeb(View view) {
        if(view instanceof WebView)return (WebView)view;
        if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){WebView w=findWeb(group.getChildAt(i));if(w!=null)return w;}}
        return null;
    }
    private String read(WebView web,String expression) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>("");
        runOnMainSync(()->web.evaluateJavascript(expression,v->{value.set(v);latch.countDown();}));
        // The solver's synchronous suite can occupy the WebView thread on a cold emulator.
        if(!latch.await(45,TimeUnit.SECONDS))throw new Exception("JavaScript callback timed out");
        return value.get();
    }
}
