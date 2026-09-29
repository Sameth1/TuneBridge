package com.tunebridgeapp.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openShared(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openShared(intent);
    }

    // Text shared from another app ("Listen to Divane https://open.spotify.com/…") opens TuneBridge's
    // share page, which finds the link in it.
    private void openShared(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        Bridge bridge = getBridge();
        if (text == null || bridge == null) return;
        String url = bridge.getLocalUrl() + "/index.html?share=1&text=" + Uri.encode(text);
        bridge.getWebView().post(() -> bridge.getWebView().loadUrl(url));
        // Handled once: a configuration change must not load the same share again.
        intent.setAction(Intent.ACTION_MAIN);
    }
}
