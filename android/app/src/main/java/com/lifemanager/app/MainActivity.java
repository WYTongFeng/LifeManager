package com.lifemanager.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before super.onCreate(), which builds the bridge.
        registerPlugin(TngNotificationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
