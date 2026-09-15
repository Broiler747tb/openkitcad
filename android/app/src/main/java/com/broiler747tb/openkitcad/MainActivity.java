package com.broiler747tb.openkitcad;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.MotionEvent;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int OPEN_FILE = 11, SAVE_FILE = 12;
    private static final int MAX_EXPORT = 64 * 1024 * 1024;
    private WebView web;
    private ValueCallback<Uri[]> chooser;
    private byte[] pendingSave;
    private boolean saveBusy;
    private final ExecutorService files = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        applyOrientation(getPreferences(MODE_PRIVATE).getString("orientation","auto"));
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only URIs chosen through the system document picker.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setUserAgentString(settings.getUserAgentString() + " OpenKitCADAndroid/0.5.1");

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = assets.shouldInterceptRequest(request.getUrl());
                if (response != null) {
                    if (request.getUrl().getPath().endsWith(".wasm")) response.setMimeType("application/wasm");
                    return response;
                }
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Offline", null, new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Never navigate the bridged WebView to remote or user-supplied HTML.
                return !request.getUrl().toString().startsWith(ORIGIN + "/assets/index.html");
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                root.removeView(view); view.destroy();
                new AlertDialog.Builder(MainActivity.this).setTitle("Renderer stopped")
                    .setMessage("Android stopped the CAD renderer. Reopen the app to restore the last autosave. Large models may exceed device memory.")
                    .setPositiveButton("Close", (d,w)->finish()).setCancelable(false).show();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try { startActivityForResult(intent, OPEN_FILE); }
                catch (Exception e) { chooser.onReceiveValue(null); chooser=null; toast("No document picker available."); }
                return true;
            }
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK",(d,w)->result.confirm()).setNegativeButton("Cancel",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;
            }
        });
        web.addJavascriptInterface(new FileBridge(), "OpenKitAndroid");
        web.loadUrl(ORIGIN + "/assets/index.html" + (BuildConfig.DEBUG && getIntent().getBooleanExtra("selftest", false) ? "?selftest" : ""));
    }

    public class FileBridge {
        @JavascriptInterface public String getOrientation() { return getPreferences(MODE_PRIVATE).getString("orientation","auto"); }
        @JavascriptInterface public void setOrientation(String mode) {
            if(!"auto".equals(mode)&&!"landscape".equals(mode)&&!"portrait".equals(mode))return;
            runOnUiThread(()->{getPreferences(MODE_PRIVATE).edit().putString("orientation",mode).apply();applyOrientation(mode);});
        }
        @JavascriptInterface public void saveFile(String name, String mime, String data) {
            // Called by local document/export commands only. The user chooses every destination.
            if (data == null || data.length() > MAX_EXPORT * 4L / 3 + 4) { runOnUiThread(()->toast("Export exceeds 64 MB. Export fewer objects.")); return; }
            runOnUiThread(()->{
                if (saveBusy) { toast("Finish the current save first."); return; }
                saveBusy=true;
                files.execute(()->{
                    try {
                        byte[] bytes=Base64.decode(data, Base64.DEFAULT);
                        runOnUiThread(()->{
                            pendingSave=bytes;
                            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                                .setType(mime == null || !mime.contains("/") ? "application/octet-stream" : mime)
                                .putExtra(Intent.EXTRA_TITLE, name == null ? "design.okc" : name.replaceAll("[/\\\\\\p{Cntrl}]", "_"));
                            try { startActivityForResult(intent,SAVE_FILE); }
                            catch(Exception e){pendingSave=null;saveBusy=false;toast("Could not open save dialog.");}
                        });
                    } catch(Exception e){runOnUiThread(()->{saveBusy=false;toast("Could not prepare export.");});}
                });
            });
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request,result,intent);
        if(request==OPEN_FILE && chooser!=null){chooser.onReceiveValue(result==RESULT_OK && intent!=null && intent.getData()!=null ? new Uri[]{intent.getData()}:null);chooser=null;}
        if(request==SAVE_FILE){
            byte[] bytes=pendingSave;pendingSave=null;
            if(result!=RESULT_OK || intent==null || intent.getData()==null || bytes==null){saveBusy=false;return;}
            Uri uri=intent.getData();
            files.execute(()->{
                boolean ok=false;
                try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new Exception();out.write(bytes);ok=true;}catch(Exception ignored){}
                final boolean saved=ok;
                runOnUiThread(()->{saveBusy=false;toast(saved?"File saved.":"Could not save file. Try another folder.");});
            });
        }
    }
    @Override public void onBackPressed() {
        // Back is a reliable hardware equivalent to Escape; explicit confirmation exits.
        new AlertDialog.Builder(this).setTitle("OpenKitCAD").setItems(new String[]{"Cancel current command", "Stay in CAD", "Close app"},(dialog,which)->{
            if(which==0)web.evaluateJavascript("window.dispatchEvent(new Event('okc:cancel'))",null);
            if(which==2)finish();
        }).show();
    }
    @Override public boolean dispatchGenericMotionEvent(MotionEvent event) {
        // Samsung stylus barrel-button press while hovering: local canvas context menu.
        if(event.getActionMasked()==MotionEvent.ACTION_BUTTON_PRESS &&
            (event.getActionButton()==MotionEvent.BUTTON_STYLUS_PRIMARY || event.getActionButton()==MotionEvent.BUTTON_STYLUS_SECONDARY)) {
            float scale=web.getScale();
            int[] location=new int[2];web.getLocationOnScreen(location);
            float x=(event.getRawX()-location[0])/scale,y=(event.getRawY()-location[1])/scale;
            web.evaluateJavascript("(()=>{const x="+x+",y="+y+";const t=document.elementFromPoint(x,y)?.closest('.viewport-canvas');if(t)t.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:x,clientY:y}));})()",null);
            return true;
        }
        return super.dispatchGenericMotionEvent(event);
    }
    private void toast(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();}
    private void applyOrientation(String mode) {
        setRequestedOrientation("landscape".equals(mode)?ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE:
            "portrait".equals(mode)?ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT:ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
    }
    @Override protected void onPause(){if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('okc:background'))",null);super.onPause();}
    @Override protected void onDestroy(){if(chooser!=null)chooser.onReceiveValue(null);pendingSave=null;files.shutdown();super.onDestroy();}
}
