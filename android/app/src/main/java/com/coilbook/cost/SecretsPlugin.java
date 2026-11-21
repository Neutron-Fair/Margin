package com.coilbook.cost;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "Secrets")
public class SecretsPlugin extends Plugin {
    private static final String ALIAS = "coilbook.secrets.v1";
    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            gen.generateKey();
        }
        return (SecretKey) ks.getKey(ALIAS, null);
    }
    @PluginMethod
    public void access(PluginCall call) {
        String action = call.getString("action", "");
        String id = call.getString("id", "");
        String value = call.getString("value", "");
        if (!id.matches("^(ai|ocr|update):[a-f0-9]{64}$") || !(action.equals("get") || action.equals("set") || action.equals("delete")) || value.length() > 16384) {
            call.reject("无效的密钥请求"); return;
        }
        try {
            SharedPreferences prefs = getContext().getSharedPreferences("coilbook_secrets", 0);
            JSObject result = new JSObject();
            if (action.equals("delete")) {
                if (!prefs.edit().remove(id).commit()) throw new Exception();
            } else if (action.equals("set")) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key());
                String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
                if (!prefs.edit().putString(id, encoded).commit()) throw new Exception();
            } else {
                String encoded = prefs.getString(id, null);
                if (encoded != null) {
                    String[] parts = encoded.split(":", -1);
                    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                    cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                    result.put("value", new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
                }
            }
            call.resolve(result);
        } catch (Exception e) { call.reject("Android Keystore 不可用或密钥读取失败"); }
    }
}
