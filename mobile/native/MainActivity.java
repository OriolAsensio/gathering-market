package app.gatheringmarket;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OcrPlugin.class);  // lector de texto nativo del escáner
        super.onCreate(savedInstanceState);
    }
}
