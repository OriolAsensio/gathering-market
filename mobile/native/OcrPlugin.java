package app.gatheringmarket;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * Lector de texto nativo (ML Kit, modelo dentro del APK, sin internet) para el escáner de cartas.
 * Tesseract en WebAssembly tarda segundos por lectura en el móvil; esto, décimas.
 * JS: Capacitor.Plugins.Ocr.read({ image: "data:image/jpeg;base64,..." }) -> { lines: [{ text, x, y, w, h }], width, height }
 */
@CapacitorPlugin(name = "Ocr")
public class OcrPlugin extends Plugin {
    private TextRecognizer recognizer;

    @PluginMethod
    public void read(PluginCall call) {
        String data = call.getString("image");
        if (data == null) { call.reject("Sin imagen"); return; }
        int comma = data.indexOf(',');
        if (comma >= 0) data = data.substring(comma + 1);
        Bitmap bmp;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (IllegalArgumentException e) {
            call.reject("Imagen no válida");
            return;
        }
        if (bmp == null) { call.reject("Imagen no válida"); return; }
        if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        final int width = bmp.getWidth(), height = bmp.getHeight();
        recognizer.process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener(text -> {
                JSArray lines = new JSArray();
                for (Text.TextBlock block : text.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        JSObject o = new JSObject();
                        o.put("text", line.getText());
                        Rect r = line.getBoundingBox();
                        if (r != null) { o.put("x", r.left); o.put("y", r.top); o.put("w", r.width()); o.put("h", r.height()); }
                        lines.put(o);
                    }
                }
                JSObject res = new JSObject();
                res.put("lines", lines);
                res.put("width", width);
                res.put("height", height);
                call.resolve(res);
            })
            .addOnFailureListener(e -> call.reject(e.getMessage() == null ? "Error del lector" : e.getMessage()));
    }
}
